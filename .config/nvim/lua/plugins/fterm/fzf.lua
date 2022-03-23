local fterm = require("FTerm")

local fzf = fterm:new({
    ft = 'fterm_fzf',
    cmd = "fzf",
    border = 'rounded',
})

 -- Use this to toggle fzf in a floating terminal
function _G.__fterm_fzf()
    fzf:toggle()
end

vim.cmd('command! FTermFzf lua _G.__fterm_fzf()')
