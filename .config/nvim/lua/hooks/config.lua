local M = {}

local name = 'hooks.nvim'
local appendStar = false
local id = 0

M.getID = function()
	id = id + 1
	return id
end

M.get_name = function()
	return name
end

M.get_append_star = function()
	return appendStar
end

M.set_append_star = function(bool)
	if not (type(bool) == 'boolean') then
		appendStar = false
		return
	end

	appendStar = bool
end

return M
