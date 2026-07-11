-- Per-buffer completion aggregator. Drives vim.fn.complete() from a merged
-- pool of LSP, buffer-words, and treesitter identifier candidates.
--
-- The async trigger path mirrors runtime/lua/vim/lsp/completion.lua's
-- on_insert_char_pre + trigger pattern (lines 1059-1102, 956-1056). Cursor
-- snapshot, request cancellation, and the 25ms libuv debounce on a trigger
-- character are taken verbatim. The merge step is novel: we union LSP
-- responses with synchronous buffer/TS scans before pushing to the pum.

local M = {}

local autocmd  = require('utils.autocmd')
local timing   = require('completion.timing')
local sources  = require('completion.sources')
local cfg      = require('completion.config')

-- Per-kind cap pass. Walks items in their (frecency-ranked) input order
-- and keeps at most `caps[kind]` items per kind, falling back to
-- `caps.default` for kinds the config didn't enumerate. Items with no
-- `kind` are bucketed under `default`.
--
-- `keep_capped` (optional) is a set of kinds that STAY capped while every
-- other kind bypasses the cap entirely. emit() passes it on an empty-prefix
-- trigger (raw `.`): the user is browsing all members, not filtering, so the
-- full LSP member list should reach the (scrollable) pum. Local sources
-- (Buffer, Treesitter) remain capped because with no prefix they emit every
-- in-scope word and would otherwise flood the list.
local function apply_caps(items, keep_capped)
  local caps = cfg.opts.caps or {}
  local def = caps.default or 5
  local counts = {}
  local out = {}
  for _, it in ipairs(items) do
    local k = (it.kind ~= nil and it.kind ~= '') and it.kind or 'default'
    if keep_capped and not keep_capped[k] then
      out[#out + 1] = it
    else
      local lim = caps[k] or def
      local n = (counts[k] or 0) + 1
      if n <= lim then
        counts[k] = n
        out[#out + 1] = it
      end
    end
  end
  return out
end

-- Replace the textual kind label ('Function', 'Buffer', ...) with the
-- nerd-font icon from cfg.opts.icons AND assign kind_hlgroup from
-- cfg.opts.highlights so the icon column inherits a per-kind color.
-- Uses fallbacks for unknown kinds so an LSP returning a kind not in the
-- map still gets a glyph + a neutral highlight.
local function swap_icons(items)
  local icons   = cfg.opts.icons      or {}
  local hls     = cfg.opts.highlights or {}
  local fb_icon = icons.default       or ''
  local fb_hl   = hls.default
  for _, it in ipairs(items) do
    local k = it.kind
    it.kind_hlgroup = hls[k] or fb_hl
    it.kind         = icons[k] or fb_icon
  end
  return items
end

-- Per-bufnr context. Lazily allocated on first attach, dropped on detach.
---@type table<integer, table>
local ctxs = {}

-- Per-bufnr trigger-char map (char -> list of client_ids).
---@type table<integer, table<string, integer[]>>
local triggers_by_buf = {}

local AUGROUP_PREFIX = 'codes.abe.completion.'

local function group_for(bufnr)
  return AUGROUP_PREFIX .. bufnr
end

-- Live keyword-tail at the cursor — used by the prefix-trigger gate, NOT
-- by emit (emit reads the snapshotted ctx.prefix taken at trigger time).
local function current_prefix()
  local _, col = unpack(vim.api.nvim_win_get_cursor(0))
  local line = vim.api.nvim_get_current_line()
  local before = line:sub(1, col)
  return before:match('[%w_]*$') or ''
end

-- Merge sources, dedupe by `word`, frecency-rank, push to pum. Caller
-- guarantees this runs scheduled (uv timer/request callbacks wrap with
-- vim.schedule_wrap). Cursor validity is the caller's gate — this just
-- assembles and emits. Uses ctx.prefix (snapshotted at trigger time) so
-- buffer/TS scans match the trigger-instant prefix; the pum's own filter
-- will narrow against any chars the user typed while we were async.
local function emit(ctx, lsp_items)
  if not timing.cursor_still_valid(ctx) then return end

  local prefix = ctx.prefix or ''
  local buf_items, dedup = sources.buffer_words(ctx.bufnr, prefix)
  local ts_items         = sources.ts_identifiers(ctx.bufnr, prefix, dedup)

  -- LSP wins on conflict. Walk LSP first, mark words, then drop buffer/TS
  -- items whose word is already claimed.
  local seen_words = {}
  local matches = {}
  for _, it in ipairs(lsp_items) do
    if not seen_words[it.word] then
      seen_words[it.word] = true
      matches[#matches + 1] = it
    end
  end
  for _, it in ipairs(buf_items) do
    if not seen_words[it.word] then
      seen_words[it.word] = true
      matches[#matches + 1] = it
    end
  end
  for _, it in ipairs(ts_items) do
    if not seen_words[it.word] then
      seen_words[it.word] = true
      matches[#matches + 1] = it
    end
  end

  -- Empty prefix = the user triggered on a non-keyword char (e.g. `.`) and
  -- hasn't typed anything to filter against. Uncap LSP members so the whole
  -- field/method list is reachable in the pum; keep local sources capped.
  local keep_capped = (prefix == '') and { Buffer = true, Treesitter = true } or nil

  matches = require('completion.frecency').rank_items(matches)
  matches = apply_caps(matches, keep_capped)
  matches = swap_icons(matches)

  vim.fn.complete(ctx.start_col, matches)
end

-- Central trigger. Snapshots cursor, fires LSP requests, fans buffer/TS
-- gather + merge into the response handlers. If there are no LSP clients,
-- emits synchronously off buffer/TS alone.
-- trigger_kind/trigger_char are part of the public signature so callers can
-- pass LSP CompletionContext info if/when we wire it through to
-- textDocument/completion params. Currently informational only.
---@param bufnr integer
---@param _trigger_kind 'invoked'|'trigger_char'|'incomplete'|nil
---@param _trigger_char string?
---@param opts? { timeout_ms?: integer }
---@diagnostic disable-next-line: unused-local
function M.trigger(bufnr, _trigger_kind, _trigger_char, opts)
  bufnr = bufnr ~= 0 and bufnr or vim.api.nvim_get_current_buf()
  local ctx = ctxs[bufnr]
  if not ctx then return end

  opts = opts or {}
  local timeout_ms = opts.timeout_ms or 1000

  timing.reset_timer(ctx)
  timing.snapshot_cursor(ctx)

  local clients = vim.lsp.get_clients({
    bufnr  = bufnr,
    method = 'textDocument/completion',
  })

  if #clients == 0 then
    -- No LSP — synchronous path. Still gated through emit() so frecency
    -- and dedupe behave identically.
    emit(ctx, {})
    return
  end

  -- Generation token: ctx.last_request_time uniquely identifies this
  -- trigger invocation. Both the per-client callback and the timer
  -- callbacks re-check it before acting; if a newer trigger has
  -- overwritten it, their work is stale and discarded.
  local pending    = #clients
  local merged     = {}
  local emitted    = false
  local loading_emitted = false
  local start_time = vim.uv.hrtime()
  ctx.last_request_time = start_time

  local loading_timer

  local function close_loading_timer()
    if loading_timer and not loading_timer:is_closing() then
      pcall(loading_timer.close, loading_timer)
    end
    loading_timer = nil
  end

  local function emit_once(reason)
    if emitted then return end
    if ctx.last_request_time ~= start_time then return end
    emitted = true
    close_loading_timer()
    ctx.pending_requests = {}
    -- Soft-timeout path: best-effort emit. If LSP is the only source and
    -- nothing arrived in time, we still push buffer/TS so the user gets
    -- something. The `reason` arg is for diagnosis only.
    local _ = reason
    emit(ctx, merged)
  end

  -- Loading sentinel: when the LSP exceeds threshold_ms without
  -- responding, push a single "Loading…" item so the user gets feedback
  -- that something's in flight. The real emit later replaces this pum.
  -- Skipped entirely if cfg.opts.loading.enabled is false.
  local loading = cfg.opts.loading or {}
  if loading.enabled ~= false then
    local threshold = loading.threshold_ms or 150
    loading_timer = vim.defer_fn(function()
      if emitted or loading_emitted then return end
      if ctx.last_request_time ~= start_time then return end
      if not timing.cursor_still_valid(ctx) then return end
      loading_emitted = true
      local icons = cfg.opts.icons or {}
      vim.fn.complete(ctx.start_col, { {
        word  = '',
        abbr  = loading.label or 'Loading…',
        kind  = loading.icon or icons.default or '…',
        empty = 1,
        dup   = 1,
      } })
    end, threshold)
  end

  -- Soft timeout: emit whatever's gathered after timeout_ms even if some
  -- clients haven't answered. timing.reset_timer cancels this on next
  -- trigger; the generation token guards against stale fires that slip
  -- past close().
  ctx.completion_timer = vim.defer_fn(function() emit_once('timeout') end, timeout_ms)

  ---@diagnostic disable-next-line: unused-local
  sources.lsp(bufnr, ctx, function(_client_id, items, isIncomplete)
    if ctx.last_request_time ~= start_time then return end
    if emitted then return end
    -- compute_new_average is fed the per-client RTT sample; with multi-
    -- client setups this averages across all of them, which is fine —
    -- the EMA is just a debounce hint.
    local sample_ms = (vim.uv.hrtime() - start_time) * 0.000001
    timing.compute_new_average(ctx, sample_ms)
    ctx.isIncomplete = ctx.isIncomplete or (isIncomplete or false)
    for _, it in ipairs(items) do merged[#merged + 1] = it end
    pending = pending - 1
    if pending == 0 then
      timing.reset_timer(ctx)  -- cancels the soft-timeout timer
      emit_once('all_responded')
    end
  end)
end

-- Pre-trigger handler. Mirrors runtime on_insert_char_pre (1059-1102):
--   * if pum visible AND prior result was isIncomplete: re-trigger after
--     adaptive_debounce
--   * else if char is a trigger char for any client: 25ms libuv timer →
--     vim.schedule → trigger
--   * else: noop (TextChangedI or omnifunc handles the prefix path)
local function on_insert_char_pre(bufnr)
  local ctx = ctxs[bufnr]
  if not ctx then return end

  if vim.fn.pumvisible() ~= 0 then
    if ctx.isIncomplete then
      timing.reset_timer(ctx)
      local debounce = timing.adaptive_debounce(ctx)
      if debounce == 0 then
        vim.schedule(function() M.trigger(bufnr, 'incomplete') end)
      else
        ctx.completion_timer = vim.uv.new_timer()
        ctx.completion_timer:start(
          math.floor(debounce), 0,
          vim.schedule_wrap(function() M.trigger(bufnr, 'incomplete') end)
        )
      end
    end
    return
  end

  local char = vim.v.char
  local matched = (triggers_by_buf[bufnr] or {})[char]
  timing.reset_timer(ctx)
  if matched then
    local debounce_ms = (cfg.opts.debounce or {}).trigger_char_ms or 25
    ctx.completion_timer = vim.uv.new_timer()
    ctx.completion_timer:start(debounce_ms, 0, vim.schedule_wrap(function()
      timing.reset_timer(ctx)
      M.trigger(bufnr, 'trigger_char', char)
    end))
  end
end

local function on_insert_leave(bufnr)
  local ctx = ctxs[bufnr]
  if not ctx then return end
  timing.reset_timer(ctx)
  ctx.cursor       = nil
  ctx.isIncomplete = false
end

-- Prefix-based auto-trigger. InsertCharPre handles trigger characters; this
-- handles the "user typed N keyword chars" path that the plan describes.
-- 80ms debounce so rapid typing fires only the final keystroke. pum-visible
-- is a hard gate: if the menu is up, the InsertCharPre path's
-- isIncomplete logic owns re-triggering.
local PREFIX_MIN = 2
local function on_text_changed_i(bufnr)
  local ctx = ctxs[bufnr]
  if not ctx then return end
  if vim.fn.pumvisible() ~= 0 then return end
  if #current_prefix() < PREFIX_MIN then return end

  local debounce_ms = (cfg.opts.debounce or {}).text_changed_ms or 80

  timing.reset_timer(ctx)
  ctx.completion_timer = vim.uv.new_timer()
  ctx.completion_timer:start(debounce_ms, 0, vim.schedule_wrap(function()
    timing.reset_timer(ctx)
    M.trigger(bufnr, 'invoked')
  end))
end

-- Build/update the per-buffer trigger-char map by reading every attached
-- client's completionProvider.triggerCharacters. Idempotent: re-attach
-- merges new clients in.
local function refresh_triggers(bufnr)
  local map = triggers_by_buf[bufnr] or {}
  local clients = vim.lsp.get_clients({
    bufnr  = bufnr,
    method = 'textDocument/completion',
  })
  for _, client in ipairs(clients) do
    local chars = vim.tbl_get(
      client.server_capabilities,
      'completionProvider',
      'triggerCharacters'
    ) or {}
    for _, ch in ipairs(chars) do
      local list = map[ch] or {}
      local present = false
      for _, id in ipairs(list) do
        if id == client.id then present = true; break end
      end
      if not present then list[#list + 1] = client.id end
      map[ch] = list
    end
  end
  triggers_by_buf[bufnr] = map
end

-- `client` is part of the LSP on_attach contract; we look up clients via
-- vim.lsp.get_clients(bufnr) instead, so the param is unused but kept for
-- signature compatibility with lsp/utils/attach.lua.
---@param _client vim.lsp.Client
---@param bufnr integer
---@diagnostic disable-next-line: unused-local
function M.attach(_client, bufnr)
  bufnr = bufnr ~= 0 and bufnr or vim.api.nvim_get_current_buf()

  -- One-time per-buffer setup.
  local first = ctxs[bufnr] == nil
  ctxs[bufnr] = ctxs[bufnr] or timing.new_context(bufnr)

  -- Frecency core is module-singleton; safe to call every attach.
  require('completion.frecency').attach()

  refresh_triggers(bufnr)

  if first then
    local grp = autocmd.new_augroup(group_for(bufnr))
    autocmd.new_autocmd('InsertCharPre', grp, {
      buffer   = bufnr,
      callback = function() on_insert_char_pre(bufnr) end,
    })
    autocmd.new_autocmd('TextChangedI', grp, {
      buffer   = bufnr,
      callback = function() on_text_changed_i(bufnr) end,
    })
    autocmd.new_autocmd('InsertLeave', grp, {
      buffer   = bufnr,
      callback = function() on_insert_leave(bufnr) end,
    })
    -- CompleteDone (not CompleteDonePre), gated on reason='accept'.
    -- Mirrors runtime/lua/vim/lsp/completion.lua:939-946. CompleteDonePre
    -- fires while Vim's completion state machine is still finalizing —
    -- snippet text inserts via vim.snippet.expand, but the snippet
    -- session can't register tabstops, leaving vim.snippet.active() ==
    -- false. CompleteDone fires after settling, so the session engages.
    -- The reason gate skips dismissals (Esc, <C-e>, no selection) which
    -- carry an empty completed_item and would noop anyway.
    autocmd.new_autocmd('CompleteDone', grp, {
      buffer   = bufnr,
      callback = function()
        if (vim.v.event or {}).reason ~= 'accept' then return end
        local ctx_b = ctxs[bufnr]
        local ci = vim.v.completed_item or {}
        -- Diagnostic capture (disabled). Uncomment to expose the most
        -- recently accepted item on a buffer-local var, inspectable via:
        --   :lua print(vim.inspect(vim.b.last_completion_item))
        -- Useful when debugging snippet expansion or LSP item shape.
        -- vim.b[bufnr].last_completion_item = vim.deepcopy(ci)
        if ctx_b and not vim.tbl_isempty(ci) then
          require('completion.snippet').on_accept(ctx_b, ci)
        end
        require('completion.frecency').record_accept()
      end,
    })

    require('completion.docs').attach(bufnr)
    autocmd.new_autocmd('BufWipeout', grp, {
      buffer   = bufnr,
      callback = function()
        sources.invalidate_buffer(bufnr)
        M.detach(bufnr)
      end,
    })

    require('completion.keymaps').setup(bufnr)
  end
end

function M.detach(bufnr)
  bufnr = bufnr ~= 0 and bufnr or vim.api.nvim_get_current_buf()
  local ctx = ctxs[bufnr]
  if ctx then timing.reset_timer(ctx) end
  ctxs[bufnr] = nil
  triggers_by_buf[bufnr] = nil
  pcall(vim.api.nvim_del_augroup_by_name, group_for(bufnr))
end

return M
