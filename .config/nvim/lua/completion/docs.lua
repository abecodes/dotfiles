-- Side-popup documentation via completionItem/resolve. Cribbed from
-- runtime/lua/vim/lsp/completion.lua CompletionResolver (lines 633-782) +
-- on_completechanged (786-836). Adapted to the multi-source aggregator:
-- the resolver looks up the originating client via user_data.nvim.lsp.client_id
-- so docs work with the cross-client merged pool.

local autocmd  = require('utils.autocmd')
local protocol = require('vim.lsp.protocol')
local cfg      = require('completion.config')

local M = {}

local ns_to_ms = 0.000001

-- Per-resolver EMA, mirrors runtime line 658 (window=10, warmup=5). The
-- doc resolver gets a separate exp_avg from the request-side one because
-- resolve RTT distributes differently from completion RTT.
local function exp_avg(window, warmup)
  local count, sum, value = 0, 0, 0.0
  return function(sample)
    if count < warmup then
      count = count + 1
      sum   = sum + sample
      value = sum / count
    else
      local factor = 2.0 / (window + 1)
      value = value * (1 - factor) + sample * factor
    end
    return value
  end
end

local function adaptive_debounce(last_request_time, current_rtt_ms)
  if not last_request_time then return current_rtt_ms end
  local ms_since = (vim.uv.hrtime() - last_request_time) * ns_to_ms
  return math.max((ms_since - current_rtt_ms) * -1, 0)
end

local function has_completeopt(flag)
  return vim.list_contains(vim.opt.completeopt:get(), flag)
end

-- Resolver state per buffer. Idempotent: re-attach reuses the same struct.
---@type table<integer, table>
local resolvers = {}

local function new_resolver()
  local docs_cfg = cfg.opts.docs or {}
  return {
    timer                   = nil,
    bufnr                   = nil,
    word                    = nil,
    last_request_time       = nil,
    doc_rtt_ms              = docs_cfg.initial_rtt_ms or 50.0,
    doc_compute_new_average = exp_avg(10, 5),
    -- Per-pum-session cache: key -> { value: string?, kind: string? }.
    -- Cleared on CompleteDone (see M.attach). A nil `value` is negative-
    -- cached so we don't re-request on every navigation when an item has
    -- no docs to begin with.
    cache                   = {},
  }
end

local function resolver_cleanup(r)
  if r.timer and not r.timer:is_closing() then
    r.timer:stop()
    r.timer:close()
  end
  r.timer = nil
end

-- runtime is_valid (lines 692-700). Verbatim semantics: same buffer, still
-- in insert mode, pum still showing, the selected word matches what we
-- requested for. complete_info({selected, completed}) returns the
-- currently-selected item.
local function resolver_is_valid(r)
  local cmp_info = vim.fn.complete_info({ 'selected', 'completed' })
  return vim.api.nvim_buf_is_valid(r.bufnr)
    and vim.api.nvim_get_current_buf() == r.bufnr
    and vim.startswith(vim.api.nvim_get_mode().mode, 'i')
    and vim.fn.pumvisible() ~= 0
    and (vim.tbl_get(cmp_info, 'completed', 'word') or '') == r.word,
    cmp_info
end

