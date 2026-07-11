local hooks = require('hooks.hooks')

-- *************[STARTUP]*************
-- set immediately after nvim started
-- (none atm)

local h = {
	-- *************[GLOBAL]*************
	['*'] = {
		['TextYankPost'] = {
			function() vim.hl.on_yank({ higroup = 'Todo', timeout = 1000 }) end,
		},
		-- Disabled: forcing `noexpandtab tabstop=2` on every `*` buffer breaks
		-- YAML (spec-illegal) and fights ftplugins on Python/JSON. Global
		-- `tabstop=2 shiftwidth=2` lives in `lua/settings.lua` instead; see
		-- `lua/pde/rules/ensure_tabstop.lua` for the full rationale.
		-- ['BufWinEnter'] = {
		-- 	require('pde.rules.ensure_tabstop'),
		-- },
		['BufEnter,FocusGained,InsertLeave'] = {
			require('pde.ui.line_numbers').show,
		},
		['BufLeave,FocusLost,InsertEnter'] = {
			require('pde.ui.line_numbers').hide,
		},
		['VimResized'] = {
			-- redraw on resize
			function() vim.api.nvim_command(":redraw!") end
		},
		['BufWritePre'] = {
			{
				-- ensure single trailing newline (trim trailing blanks;
				-- nvim fixeol adds the final \n on write)
				func = require('pde.rules.ensure_last_line'),
				order = 9999, -- default is 100
			},
		},
	},
	-- *************[GO]*************
	['*.go'] = {
		['BufWritePre'] = {
			function()
				require('pde.lang.go.format')()
			end,
		},
		['BufWritePost'] = {
			-- lint code and add to diagnostics (package-scoped; :GolintAll for module-wide)
			require('pde.lang.go.lint').run,
		}
	},
	-- *************[ZIG]*************
	-- ['*.zig,*.zir'] = {
	--	['BufWritePre'] = {
	--		function()
	--			require('pde.lang.zig.format')()
	--		end,
	--	},
	-- },
}

-- Three-level deep merge: { fileID → { event → { hook_entries } } }.
-- New fileIDs and events are added; matching ones get their hook lists
-- concatenated. We mutate `base` in place rather than deep-copying first —
-- `h` is the local table in this file, no other module holds a reference,
-- and the leaf entries (autocmd functions) would be expensive to clone for
-- no gain. If hook tables ever get shared across modules this needs to
-- become a deep copy.
local function merge_hooks(base, overlay)
	for fileID, events in pairs(overlay) do
		base[fileID] = base[fileID] or {}
		for event, hookList in pairs(events) do
			base[fileID][event] = base[fileID][event] or {}
			for _, hook in ipairs(hookList) do
				table.insert(base[fileID][event], hook)
			end
		end
	end
end

-- Profile-specific hook overlay: deep-merge `lua/hooks_<profile>.lua` (if it
-- exists) into the base tree. See README "Profiles".
local profile_name = require('profile').current
local overlay_path = vim.fn.stdpath('config') .. '/lua/hooks_' .. profile_name .. '.lua'
if vim.uv.fs_stat(overlay_path) then
	merge_hooks(h, require('hooks_' .. profile_name))
end

hooks.init(h)
