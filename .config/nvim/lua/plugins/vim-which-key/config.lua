local g = vim.g

-- Define a separator
g.which_key_sep = '→'
-- Not a fan of floating windows for this
g.which_key_use_floating_win = 0

vim.cmd 'set timeoutlen=400'

-- Change the colors if you want
vim.cmd 'highlight default link WhichKey          Operator'
vim.cmd 'highlight default link WhichKeySeperator DiffAdded'
vim.cmd 'highlight default link WhichKeyGroup     Identifier'
vim.cmd 'highlight default link WhichKeyDesc      Function'

-- Hide status line
vim.api.nvim_exec([[
augroup VimWhichKey
  autocmd! FileType which_key
	autocmd FileType which_key set laststatus=0 noshowmode noruler
  autocmd BufLeave <buffer> set laststatus=2 noshowmode ruler
augroup END
]], true)

require("plugins.vim-which-key.register")

-- Register which key map
vim.cmd ':call which_key#register("<,>", "g:which_key_map", "n")'
vim.cmd ':call which_key#register("<,>", "g:which_key_map_visual", "v")'
