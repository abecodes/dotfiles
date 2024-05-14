require('gitpad').setup{
  border = 'rounded', -- The border style of the floating window. Possible values are `'single'`, `'double'`, `'shadow'`, `'rounded'`, and `''` (no border).
  style = 'minimal', -- The style of the floating window. Possible values are `'minimal'` (no line numbers, statusline, or sign column. See :help nvim_open_win() '), and `''` (default Neovim style).
  dir = vim.fn.stdpath('data') .. '/gitpad', -- The directory where the notes are stored. Possible value is a valid path ie '~/notes'
  default_text = nil, -- Leave this nil if you want to use the default text
  on_attach = function(bufnr)
    -- You can also define a function to be called when the gitpad window is opened, by setting the `on_attach` option:
    -- This is just an example
    vim.api.nvim_buf_set_keymap(bufnr, 'n', 'q', '<Cmd>wq<CR>', { noremap = true, silent = true })
    vim.api.nvim_buf_set_keymap(bufnr, 'n', '<ESC>', '<Cmd>wq<CR>', { noremap = true, silent = true })
  end,
}
