local g = vim.g

-- g:minimap_auto_start	0	if set minimap will show at startup
-- g:minimap_auto_start_win_enter	0	if set with g:minimap_auto_start minimap shows on WinEnter
-- g:minimap_width	10	the width of the minimap window in characters
-- g:minimap_highlight	Title	the color group for current position
-- g:minimap_base_highlight	Normal	the base color group for minimap
-- g:minimap_block_filetypes	['fugitive', 'nerdtree', 'tagbar' ]	disable minimap for specific file types
-- g:minimap_block_buftypes	['nofile', 'nowrite', 'quickfix', 'terminal', 'prompt']	disable minimap for specific buffer types
-- g:minimap_close_filetypes	['startify', 'netrw', 'vim-plug']	close minimap for specific file types
-- g:minimap_close_buftypes	[]	close minimap for specific buffer types
-- g:minimap_left	0	if set minimap window will append left
-- g:minimap_highlight_range	0	if set minimap will highlight range of visible lines
-- g:minimap_git_colors	0	if set minimap will highlight range of changes as reported by git
-- g:minimap_diffadd_color	DiffAdd	the color group for added lines (if git_colors is enabled)
-- g:minimap_diffremove_color	DiffDelete	the color group for removed lines (if git_colors is enabled)
-- g:minimap_diff_color	DiffChange	the color group for modified lines (if git_colors is enabled)
-- g:minimap_highlight_search	0	if set minimap will highlight searched patterns
-- g:minimap_search_color	Search	the color group for highlighted search patterns in the minimap
-- g:minimap_search_color_priority	120	the priority for the search highlight colors
-- g:minimap_cursor_color_priority	110	the priority for the cursor highlight colors
-- g:minimap_git_color_priority	100	the priority for the git grouping of colors

g.minimap_width = 10
g.minimap_auto_start = 1
g.minimap_auto_start_win_enter = 1
g.minimap_highlight_search = 1
g.minimap_git_colors = 1

vim.cmd 'hi MinimapCurrentLine ctermfg=Green guifg=#50FA7B guibg=#32302f'
g.minimap_highlight = 'MinimapCurrentLine'

vim.api.nvim_exec([[
	augroup Minimap
		autocmd!
		autocmd BufReadPost * Minimap
		autocmd TextChangedI * MinimapRefresh
		autocmd InsertEnter,InsertLeave * MinimapRefresh
		autocmd BufAdd * MinimapClose
	augroup END
]], true)

