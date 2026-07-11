local M = {}
local fw = require('notes.framework')

local function open_with_insert(filepath, opts)
  local win = fw.open_float(filepath, opts)
  vim.cmd('startinsert')
  vim.api.nvim_create_autocmd('WinClosed', {
    pattern  = tostring(win),
    once     = true,
    callback = function()
      vim.schedule(function() vim.cmd('stopinsert') end)
    end,
  })
end

function M.open_branch()
  open_with_insert(fw.get_branch_file('.md'), { title = ' Branch Notes ' })
end

function M.open_project()
  open_with_insert(fw.get_project_file('.md'), { title = ' Project Notes ' })
end

return M
