local M = {}

---add a new user command
---@param name string
---@param func string|function
---@param opts? vim.api.keyset.user_command
M.new_cmd = function(name, func, opts)
	vim.api.nvim_create_user_command(name, func, opts or {})
end

---add a new buffer-local user command (current buffer)
---@param name string
---@param func string|function
---@param opts? vim.api.keyset.user_command
M.new_buf_cmd = function(name, func, opts)
	vim.api.nvim_buf_create_user_command(0, name, func, opts or {})
end

---register a legacy :command!, useful for string-rhs-only registrations
---@param command string
---@param fn_string string
M.register_command = function(command, fn_string)
	vim.api.nvim_command('command! ' .. command .. ' ' .. fn_string)
end

return M
