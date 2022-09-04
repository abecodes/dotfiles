require'mind'.setup({
	persistence = {
		-- state_path = '~/Documents/mind/mind.json'
		-- data_dir = '~/Documents/mind/data'
	}
})

--[[
	Default:
normal = {
	["<cr>"] = "open_data",
	["<s-cr>"] = "open_data_index",
	["<tab>"] = "toggle_node",
	["<s-tab>"] = "toggle_node",
	["/"] = "select_path",
	["$"] = "change_icon_menu",
	c = "add_inside_end_index",
	I = "add_inside_start",
	i = "add_inside_end",
	l = "copy_node_link",
	L = "copy_node_link_index",
	d = "delete",
	O = "add_above",
	o = "add_below",
	q = "quit",
	r = "rename",
	R = "change_icon",
	u = "make_url",,
	x = "select",
}

selection = {
	["<cr>"] = "open_data",
	["<s-tab>"] = "toggle_node",
	["/"] = "select_path",
	I = "move_inside_start",
	i = "move_inside_end",
	O = "move_above",
	o = "move_below",
	q = "quit",
	x = "select",
}

icon_preset = {
	{ " ", "Sub-project" },
	{ " ", "Journal, newspaper, weekly and daily news" },
	{ " ", "For when you have an idea" },
	{ " ", "Note taking?" },
	{ "陼", "Task management" },
	{ " ", "Uncheck, empty square or backlog" },
	{ " ", "Full square or on-going" },
	{ " ", "Check or done" },
	{ " ", "Trash bin, deleted, cancelled, etc." },
	{ " ", "GitHub" },
	{ " ", "Monitoring" },
	{ " ", "Internet, Earth, everyone!" },
	{ " ", "Frozen, on-hold" },
}

]]
