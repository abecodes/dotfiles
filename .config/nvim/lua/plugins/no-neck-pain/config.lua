require('no-neck-pain').setup({
	autocmds = {
		-- When `true`, enables the plugin when you start Neovim.
		-- If the main window is  a side tree (e.g. NvimTree) or a dashboard, the command is delayed until it finds a valid window.
		-- The command is cleaned once it has successfuly ran once.
		--- @type boolean
		enableOnVimEnter = false,
		-- When `true`, enables the plugin when you enter a new Tab.
		-- note: it does not trigger if you come back to an existing tab, to prevent unwanted interfer with user's decisions.
		--- @type boolean
		enableOnTabEnter = false,
	},
	buffers = {
		colors = {
			background ='#1f1e25',
		},
		wo = {
			fillchars = 'eob: ',
		},
		right = {
			enabled = false,
		},
	},
})