-- Longest visible line width, in display cells. Used to size the popup
-- to its content (capped by max_width below).
local function longest_line(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local longest = 0
  for _, line in ipairs(lines) do
    local w = vim.fn.strdisplaywidth(line)
    if w > longest then longest = w end
  end
  return longest
end

-- Border footprint per side. Adjust if we ever switch border style.
local BORDER_PAD = 2  -- 1 left + 1 right (or 1 top + 1 bottom)
local MIN_W      = 20

-- Choose where to place the docs popup relative to the pum and how wide
-- to make it. Strategy:
--   1. Prefer Vim's default placement (right of pum). Just set width if
--      the content fits in the available right-side space.
--   2. If right is too narrow, place to the LEFT of the pum (relative to
--      'editor', explicit row/col).
--   3. If neither side has enough room, pick the wider one and shrink
--      the popup width to fit. Don't go below MIN_W.
-- Returns a config table suitable for nvim_win_set_config.
local function place_popup(content_w, content_h)
  local pum = vim.fn.pum_getpos()
  local cols = vim.o.columns
  local cfg_table = {
    border = 'rounded',
    width  = content_w,
    height = content_h,
  }

  -- No pum reported (test path / edge case). Just set size; let Vim's
  -- default placement stand.
  if vim.tbl_isempty(pum) then return cfg_table end

  local pum_col   = pum.col
  local pum_w     = pum.width + (pum.scrollbar and 1 or 0)
  local right_av  = cols - (pum_col + pum_w) - BORDER_PAD
  local left_av   = pum_col - BORDER_PAD

  if right_av >= content_w then
    -- Right side fits at full width — let Vim handle the position.
    return cfg_table
  end

  if left_av >= content_w then
    -- Left side fits — explicit relative positioning required.
    cfg_table.relative = 'editor'
    cfg_table.row      = pum.row
    cfg_table.col      = pum_col - content_w - BORDER_PAD
    return cfg_table
  end

  -- Both sides tight. Pick the larger, shrink content width to fit.
  if right_av >= left_av then
    cfg_table.width = math.max(MIN_W, right_av)
  else
    cfg_table.width    = math.max(MIN_W, left_av)
    cfg_table.relative = 'editor'
    cfg_table.row      = pum.row
    cfg_table.col      = pum_col - cfg_table.width - BORDER_PAD
  end
  return cfg_table
end

local function update_popup_window(winid, bufnr, kind)
  if not (winid and vim.api.nvim_win_is_valid(winid)
           and bufnr and vim.api.nvim_buf_is_valid(bufnr))
  then return end

  if kind == protocol.MarkupKind.Markdown then
    vim.wo[winid].conceallevel = 2
    pcall(vim.treesitter.start, bufnr, kind)
  end

  local docs_cfg = cfg.opts.docs or {}
  local max_w    = docs_cfg.max_width  or 60
  local max_h    = docs_cfg.max_height or 20
  local content_w = math.max(MIN_W, math.min(longest_line(bufnr), max_w))
  local all       = vim.api.nvim_win_text_height(winid, {}).all
  local content_h = math.max(1, math.min(all, max_h))

  -- pcall because nvim_win_set_config rejects on already-closed wins
  -- AND on certain relative<->non-relative transitions in older nvims.
  pcall(vim.api.nvim_win_set_config, winid, place_popup(content_w, content_h))
  vim.wo[winid].winhighlight = 'Normal:NormalFloat,FloatBorder:FloatBorder'
end

-- Stable identity for an LSP CompletionItem within one pum session.
-- Includes kind because two servers (or one server) can offer the same
-- label for different kinds, and their docs differ.
local function cache_key_for(client_id, lsp_item)
  return client_id .. '\0' .. (lsp_item.label or '') .. '\0' .. tostring(lsp_item.kind or '')
end

-- Push (already-resolved) docs into the pum's preview popup. cmp_info
-- comes from complete_info({ 'selected' }) at the call site so callers
-- don't pay for it twice. nil/empty value is a no-op.
local function render_resolved(cmp_info, value, kind)
  if value == nil or value == '' then return end
  local windata = vim.api.nvim__complete_set(cmp_info.selected, { info = value })
  update_popup_window(windata.winid, windata.bufnr, kind)
end

-- Issue a debounced completionItem/resolve. The runtime equivalent is
-- CompletionResolver:request (lines 709-782). Multi-client aware via the
-- client_id stored on the completed item's user_data.
-- `cache_key`: build by the caller via cache_key_for(); on success the
-- response is memoized on r.cache so re-selecting the same item doesn't
-- re-roundtrip. Errors are NOT cached (next selection retries).
local function resolver_request(r, bufnr, lsp_item, selected_word, cache_key)
  resolver_cleanup(r)
  r.bufnr = bufnr
  r.word  = selected_word
  local debounce = adaptive_debounce(r.last_request_time, r.doc_rtt_ms)

  r.timer = vim.defer_fn(function()
    local valid, cmp_info = resolver_is_valid(r)
    if not valid then resolver_cleanup(r); return end

    local client_id = vim.tbl_get(cmp_info.completed, 'user_data', 'nvim', 'lsp', 'client_id')
    local client = client_id and vim.lsp.get_client_by_id(client_id)
    if not client or not client:supports_method('completionItem/resolve') then return end

    local start_time = vim.uv.hrtime()
    r.last_request_time = start_time

    client:request('completionItem/resolve', lsp_item, function(err, result)
      local sample = (vim.uv.hrtime() - start_time) * ns_to_ms
      r.doc_rtt_ms = r.doc_compute_new_average(sample)
      if err then return end
      -- Empty/nil result: negative-cache so subsequent selections of this
      -- item don't re-request. Do NOT cache on hard errors above (server
      -- might recover next time).
      if not result or next(result) == nil then
        if cache_key then r.cache[cache_key] = { value = nil, kind = nil } end
        return
      end

      valid, cmp_info = resolver_is_valid(r)
      if not valid then return end

      local value = vim.tbl_get(result, 'documentation', 'value')
      local kind  = vim.tbl_get(result, 'documentation', 'kind')

      -- If the server returns plain `documentation = "string"` rather
      -- than the structured form, value will be nil but documentation
      -- is the string. Honor that.
      if value == nil and type(result.documentation) == 'string' then
        value = result.documentation
      end

      if result.detail and result.detail ~= '' then
        if not value then
          value = ('```%s\n%s\n```'):format(vim.bo.filetype, result.detail)
          kind  = kind or protocol.MarkupKind.Markdown
        elseif not value:find(result.detail, 1, true) then
          local detail_block = ('```%s\n%s\n```'):format(vim.bo.filetype, result.detail)
          value = detail_block .. '\n' .. value
          kind  = kind or protocol.MarkupKind.Markdown
        end
      end

      -- Cache before the empty-value bail so negative results memoize.
      if cache_key then r.cache[cache_key] = { value = value, kind = kind } end
      render_resolved(cmp_info, value, kind)
    end, bufnr)
  end, debounce)
