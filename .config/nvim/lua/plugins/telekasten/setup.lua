local map = require'utils'.map_key
local opts = {silent = true}

map(
	"n",
	"<leader>z",
	"<cmd>lua require('telekasten').panel()<CR>",
	opts
)
map(
	"n",
	"<leader>zf",
	"<cmd>lua require('telekasten').find_notes()<CR>",
	opts
)
map(
	"n",
	"<leader>zF",
	"<cmd>lua require('telekasten').search_notes()<CR>",
	opts
)
map(
	"n",
	"<leader>zl",
	"<cmd>lua require('telekasten').follow_link()<CR>",
	opts
)
map(
	"n",
	"<leader>zL",
	"<cmd>lua require('telekasten').find_friends()<CR>",
	opts
)
map(
	"n",
	"<leader>zn",
	"<cmd>lua require('telekasten').new_note()<CR>",
	opts
)
map(
	"n",
	"<leader>zN",
	"<cmd>lua require('telekasten').new_templated_note()<CR>",
	opts
)
map(
	"n",
	"<leader>zy",
	"<cmd>lua require('telekasten').yank_notelink()<CR>",
	opts
)
map(
	"n",
	"<leader>zt",
	"<cmd>lua require('telekasten').show_tags()<CR>",
	opts
)
map(
	"n",
	"<leader>zb",
	"<cmd>lua require('telekasten').show_backlinks()<CR>",
	opts
)
map(
	"n",
	"<leader>zr",
	"<cmd>lua require('telekasten').rename_note()<CR>",
	opts
)
map(
	"n",
	"<leader>zi",
	"<cmd>lua require('telekasten').paste_img_and_link()<CR>",
	opts
)
map(
	"n",
	"<leader>zI",
	"<cmd>lua require('telekasten').insert_img_link({ i=true })<CR>",
	opts
)


map(
	"i",
	"<leader>[",
	"<cmd>lua require('telekasten').insert_link({ i=true })<CR>",
	opts
)
map(
	"i",
	"<leader>#",
	"<cmd>lua require('telekasten').show_tags({ i=true })<CR>",
	opts
)
-- nnoremap <leader>zd :lua require('telekasten').find_daily_notes()<CR>
-- nnoremap <leader>zT :lua require('telekasten').goto_today()<CR>
-- nnoremap <leader>zW :lua require('telekasten').goto_thisweek()<CR>
-- nnoremap <leader>zw :lua require('telekasten').find_weekly_notes()<CR>
-- nnoremap <leader>zN :lua require('telekasten').new_templated_note()<CR>
-- nnoremap <leader>zc :lua require('telekasten').show_calendar()<CR>
-- nnoremap <leader>zC :CalendarT<CR>
-- nnoremap <leader>zt :lua require('telekasten').toggle_todo()<CR>
-- nnoremap <leader>zp :lua require('telekasten').preview_img()<CR>
-- nnoremap <leader>zm :lua require('telekasten').browse_media()<CR>

-- " we could define [[ in **insert mode** to call insert link
-- " inoremap [[ <cmd>:lua require('telekasten').insert_link()<CR>
-- " alternatively: leader [
-- inoremap <leader>[ <cmd>:lua require('telekasten').insert_link({ i=true })<CR>
-- inoremap <leader>zt <cmd>:lua require('telekasten').toggle_todo({ i=true })<CR>
-- inoremap <leader># <cmd>lua require('telekasten').show_tags({i = true})<cr>

-- the following are for syntax-coloring [[links]] and ==highlighted text==
-- (see the section about coloring in README.md)

vim.api.nvim_exec([[
	highlight link tkHighlight Todo
	highlight tkTagSep ctermfg=171 cterm=italic guifg=#b877db gui=italic
	highlight tkTag ctermfg=171 guifg=#b877db
	highlight tkLink ctermfg=48 guifg=#09f7a0
	highlight tkBrackets ctermfg=48 guifg=#09f7a0
]], true)
