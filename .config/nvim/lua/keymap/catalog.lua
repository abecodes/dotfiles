local M = {}

---@class keymap.catalog.Item
---@field lhs string         human-readable lhs as returned by nvim_get_keymap
---@field lhsraw string      byte-form lhs (already termcode-replaced)
---@field desc string        non-empty description
---@field source 'global'|'buffer'

---map originating mode to the API mode argument for nvim_get_keymap.
---@param originating_mode string
---@return string
local function api_mode_for(originating_mode)
	if originating_mode == 'n' then return 'n' end
	if originating_mode == 'v' or originating_mode == 'V' or originating_mode == '\22' then
		return 'x'
	end
	error("keymap.catalog: unsupported originating_mode " .. vim.inspect(originating_mode))
end

---ingest one row from nvim_get_keymap / nvim_buf_get_keymap into the index/order pair.
---rows whose desc is nil or empty are dropped. on lhs collision, the new row replaces
---the existing one without disturbing its position in `order` (buffer-overwrites-global).
---@param row table
---@param source 'global'|'buffer'
---@param index table<string, integer>  lhs -> position in `order`
---@param order keymap.catalog.Item[]
local function ingest(row, source, index, order)
	local desc = row.desc
	if desc == nil or desc == '' then return end
	local item = {
		lhs = row.lhs,
		lhsraw = row.lhsraw or row.lhs,
		desc = desc,
		source = source,
	}
	local pos = index[row.lhs]
	if pos == nil then
		order[#order + 1] = item
		index[row.lhs] = #order
	else
		order[pos] = item
	end
end

---rebuild the keymap catalog snapshot for the given originating mode.
---pure read: calls nvim_get_keymap and nvim_buf_get_keymap only.
---@param originating_mode 'n'|'v'|'V'|'\22'
---@return keymap.catalog.Item[]
M.snapshot = function(originating_mode)
	local api_mode = api_mode_for(originating_mode)
	local index = {}
	local order = {}
	for _, row in ipairs(vim.api.nvim_get_keymap(api_mode)) do
		ingest(row, 'global', index, order)
	end
	for _, row in ipairs(vim.api.nvim_buf_get_keymap(0, api_mode)) do
		ingest(row, 'buffer', index, order)
	end
	return order
end

return M
