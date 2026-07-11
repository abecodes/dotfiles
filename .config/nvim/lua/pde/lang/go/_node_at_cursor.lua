local ts_nodes = require('pde.lang.go._ts_nodes')
local logger   = require('logger')

---run a treesitter query at `(row, col)` and return the innermost match.
---shared by impl.lua (struct lookup) and tests.lua (func/method lookup).
---@param query string
---@param bufnr integer|nil
---@param row integer
---@param col integer
---@param not_found_msg string logger.debug message when nothing matches
---@return table|nil
return function(query, bufnr, row, col, not_found_msg)
	local bufn = bufnr or vim.api.nvim_get_current_buf()
	local ns   = ts_nodes.nodes_at_cursor(query, bufn, row, col)
	if ns == nil then
		logger.debug(not_found_msg)
		return nil
	end
	return ns[#ns]
end
