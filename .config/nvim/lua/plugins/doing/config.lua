require('doing').setup({
	message_timeout = 2000,
	doing_prefix = "Doing: ",

	-- doesn't display on buffers that match filetype/filename/filepath to
	-- entries. can be either a string array or a function that returns a
	-- string array. filepath can be relative to cwd or absolute
	ignored_buffers = { "NvimTree" },

	-- if should append "+n more" to the status when there's tasks remaining
	show_remaining = true,

	-- if should show messages on the status string
	show_messages = true,

	-- window configs of the floating tasks editor
	-- see :h nvim_open_win() for available options
	edit_win_config = {
		width = 50,
		height = 15,
		border = "rounded",
	},

	-- if plugin should manage the winbar
	winbar = { enabled = true, },

	store = {
		-- name of tasks file
		file_name = ".tasks",
	},
})
