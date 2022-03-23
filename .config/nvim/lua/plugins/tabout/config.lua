require('tabout').setup {
    enable_backwards = true,
    completion = true,
    tabouts = {
        {open = "'", close = "'"}, {open = '"', close = '"'},
        {open = '`', close = '`'}, {open = '(', close = ')'},
        {open = '[', close = ']'}, {open = '{', close = '}'},
        {open = '<', close = '>'}, {open = '#', close = ']'}
    }
}

vim.api.nvim_set_keymap('i', '<A-x>', "<Plug>(TaboutMulti)", {silent = true})
vim.api
    .nvim_set_keymap('i', '<A-z>', "<Plug>(TaboutBackMulti)", {silent = true})
