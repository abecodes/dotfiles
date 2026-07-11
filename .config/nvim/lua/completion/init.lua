-- Public surface for the completion stack. Delegates to aggregator.
local M = {}

---@param opts table?  see lua/completion/config.lua for the schema
function M.setup(opts)
  require('completion.config').merge(opts)

  -- 'popup'   = side panel for completionItem/resolve docs
  -- 'menuone' = show pum even with a single match
  -- 'noselect'= require explicit pick via <C-n>/<Tab>
  -- 'fuzzy'   = pum filters non-prefix-but-ordered matches as the user types
  local co = vim.opt.completeopt:get()
  local want = { 'menuone', 'noselect', 'popup', 'fuzzy' }
  for _, flag in ipairs(want) do
    if not vim.tbl_contains(co, flag) then
      vim.opt.completeopt:append(flag)
    end
  end
end

---@param client vim.lsp.Client
---@param bufnr integer
function M.attach(client, bufnr)
  M.setup()
  require('completion.aggregator').attach(client, bufnr)
end

function M.detach(bufnr)
  require('completion.aggregator').detach(bufnr)
end

return M
