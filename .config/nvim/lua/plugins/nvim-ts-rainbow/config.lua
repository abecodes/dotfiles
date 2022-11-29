-- horizon colors
-- local c = {
--     red = { gui = '#eC6a88', cterm = '203' },
--     green = { gui = '#09f7a0', cterm = '48' },
--     yellow = { gui = '#fab795', cterm = '209' },
--     blue = { gui = '#599eff', cterm = '75' },
--     purple = { gui = '#b877db', cterm = '171' },
--     cyan = { gui = '#25b0bc', cterm = '37' },
--     orange = { gui = '#f09483', cterm = '209' },
--     white = { gui = '#dcdfe4', cterm = '188' }
-- }

local c = {
    purple = { gui = '#b877db', cterm = '171' },
    -- yellow = { gui = '#f1e05a', cterm = '220' },
    yellow = { gui = '#fab795', cterm = '209' },
    blue = { gui = '#599eff', cterm = '75' },
}

require'nvim-treesitter.configs'.setup {
    rainbow = {
        enable = true,
        extended_mode = true, -- Highlight also non-parentheses delimiters, boolean or table=lang -> boolean
        max_file_lines = 1000, -- Do not enable for files with more than 1000 lines, int
        colors = {
            c.purple.gui, c.yellow.gui, c.blue.gui,
        }, -- table of hex strings
        termcolors = {
            c.purple.cterm, c.yellow.cterm, c.blue.cterm,
        } -- table of colour name strings
    }
}
