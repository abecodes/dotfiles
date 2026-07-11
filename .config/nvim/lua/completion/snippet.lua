-- Post-accept handling for LSP completion items. Mirrors runtime
-- on_complete_done's apply_snippet path (lines 838-929 of
-- runtime/lua/vim/lsp/completion.lua) and adds the auto-import bits the
-- runtime handles via apply_text_edits.
--
-- The pum has already inserted item.word at the keyword start by the
-- time CompleteDonePre fires. Three things may need to happen on top:
--   1. textEdit / snippet: replace the inserted word with the LSP's
--      authoritative newText, expanding placeholders if it's a snippet.
--   2. additionalTextEdits: apply unrelated edits (canonically: import
--      statements). gopls/rust-analyzer return these alongside symbols
--      from unimported packages — without applying, the buffer is left
--      in a broken state until the user runs a code action.
--   3. command: server-driven post-accept side effect (rare).

local protocol = require('vim.lsp.protocol')
local InsertTextFormat = protocol.InsertTextFormat

local M = {}

-- DO NOT pre-parse the snippet body. Earlier this called
-- vim.lsp._snippet_grammar.parse(input) and passed tostring(result) to
-- vim.snippet.expand — but tostring on the parsed AST returns the
-- *rendered* form (placeholders replaced with their default text), so
-- expand saw no `${1:...}` markers and never started a snippet session.
-- The text inserted but vim.snippet.active() stayed false.
-- vim.snippet.expand parses LSP snippet syntax natively; pass it raw.
-- Mirrors the runtime apply_snippet at
-- runtime/lua/vim/lsp/completion.lua:163-167.

-- Compute the byte range (start_row, start_col, end_row, end_col) the
-- pum just inserted: from ctx.cursor[1]/ctx.start_col snapshot at trigger
-- time to the live cursor right now. Returns nil when the snapshot is
-- missing or the live cursor lies before the snapshot (defensive — the
-- aggregator's cursor_still_valid check should already have gated this,
-- but CompleteDonePre runs in a different code path).
local function inserted_range(ctx)
  if not ctx.cursor or not ctx.start_col then return nil end
  local row, col = unpack(vim.api.nvim_win_get_cursor(0))
  local start_row = ctx.cursor[1] - 1
  local start_col_b = ctx.start_col - 1
  local end_row = row - 1
  local end_col = col
  if start_row < 0 or end_row < start_row
     or (end_row == start_row and end_col < start_col_b)
  then
    return nil
  end
  return start_row, start_col_b, end_row, end_col
end

-- Replace the just-inserted pum word with newText. Uses nvim_buf_set_text
-- (atomic byte-range replacement) instead of delete-then-put so the
-- cursor lands at the end of newText cleanly. Returns true on success.
local function replace_inserted(ctx, newText)
  local sr, sc, er, ec = inserted_range(ctx)
  if not sr then return false end
  local lines = vim.split(newText, '\n', { plain = true })
  local ok = pcall(vim.api.nvim_buf_set_text, ctx.bufnr, sr, sc, er, ec, lines)
  return ok
end

---Apply textEdit / snippet expansion / additionalTextEdits / command for
---a just-accepted LSP item. Returns true if anything happened.
---@param ctx table              aggregator per-buffer trigger context
---@param completed_item table   v:completed_item shape
---@return boolean
function M.on_accept(ctx, completed_item)
  if not completed_item or vim.tbl_isempty(completed_item) then return false end
  local lsp = vim.tbl_get(completed_item, 'user_data', 'nvim', 'lsp')
  if not lsp then return false end

  local item = lsp.completion_item
  if not item then return false end

  local client_id = lsp.client_id
  local client    = client_id and vim.lsp.get_client_by_id(client_id)
  local encoding  = (client and client.offset_encoding) or 'utf-16'

  local touched = false
  local is_snippet     = item.insertTextFormat == InsertTextFormat.Snippet
  local has_text_edit  = item.textEdit and item.textEdit.newText ~= nil

  if is_snippet then
    -- Snippet: pum inserted the literal label. Replace the inserted
    -- range with an empty string, then expand the snippet at the cursor
    -- so vim.snippet places tabstops correctly.
    local insert_text = (item.textEdit and item.textEdit.newText) or item.insertText
    if insert_text and replace_inserted(ctx, '') then
      vim.snippet.expand(insert_text)
      touched = true
    end
  elseif has_text_edit then
    -- Non-snippet textEdit: the LSP wants the insert range replaced with
    -- newText. Simplistic strategy — assume the textEdit's range matches
    -- the keyword range we just inserted into; replace and we're done.
    -- A pathological LSP that returns a textEdit spanning unrelated
    -- ranges would mis-edit; that's rare enough to defer.
    if replace_inserted(ctx, item.textEdit.newText) then
      touched = true
    end
  end

  -- additionalTextEdits — auto-imports etc. Applied AFTER any primary
  -- replacement so an import added at the top of the file doesn't shift
  -- the cursor we just landed at the end of the snippet. The canonical
  -- helper handles ranges in the LSP's offset encoding.
  if item.additionalTextEdits and #item.additionalTextEdits > 0 then
    pcall(vim.lsp.util.apply_text_edits,
      item.additionalTextEdits, ctx.bufnr, encoding)
    touched = true
  end

  -- Item command — synchronous-only; async edits would race the cursor.
  if client and item.command then
    pcall(client.exec_cmd, client, item.command, { bufnr = ctx.bufnr })
    touched = true
  end

  return touched
end

-- Backwards-compat alias for the prior name; aggregator currently calls
-- expand_if_snippet. Keep working until we update the call site below.
M.expand_if_snippet = M.on_accept

return M
