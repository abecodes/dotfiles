vim.g.coq_settings = {
	auto_start = 'shut-up',
	['keymap.recommended'] = false,
	['display.preview.border'] = {
		{ "╭", "Pmenu" },
		{ "─", "Pmenu" },
		{ "╮", "Pmenu" },
		{ "│", "Pmenu" },
		{ "╯", "Pmenu" },
		{ "─", "Pmenu" },
		{ "╰", "Pmenu" },
		{ "│", "Pmenu" },
	},
}

vim.cmd('COQnow --shut-up')
