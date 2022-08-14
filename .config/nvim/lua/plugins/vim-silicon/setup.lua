local utils = require 'utils'

-- utils.map('x', "<S-s>", "<Cmd>'<,'>Silicon<CR>", {silent = true})
utils.map('n', "<leader>S", "<CMD>Silicon<CR>", {silent = true})
utils.map('v', "<leader>S", ":'<,'> Silicon<CR>", {silent = true})

vim.g.silicon = {
    theme = '.config/bat/themes/Horizon.tmTheme',
    font = 'Rec Mono Duotone', -- iMWritingMonoV Nerd Font
    background = '#09F7A0', -- '#AAAAFF'
    output = '~/Pictures/vimshots/vimshot-{time:%Y-%m-%d-%H%M%S}.png',
    ['shadow-color'] = '#555555',
    ['line-pad'] = 2,
    ['pad-horiz'] = 80,
    ['pad-vert'] = 100,
    ['shadow-blur-radius'] = 10,
    ['shadow-offset-x'] = 2,
    ['shadow-offset-y'] = 2,
    ['line-number'] = false,
    ['round-corner'] = true,
    ['window-controls'] = true
}
