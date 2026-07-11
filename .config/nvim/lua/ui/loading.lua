local float = require('ui.float')

local M = {}

---Show a small centered floating window with a message. Returns a function
---that closes the window when called (idempotent).
---@param message string
---@return fun()
M.show = function(message)
  local text = '  ' .. message .. '  '

  local buf = float.scratch_buf()
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, { text })

  local width    = #text
  local height   = 1
  local row, col = float.center(width, height)
  local win = vim.api.nvim_open_win(buf, false, {
    relative  = 'editor',
    width     = width,
    height    = height,
    row       = row,
    col       = col,
    style     = 'minimal',
    border    = float.border(),
    focusable = false,
    zindex    = 200,
  })

  local closed = false
  return function()
    if closed then return end
    closed = true
    pcall(vim.api.nvim_win_close, win, true)
  end
end

return M
