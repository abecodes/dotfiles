-- Three completion sources. All items conform to vim.fn.complete()'s
-- |complete-items| shape. The aggregator merges across sources and
-- dedupes by `word` with LSP winning on conflict.

local M = {}

local protocol = require('vim.lsp.protocol')
local InsertTextFormat = protocol.InsertTextFormat

-- Truncate `s` to a max display width using cell-count, append U+2026 (…)
-- when truncated. strcharpart trims by chars (not bytes) for multi-byte
-- safety. Width 0 / negative disables.
local function trunc(s, max)
  if not max or max <= 0 then return s end
  if vim.fn.strdisplaywidth(s) <= max then return s end
  return vim.fn.strcharpart(s, 0, max - 1) .. '…'
end

-- Read the relevant max from config on every call so post-attach setup()
-- changes take effect immediately.
local function truncate_label(s)
  return trunc(s, require('completion.config').opts.max_label)
end

local function truncate_menu(s)
  return trunc(s, require('completion.config').opts.max_menu)
end

-- Compact kind labels. Single-letter for non-LSP sources, full names for
-- LSP-driven items (matches what users expect from a real LSP popup).
local LSP_KIND_LABEL = {}
for k, idx in pairs(protocol.CompletionItemKind) do
  if type(idx) == 'number' then
    LSP_KIND_LABEL[idx] = k
  end
end

-- Pull the documentation string out of an LSP CompletionItem.
-- documentation may be a string or { kind, value }.
local function doc_to_info(doc)
  if not doc then return '' end
  if type(doc) == 'string' then return doc end
  if type(doc) == 'table' and type(doc.value) == 'string' then return doc.value end
  return ''
end

---@param item lsp.CompletionItem
---@param client_id integer
local function lsp_item_to_complete(item, client_id)
  -- Word selection priority:
  --   1. filterText  — explicit "match against this" from the LSP. Some
  --      servers (emmet, path-completion, snippet-heavy gopls) put a
  --      stable matchable token here while the label carries the full
  --      signature. Honoring filterText fixes both pum filtering and
  --      snippet-item word stability (label might be `Println(args ...)`,
  --      filterText would be `Println`).
  --   2. snippet items: fall back to label so the user has SOMETHING to
  --      match against. snippet.lua replaces the inserted text on accept.
  --   3. plain items: insertText if present, else label.
  -- LSP spec requires `label` so it's always present in well-behaved
  -- servers; the '' default is defensive against malformed items.
  -- Locals capture the optional fields up-front so lua_ls narrows them.
  local filter_text = item.filterText
  local insert_text = item.insertText
  local label       = item.label

  local word
  if filter_text ~= nil and filter_text ~= '' then
    word = filter_text
  elseif item.insertTextFormat == InsertTextFormat.Snippet then
    word = label or ''
  else
    word = insert_text or label or ''
  end
  -- word may be multi-line for some servers; vim.fn.complete() expects
  -- single-line. Take the first line.
  word = word:match('([^\r\n]*)') or word

  return {
    word      = word,
    abbr      = truncate_label(item.label or ''),
    menu      = truncate_menu(item.detail or ''),
    kind      = LSP_KIND_LABEL[item.kind] or '',
    info      = doc_to_info(item.documentation),
    icase     = 1,
    dup       = 1,
    empty     = 1,
    user_data = {
      nvim = {
        lsp = {
          client_id       = client_id,
          completion_item = item,
        },
      },
    },
  }
end

