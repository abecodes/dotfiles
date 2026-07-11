-- Bridge between neovim keymap `desc` fields and vim-which-key's
-- `g:which_key_map` / `g:which_key_map_visual` dicts. Rebuilt on every
-- `<leader>` press so lazy-loaded plugins' mappings show up as soon as
-- they register.
--
-- Leaf rhs is always `leader .. rest` — vim-which-key feeds those keys
-- back and the real `noremap` keymap executes. Matches the pattern the
-- hand-maintained tables already used (e.g. `{',tb', 'desc'}`).

local M = {}

-- Prefix-path → group heading. Only the paths you want a specific
-- name for; anything else falls back to `'+' .. path`.
local GROUPS = {
	d  = '+debug',
	dc = '+commands',
	p  = '+PDE',
	r  = '+replace/refactor',
	t  = '+telescope',
	x  = '+trouble',
	z  = '+zettel',
}

local function group_node(path)
	return { name = GROUPS[path] or ('+' .. path) }
end

---@param mode 'n' | 'v'
---@return table
local function build(mode)
	local leader = vim.g.mapleader or '\\'
	local llen   = #leader

	-- Collect leader-prefixed entries with a non-empty desc.
	local entries = {}
	for _, m in ipairs(vim.api.nvim_get_keymap(mode)) do
		if m.lhs:sub(1, llen) == leader and m.desc and m.desc ~= '' then
			local rest = m.lhs:sub(llen + 1)
			if rest ~= '' then
				entries[#entries + 1] = { rest = rest, desc = m.desc }
			end
		end
	end

	-- Shorter prefixes land before their children so a single-char
	-- leaf (e.g. <leader>z) can be migrated to `[' ']` when a deeper
	-- mapping (<leader>zf) arrives.
	table.sort(entries, function(a, b) return #a.rest < #b.rest end)

	local root = {}
	for _, e in ipairs(entries) do
		local rhs = leader .. e.rest
		local cur = root
		for i = 1, #e.rest - 1 do
			local ch     = e.rest:sub(i, i)
			local path   = e.rest:sub(1, i)
			local existing = cur[ch]
			if type(existing) ~= 'table' or not existing.name then
				local group = group_node(path)
				-- Preserve a previously-seen single-char leaf as the
				-- group's bare trigger (widget shows it under ` `).
				if type(existing) == 'table' then group[' '] = existing end
				cur[ch] = group
			end
			cur = cur[ch]
		end
		local last = e.rest:sub(#e.rest)
		local node = cur[last]
		if type(node) == 'table' and node.name then
			-- Existing group; the new entry is the bare trigger for
			-- this prefix.
			node[' '] = { rhs, e.desc }
		else
			cur[last] = { rhs, e.desc }
		end
	end

	return root
end

function M.rebuild()
	vim.g.which_key_map        = build('n')
	vim.g.which_key_map_visual = build('v')
end

return M
