local map = require'utils'.map
local replace = require'utils'.replace

-- Avoid showing extra message when using completion
vim.cmd 'set shortmess+=c'

-- Set completeopt to have a better completion experience
vim.o.completeopt = "menuone,noselect"

map("i", "<C-Space>", " compe#complete()", {silent = true, expr = true})
--[[ map("i", "<C-Space>", " compe#complete()", {silent = true, expr = true})
map("i", "<CR> ", "compe#confirm()", {silent = true, expr = true}) ]]
-- vim.cmd('imap <silent><expr> <CR> compe#confirm()')
--[[ map("i", "<C-e>", "compe#close('<C-e>')", {silent = true, expr = true})
map("i", "<C-f>", "compe#scroll({ 'delta': +4 })", {silent = true, expr = true})
map("i", "<C-d>", "compe#scroll({ 'delta': -4 })", {silent = true, expr = true}) ]]

local check_back_space = function()
    local col = vim.fn.col('.') - 1
    return col == 0 or vim.fn.getline('.'):sub(col, col):match('%s') ~= nil
end

_G.nvim_compe_tab = function()
    if vim.fn.pumvisible() == 1 then
        return replace "<C-n>"
    elseif vim.fn['vsnip#available'](1) == 1 then
        return replace "<Plug>(vsnip-expand-or-jump)"
    elseif check_back_space() then
        return replace "<Tab>"
    else
        return vim.fn['compe#complete']()
    end
end

_G.nvim_compe_s_tab = function()
    if vim.fn.pumvisible() == 1 then
        return replace "<C-p>"
    elseif vim.fn['vsnip#jumpable'](-1) == 1 then
        return replace "<Plug>(vsnip-jump-prev)"
    else
        -- If <S-Tab> is not working in your terminal, change it to <C-h>
        return replace "<S-Tab>"
    end
end

vim.api.nvim_set_keymap("i", "<Tab>", "v:lua.nvim_compe_tab()",
                        {silent = true, expr = true})
vim.api.nvim_set_keymap("s", "<Tab>", "v:lua.nvim_compe_tab()",
                        {silent = true, expr = true})
vim.api.nvim_set_keymap("i", "<S-Tab>", "v:lua.nvim_compe_s_tab()",
                        {silent = true, expr = true})
vim.api.nvim_set_keymap("s", "<S-Tab>", "v:lua.nvim_compe_s_tab()",
                        {silent = true, expr = true})

-- Pmenu NormalFloat TreesitterContext FloatermBorder
-- PmenuSel
-- PmenuSbar
-- PmenuThumb

vim.api.nvim_exec([[
    hi clear Pmenu
    hi clear PmenuSel
	hi def link Pmenu CursorLineNR
	hi def link NormalFloat CursorLineNR
	hi def link TreesitterContext CursorLineNR
	hi def link FloatermBorder CursorLineNR
	hi def link PmenuSel Comment
]], true)
