-- Unified show/hide for line numbers.
-- Replaces modules/showLineNumbers.lua + modules/hideLineNumbers.lua.
-- No-ops on UI buffers (telescope, neogit, terminal, …) so hooks attached to
-- BufEnter/BufLeave don't clobber those windows' own line-number settings.

local buf = require('utils.ui_buffer')

local M = {}

M.show = function()
	if buf.is_ui_buffer(0) then return end
	vim.wo.number = true
	vim.wo.relativenumber = true
end

M.hide = function()
	if buf.is_ui_buffer(0) then return end
	vim.wo.number = false
	vim.wo.relativenumber = false
end

M.set = function(mode)
	if mode == 'show' then
		M.show()
	elseif mode == 'hide' then
		M.hide()
	end
end

return M
