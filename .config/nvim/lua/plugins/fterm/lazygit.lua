local fterm = require("FTerm")

local lazygit = fterm:new({
    ft = 'fterm_lazygit',
    cmd = "lazygit",
    border = 'rounded',
})

 -- Use this to toggle lazygit in a floating terminal
function _G.__fterm_lazygit()
    lazygit:toggle()
end

vim.cmd('command! FTermLazygit lua _G.__fterm_lazygit()')
