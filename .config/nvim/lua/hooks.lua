local hooks = require('hooks.hooks')

local h = {
	-- *************[GLOBAL]*************
	['*'] = {
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
		['BufWritePre'] = {
			{
				-- ensure empty last line on each file
				func = require('modules.ensureLastLine'),
				order = 9999, -- default is 100
			},
		},
	},
	-- *************[GO]*************
	['*.go'] = {
		['BufWritePre'] = {
			-- {
			-- 	-- ensure the fileheader is set before we write the file
			-- 	func = require('modules.addHeader')('// abe.codes was here'),
			-- 	order = 99,
			-- },
			-- break lines if they are to long
			-- includes gofumpt
			require('modules.go.breakLines'),
		},
		['BufWritePost'] = {
			-- lint code and add to diagnostics
			require('modules.go.lint'),
		}
	},
}

hooks.init(h)