-- Async LSP gather. on_partial(client_id, items, isIncomplete) fires once
-- per responding client. Cancel handles are appended to ctx.pending_requests
-- so timing.reset_timer can drain them.
---@param bufnr integer
---@param ctx table             -- timing context
---@param on_partial fun(client_id: integer, items: table[], isIncomplete: boolean)
function M.lsp(bufnr, ctx, on_partial)
  local clients = vim.lsp.get_clients({
    bufnr  = bufnr,
    method = 'textDocument/completion',
  })
  if #clients == 0 then return end

  for _, client in ipairs(clients) do
    local params = vim.lsp.util.make_position_params(0, client.offset_encoding)
    local ok, request_id = client:request(
      'textDocument/completion',
      params,
      vim.schedule_wrap(function(err, result)
        if err or not result then
          on_partial(client.id, {}, false)
          return
        end
        local items = result.items or result
        local isIncomplete = type(result) == 'table' and result.isIncomplete or false
        local converted = {}
        for _, item in ipairs(items) do
          converted[#converted + 1] = lsp_item_to_complete(item, client.id)
        end
        on_partial(client.id, converted, isIncomplete)
      end),
      bufnr
    )
    if ok and request_id then
      local cid = client.id
      local rid = request_id
      ctx.pending_requests[#ctx.pending_requests + 1] = function()
        local c = vim.lsp.get_client_by_id(cid)
        if c then c:cancel_request(rid) end
      end
    end
  end
end

-- ---------------------------------------------------------------------------
-- Per-buffer scan caches (buffer-words and TS identifiers).
-- ---------------------------------------------------------------------------
-- Both caches are keyed by changedtick. Walking a 10k-line buffer on every
-- keystroke is wasteful; changedtick is a monotonic per-buffer counter
-- that bumps on any edit, so a tick-versioned cache is invalidated
-- automatically by Vim's edit machinery — no autocmd plumbing needed.
-- Cleared on BufWipeout via M.invalidate_buffer (called from aggregator).
local buffer_cache = {}  -- bufnr -> { words = list, version = changedtick }
local ts_cache     = {}  -- bufnr -> { words = list, version = changedtick }

local function scan_buffer_words(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local words = {}
  local seen = {}
  for _, line in ipairs(lines) do
    for w in line:gmatch('[%w_]+') do
      if #w >= 3 and not seen[w] then
        seen[w] = true
        words[#words + 1] = w
      end
    end
  end
  return words
end

local function buffer_words_for(bufnr)
  local tick = vim.api.nvim_buf_get_changedtick(bufnr)
  local entry = buffer_cache[bufnr]
  if entry and entry.version == tick then
    return entry.words
  end
  local words = scan_buffer_words(bufnr)
  buffer_cache[bufnr] = { words = words, version = tick }
  return words
end

-- Enumerate the buffer set to scan based on cfg.opts.sources.buffer_scope.
-- 'current'    → current buffer only.
-- 'all_loaded' → every loaded + listed buffer; current buffer first so its
--                words rank ahead of cross-file ones at equal frecency.
local function buffers_in_scope(current_bufnr)
  local scope = (require('completion.config').opts.sources or {}).buffer_scope or 'all_loaded'
  if scope == 'current' then return { current_bufnr } end

  local out = { current_bufnr }
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if b ~= current_bufnr
       and vim.api.nvim_buf_is_loaded(b)
       and vim.fn.buflisted(b) == 1
    then
      out[#out + 1] = b
    end
  end
  return out
end

-- Buffer-words across the configured scope. Drops the prefix itself,
-- words < 3 chars, and words that don't case-insensitive-prefix-match
-- the snapshotted prefix. The prefix filter is critical: without it,
-- every keyword in every loaded buffer would flood the pum.
---@param bufnr integer
---@param prefix string
function M.buffer_words(bufnr, prefix)
  local seen = {}
  if prefix and prefix ~= '' then seen[prefix] = true end

  local has_prefix   = prefix ~= nil and prefix ~= ''
  local prefix_lower = has_prefix and prefix:lower() or nil
  local prefix_len   = has_prefix and #prefix or 0

  local out = {}
  for _, b in ipairs(buffers_in_scope(bufnr)) do
    local words = buffer_words_for(b)
    for _, w in ipairs(words) do
      if not seen[w] then
        if (not has_prefix) or w:sub(1, prefix_len):lower() == prefix_lower then
          seen[w] = true
          out[#out + 1] = {
            word  = w,
            abbr  = truncate_label(w),
            kind  = 'Buffer',
            menu  = '',
            icase = 1,
            dup   = 0,
          }
        end
      end
    end
  end
  return out, seen
end

---Drop both caches for a buffer. Called from BufWipeout via the
---aggregator to avoid leaking entries across the session.
---@param bufnr integer
function M.invalidate_buffer(bufnr)
  buffer_cache[bufnr] = nil
  ts_cache[bufnr]     = nil
end

-- ---------------------------------------------------------------------------
-- Treesitter identifiers source.
-- ---------------------------------------------------------------------------
local TS_NODE_TYPES = {
  identifier          = true,
  type_identifier     = true,
  field_identifier    = true,
  property_identifier = true,
}

local function scan_ts_identifiers(bufnr)
  local ok, parser = pcall(vim.treesitter.get_parser, bufnr)
  if not ok or not parser then return nil end
  local trees = parser:parse()
  if not trees then return nil end

  local words = {}
  local seen = {}
  for _, tree in ipairs(trees) do
    -- Iterative DFS — recursive walk on a 10k-line buffer's TS tree
    -- pushes Lua's call stack hard. Stack of nodes, no recursion.
    local stack = { tree:root() }
    while #stack > 0 do
      local node = table.remove(stack)
      if TS_NODE_TYPES[node:type()] then
        local text_ok, text = pcall(vim.treesitter.get_node_text, node, bufnr)
        if text_ok and text and #text >= 3 and not seen[text] and not text:find('\n') then
          seen[text] = true
          words[#words + 1] = text
        end
      end
      for i = node:child_count() - 1, 0, -1 do
        stack[#stack + 1] = node:child(i)
      end
    end
  end
  return words
end

local function ts_identifiers_for(bufnr)
  local tick = vim.api.nvim_buf_get_changedtick(bufnr)
  local entry = ts_cache[bufnr]
  if entry and entry.version == tick then
    return entry.words
  end
  local words = scan_ts_identifiers(bufnr)
  if words == nil then
    -- No parser: cache an empty list to avoid retrying pcall on every trigger.
    -- Invalidates on next edit (changedtick bump) so a parser installed
    -- mid-session starts being scanned.
    ts_cache[bufnr] = { words = {}, version = tick }
    return {}
  end
  ts_cache[bufnr] = { words = words, version = tick }
  return words
end

---@param bufnr integer
---@param prefix string
---@param dedup table<string, true>?
function M.ts_identifiers(bufnr, prefix, dedup)
  local words = ts_identifiers_for(bufnr)
  if #words == 0 then return {} end

  local seen = dedup or {}
  if prefix and prefix ~= '' then seen[prefix] = true end

  local has_prefix   = prefix ~= nil and prefix ~= ''
  local prefix_lower = has_prefix and prefix:lower() or nil
  local prefix_len   = has_prefix and #prefix or 0

  local out = {}
  for _, text in ipairs(words) do
    if not seen[text] then
      if (not has_prefix) or text:sub(1, prefix_len):lower() == prefix_lower then
        seen[text] = true
        out[#out + 1] = {
          word  = text,
          abbr  = truncate_label(text),
          kind  = 'Treesitter',
          menu  = '',
          icase = 1,
          dup   = 0,
        }
      end
    end
  end
  return out
end

return M
