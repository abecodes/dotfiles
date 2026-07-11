-- Insert-mode completion keymaps. Migrated from
-- lua/lsp/completion/completion.lua. The only behavioral change vs the
-- original: <C-n>'s manual-trigger branch dispatches to our aggregator
-- instead of vim.lsp.completion.trigger() because we own the pum now.

local M = {}

---@param lhs string
---@param rhs string|function
---@param opts string|table
---@param mode? string|string[]
local function keymap(bufnr, lhs, rhs, opts, mode)
  if type(opts) == 'string' then opts = { desc = opts } end
  opts.buffer = bufnr
  mode = mode or 'n'
  vim.keymap.set(mode, lhs, rhs, opts)
end

local function feedkeys(keys)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, false, true), 'n', true)
end

local function pumvisible()
  return tonumber(vim.fn.pumvisible()) ~= 0
end

---@param bufnr integer
function M.setup(bufnr)
  bufnr = bufnr ~= 0 and bufnr or vim.api.nvim_get_current_buf()

  -- <CR>: accept the highlighted pum item, else close the pum (if open
  -- with no selection) and still insert the newline. `<C-y>` alone
  -- confirms a selection but is a no-op-then-swallow when nothing is
  -- selected, so that case needs an explicit `<C-e><CR>`.
  keymap(bufnr, '<cr>', function()
    if not pumvisible() then return '<cr>' end
    local selected = vim.fn.complete_info({ 'selected' }).selected
    return selected ~= -1 and '<C-y>' or '<C-e><cr>'
  end, { expr = true }, 'i')

  -- /: dismiss pum and insert the slash. `<C-e>` alone would close the
  -- pum but swallow the typed `/`, so it must be re-emitted.
  keymap(bufnr, '/', function()
    return pumvisible() and '<C-e>/' or '/'
  end, { expr = true }, 'i')

  -- <C-n>: cycle pum, else trigger our aggregator, else fall back to
  -- omnifunc / built-in keyword completion.
  keymap(bufnr, '<C-n>', function()
    if pumvisible() then
      feedkeys('<C-n>')
    else
      if next(vim.lsp.get_clients({ bufnr = 0 })) then
        require('completion.aggregator').trigger(0, 'invoked')
      else
        if vim.bo.omnifunc == '' then
          feedkeys('<C-x><C-n>')
        else
          feedkeys('<C-x><C-o>')
        end
      end
    end
  end, 'Trigger/select next completion', 'i')

  -- Buffer-keyword completion.
  keymap(bufnr, '<C-u>', '<C-x><C-n>', { desc = 'Buffer completions' }, 'i')

  -- <C-h> / <C-l>: snippet placeholder navigation. Bound in n + i + s so
  -- the session is reachable after <Esc> drops the user from select
  -- mode into normal mode (the extmarks persist, only the mode changed).
  -- <Tab> is reserved for tabout.nvim. When no snippet session is active
  -- these fall through to default <C-h> (= <BS> = cursor-left) / <C-l>
  -- (= redraw) so the keys remain useful outside snippets.
  keymap(bufnr, '<C-h>', function()
    if vim.snippet.active({ direction = 1 }) then
      vim.snippet.jump(1)
    else
      feedkeys('<BS>')
    end
  end, {}, { 'n', 'i', 's' })

  keymap(bufnr, '<C-l>', function()
    if vim.snippet.active({ direction = -1 }) then
      vim.snippet.jump(-1)
    else
      feedkeys('<C-l>')
    end
  end, {}, { 'n', 'i', 's' })

  -- Inside a snippet, <BS> removes the placeholder selection cleanly
  -- (drop selection, enter insert mode at the placeholder start).
  keymap(bufnr, '<BS>', '<C-o>s', {}, 's')
end

return M
