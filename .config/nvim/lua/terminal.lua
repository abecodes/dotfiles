local function toggle_term()
	if vim.api.nvim_win_get_config(vim.g.terminal).hide then
		vim.api.nvim_win_set_config(vim.g.terminal, { hide = false })

		vim.api.nvim_set_current_win(vim.g.terminal)

		vim.api.nvim_set_option_value('number', false, { win = vim.g.terminal })
		vim.api.nvim_set_option_value('relativenumber', false, { win = vim.g.terminal })

		vim.cmd('startinsert')

		return
	end

	vim.api.nvim_win_set_config(vim.g.terminal, { hide = true })

	if vim.fn.winnr('#') > 0 then
		vim.api.nvim_set_current_win(
			vim.fn.win_getid(vim.fn.winnr('#'))
		)
	end
end

local term_func = function()
	if not vim.api.nvim_buf_is_valid(vim.g.terminal_buf or -1) then
		vim.g.terminal_buf = vim.api.nvim_create_buf(false, false)

		vim.api.nvim_buf_call(
			vim.g.terminal_buf,
			vim.cmd.term
		)

		local term_grp = vim.api.nvim_create_augroup('term_grp', {
			clear = true
		})

		vim.api.nvim_create_autocmd(
			{ "BufEnter", "FocusGained", "InsertLeave" },
			{
				group = term_grp,
				buffer = vim.g.terminal_buf,
				callback = function(args)
					vim.api.nvim_set_option_value('number', false, { win = vim.g.terminal })
					vim.api.nvim_set_option_value('relativenumber', false, { win = vim.g.terminal })
				end,
			}
		)

		vim.api.nvim_create_autocmd(
			{ "BufDelete" },
			{
				group = term_grp,
				buffer = vim.g.terminal_buf,
				callback = function(args)
					vim.g.terminal_buf = nil
				end,
			}
		)

		vim.keymap.set(
			'n',
			'<ESC>',
			toggle_term,
			{
				buffer = vim.g.terminal_buf,
				silent = true,
				noremap = true,
			}
		)
	end

	if not vim.api.nvim_win_is_valid(vim.g.terminal or -1) then
		vim.g.terminal = vim.api.nvim_open_win(
			vim.g.terminal_buf,
			false,
			{
				relative = 'editor',
				width = math.floor(vim.api.nvim_win_get_width(0) * 0.8),
				height = math.floor(vim.api.nvim_win_get_height(0) * 0.8),
				col = math.floor(vim.o.columns * 0.1),
				row = math.floor(vim.o.lines * 0.1),
				border = 'rounded',
				style = 'minimal',
				hide = true,
			}
		)
	end

	toggle_term()
end

vim.keymap.set(
	{ 'n', 't' },
	'<leader>T',
	term_func
)
