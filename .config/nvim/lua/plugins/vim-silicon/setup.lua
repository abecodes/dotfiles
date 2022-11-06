local utils = require 'utils'

-- utils.map('x', "<S-s>", "<Cmd>'<,'>Silicon<CR>", {silent = true})
utils.map('n', "<leader>S", "<CMD>Silicon<CR>", {silent = true})
utils.map('v', "<leader>S", ":'<,'> Silicon<CR>", {silent = true})

vim.g.silicon = {
    theme = '~/.config/bat/themes/Horizon.tmTheme',
    font = 'Rec Mono Duotone', -- iMWritingMonoV Nerd Font / Rec Mono Duotone / Cartograph CF
    background = '#09F7A0', -- '#AAAAFF'
    output = '~/Pictures/vimshots/vimshot-{time:%Y-%m-%d-%H%M%S}.png',
    ['shadow-color'] = '#555555',
    ['line-pad'] = 2,
    ['pad-horiz'] = 80,
    ['pad-vert'] = 100,
    ['shadow-blur-radius'] = 10,
    ['shadow-offset-x'] = 4,
    ['shadow-offset-y'] = 4,
    ['line-number'] = true,
    ['round-corner'] = true,
    ['window-controls'] = true
}
