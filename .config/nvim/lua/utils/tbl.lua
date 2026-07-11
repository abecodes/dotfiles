local M = {}

---coerce a value into a list: strings become { str }, tables pass through,
---nil becomes {}.
---@generic T
---@param v T|T[]|nil
---@return T[]
M.as_list = function(v)
	if v == nil then return {} end
	if type(v) == 'table' then return v end
	return { v }
end

return M
