local hooks = require('hooks.hooks')

-- *************[STARTUP]*************
-- set immediately after nvim started
-- (none atm)

local h = {
	-- *************[GLOBAL]*************
	['*'] = {
		-- ['BufNew,BufWinEnter'] = {
		['BufWinEnter'] = {
			-- initial calls are in nvim/after/ftplugin/<filetype>.lua
			require('modules.ensureTabstop'),
		},
		['BufEnter,FocusGained,InsertLeave'] = {
			require('modules.showLineNumbers'),
		},
		['BufLeave,FocusLost,InsertEnter'] = {
			require('modules.hideLineNumbers'),
		},
		['VimResized'] = {
			-- redraw on resize
			function() vim.api.nvim_command(":redraw!") end
		},
		-- ['BufWritePre'] = {
		-- 	{
		-- 		-- ensure empty last line on each file
		-- 		func = require('modules.ensureLastLine'),
		-- 		order = 9999, -- default is 100
		-- 	},
		-- },
	},
	-- *************[GO]*************
	['*.go'] = {
		['BufWritePre'] = {
			-- {
			-- 	-- ensure the fileheader is set before we write the file
			-- 	func = require('modules.addHeader')('// abe.codes was here'),
			-- 	order = 99,
			-- },
			function()
				require('modules.go.format')()
			end,
		},
		['BufWritePost'] = {
			-- lint code and add to diagnostics
			require('modules.go.lint'),
		}
	},
}

hooks.init(h)
