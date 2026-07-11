local autocmd = require('utils.autocmd')

local state = { win = nil, buf = nil }

local function toggle_term()
	-- Bound to <ESC> on state.buf, which outlives its window. If the float
	-- was closed externally (e.g. `:close`), state.win is stale — bail out
	-- rather than crash on nvim_win_get_config.
	if not (state.win and vim.api.nvim_win_is_valid(state.win)) then return end

	if vim.api.nvim_win_get_config(state.win).hide then
		vim.api.nvim_win_set_config(state.win, { hide = false })

		vim.api.nvim_set_current_win(state.win)

		vim.api.nvim_set_option_value('number',         false, { win = state.win })
		vim.api.nvim_set_option_value('relativenumber', false, { win = state.win })

		vim.cmd('startinsert')

		return
	end

	vim.api.nvim_win_set_config(state.win, { hide = true })

	if vim.fn.winnr('#') > 0 then
		vim.api.nvim_set_current_win(
			vim.fn.win_getid(vim.fn.winnr('#'))
		)
	end
end

local term_func = function()
	if not vim.api.nvim_buf_is_valid(state.buf or -1) then
		state.buf = vim.api.nvim_create_buf(false, false)

		vim.api.nvim_buf_call(
			state.buf,
			vim.cmd.term
		)

		local term_grp = autocmd.new_augroup('term_grp')

		autocmd.new_autocmd(
			{ "BufEnter", "FocusGained", "InsertLeave" },
			term_grp,
			{
				buffer = state.buf,
				callback = function()
					-- May fire before term_func opens the window; guard so we
					-- don't deref a nil/invalid win id.
					if state.win and vim.api.nvim_win_is_valid(state.win) then
						vim.api.nvim_set_option_value('number',         false, { win = state.win })
						vim.api.nvim_set_option_value('relativenumber', false, { win = state.win })
					end
				end,
			}
		)

		autocmd.new_autocmd(
			{ "BufDelete" },
			term_grp,
			{
				buffer = state.buf,
				callback = function()
					state.buf = nil
				end,
			}
		)

		vim.keymap.set(
			'n',
			'<ESC>',
			toggle_term,
			{
				buffer = state.buf,
				silent = true,
				noremap = true,
			}
		)
	end

	if not vim.api.nvim_win_is_valid(state.win or -1) then
		state.win = vim.api.nvim_open_win(
			state.buf,
			false,
			{
				relative = 'editor',
				width  = math.floor(vim.api.nvim_win_get_width(0) * 0.8),
				height = math.floor(vim.api.nvim_win_get_height(0) * 0.8),
				col = math.floor(vim.o.columns * 0.1),
				row = math.floor(vim.o.lines   * 0.1),
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
	term_func,
	{ desc = 'Terminal' }
)
