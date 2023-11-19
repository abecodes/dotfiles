-- for plugin nvim-ts-context-commentstring
require('ts_context_commentstring').setup {
    enable_autocmd = false,
}

require'nvim-treesitter.configs'.setup {
    ensure_installed = "all", -- one of "all", or a list of languages
    ignore_install = { "php", "phpdoc" }, -- List of parsers to ignore installing
    highlight = {
        enable = true, -- false will disable the whole extension
        disable = {} -- list of language that will be disabled
    },
}