end

local function on_complete_changed(bufnr)
  if not has_completeopt('popup') then return end

  local completed_item = vim.v.event.completed_item or {}
  local lsp_item = vim.tbl_get(completed_item, 'user_data', 'nvim', 'lsp', 'completion_item')
  local data = vim.fn.complete_info({ 'selected' })

  -- If the item already carries inline `info`, the pum's preview window
  -- shows it for free; just adjust height.
  if (completed_item.info or '') ~= '' then
    local kind = vim.tbl_get(lsp_item or {}, 'documentation', 'kind')
    update_popup_window(data.preview_winid, data.preview_bufnr,
      kind or protocol.MarkupKind.Markdown)
    return
  end

  if not lsp_item then return end

  local client_id = vim.tbl_get(completed_item, 'user_data', 'nvim', 'lsp', 'client_id')
  local client = client_id and vim.lsp.get_client_by_id(client_id)
  if not client or not client:supports_method('completionItem/resolve') then return end

  resolvers[bufnr] = resolvers[bufnr] or new_resolver()
  local r = resolvers[bufnr]
  local key = cache_key_for(client_id, lsp_item)

  -- Cache hit: render synchronously and skip the LSP roundtrip. Cancel
  -- any pending resolver timer that was debouncing for a previous item
  -- so its late callback can't overwrite this item's popup.
  local cached = r.cache[key]
  if cached ~= nil then
    resolver_cleanup(r)
    r.bufnr = bufnr
    r.word  = completed_item.word
    render_resolved(data, cached.value, cached.kind)
    return
  end

  resolver_request(r, bufnr, lsp_item, completed_item.word, key)
end

---@param bufnr integer
function M.attach(bufnr)
  local grp = require('utils.autocmd').new_augroup('codes.abe.completion.docs.' .. bufnr)
  autocmd.new_autocmd('CompleteChanged', grp, {
    buffer   = bufnr,
    callback = function() on_complete_changed(bufnr) end,
  })
  -- Clear the resolver's cache on every pum dismiss/accept. Cache lives
  -- exactly one pum session: items, indices, and server state may all
  -- differ on the next vim.fn.complete() call.
  autocmd.new_autocmd('CompleteDone', grp, {
    buffer = bufnr,
    callback = function()
      if resolvers[bufnr] then resolvers[bufnr].cache = {} end
    end,
  })
  autocmd.new_autocmd({ 'BufWipeout' }, grp, {
    buffer = bufnr,
    callback = function()
      if resolvers[bufnr] then resolver_cleanup(resolvers[bufnr]); resolvers[bufnr] = nil end
    end,
  })
end

return M
