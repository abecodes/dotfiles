-- Treesitter-based cursor breadcrumb. Replaces nvim-navic for winbar.gps.
--
-- Walks parents from the cursor's node, emitting an icon + name for each
-- container-scope node (function, method, class, struct, enum, module,
-- markdown heading). Language-agnostic through common node-type names;
-- unknown types are skipped so the walk just passes through.

local ICONS   = require('winbar.icons')
local autocmd = require('utils.autocmd')

local M = {}

-- Node types recognised as container scopes + their icon.
local KIND = {
	-- functions / methods
	function_declaration   = ICONS.crumb_function,
	function_definition    = ICONS.crumb_function,
	function_item          = ICONS.crumb_function,
	local_function         = ICONS.crumb_function,
	method_declaration     = ICONS.crumb_method,
	method_definition      = ICONS.crumb_method,
	-- classes / structs
	class_declaration      = ICONS.crumb_class,
	class_definition       = ICONS.crumb_class,
	struct_item            = ICONS.crumb_class,
	struct_type            = ICONS.crumb_class,
	type_declaration       = ICONS.crumb_class,
	type_spec              = ICONS.crumb_class,
	-- interfaces / impls
	interface_declaration  = ICONS.crumb_interface,
	interface_type         = ICONS.crumb_interface,
	impl_item              = ICONS.crumb_interface,
	trait_item             = ICONS.crumb_interface,
	-- enums
	enum_declaration       = ICONS.crumb_enum,
	enum_item              = ICONS.crumb_enum,
	-- modules / namespaces
	mod_item               = ICONS.crumb_module,
	module_definition      = ICONS.crumb_module,
	namespace_definition   = ICONS.crumb_module,
	-- markdown
	atx_heading            = ICONS.crumb_heading,
	setext_heading         = ICONS.crumb_heading,
}

local IDENT_TYPES = {
	identifier        = true,
	type_identifier   = true,
	field_identifier  = true,
}

local function node_name(node, bufnr)
	local f = node:field('name')
	local name_node = f and f[1]
	if not name_node then
		for child in node:iter_children() do
			if IDENT_TYPES[child:type()] then
				name_node = child
				break
			end
		end
	end
	if not name_node then return nil end
	local ok, txt = pcall(vim.treesitter.get_node_text, name_node, bufnr)
	if not ok or not txt or txt == '' then return nil end
	return (txt:gsub('\n.*', ''))
end

local function heading_text(node, bufnr)
	local ok, txt = pcall(vim.treesitter.get_node_text, node, bufnr)
	if not ok or not txt then return nil end
	return (txt:gsub('^#+%s*', ''):gsub('\n.*', ''))
end

-- Single-slot per-window cache keyed by (bufnr, changedtick, row, sep).
-- CursorMoved fires on every horizontal motion too — without this, each
-- keystroke pays for a treesitter node walk even when the crumb cannot have
-- changed. Keyed by winid (not bufnr) so two windows showing the same buffer
-- at different rows stay correct.
local cache = {}

do
	local grp = autocmd.new_augroup('winbar_breadcrumb_cache')
	autocmd.new_autocmd('WinClosed', grp, {
		callback = function(a) cache[tonumber(a.match)] = nil end,
	})
end

---Render the cursor breadcrumb for `bufnr` in `winid`. Returns '' when no
---parser is available or no container nodes were found on the path. `winid`
---is the window being drawn (winbar is per-window); falls back to the
---focused window when omitted so direct callers still work.
---@param bufnr? integer
---@param sep? string
---@param winid? integer
---@return string
function M.render(bufnr, sep, winid)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	sep   = sep or ' > '
	winid = winid or vim.api.nvim_get_current_win()

	local cursor = vim.api.nvim_win_get_cursor(winid)
	local row, col = cursor[1], cursor[2]
	local tick  = vim.api.nvim_buf_get_changedtick(bufnr)
	local c     = cache[winid]
	if c and c.bufnr == bufnr and c.tick == tick and c.row == row and c.sep == sep then
		return c.value
	end

	local function store(value)
		cache[winid] = { bufnr = bufnr, tick = tick, row = row, sep = sep, value = value }
		return value
	end

	local ok, parser = pcall(vim.treesitter.get_parser, bufnr)
	if not ok or not parser then return store('') end
	-- Make sure the tree reflects current buffer state. No-op if already
	-- up to date, so safe to call on every redraw.
	parser:parse()
	-- pos is required when bufnr != current buffer (e.g. rendering an
	-- inactive split's winbar); passing it always keeps both paths correct.
	local node = vim.treesitter.get_node({ bufnr = bufnr, pos = { row - 1, col } })
	if not node then return store('') end

	local crumbs = {}
	while node do
		local icon = KIND[node:type()]
		if icon then
			local t = node:type()
			local name
			if t == 'atx_heading' or t == 'setext_heading' then
				name = heading_text(node, bufnr)
			else
				name = node_name(node, bufnr)
			end
			if name and name ~= '' then
				table.insert(crumbs, 1, icon .. ' ' .. name)
			end
		end
		node = node:parent()
	end

	return store(#crumbs == 0 and '' or table.concat(crumbs, sep))
end

return M
