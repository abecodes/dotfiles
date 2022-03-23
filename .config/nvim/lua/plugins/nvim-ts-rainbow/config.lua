-- local c = {
--     red = {gui = "#e06c75", cterm = "168"},
--     green = {gui = "#98c379", cterm = "114"},
--     yellow = {gui = "#e5c07b", cterm = "180"},
--     blue = {gui = "#61afef", cterm = "75"},
--     purple = {gui = "#c678dd", cterm = "176"},
--     cyan = {gui = "#56b6c2", cterm = "73"},
--     white = {gui = "#dcdfe4", cterm = "188"}
-- }
local c = {
    red = {gui = "#eC6a88", cterm = "203"},
    green = {gui = "#09f7a0", cterm = "48"},
    yellow = {gui = "#fab795", cterm = "209"},
    blue = {gui = "#25b0bc", cterm = "37"},
    purple = {gui = "#b877db", cterm = "171"},
    cyan = {gui = "#25b0bc", cterm = "37"},
    white = {gui = "#dcdfe4", cterm = "188"}
}

require'nvim-treesitter.configs'.setup {
    rainbow = {
        enable = true,
        extended_mode = true, -- Highlight also non-parentheses delimiters, boolean or table=lang -> boolean
        max_file_lines = 1000, -- Do not enable for files with more than 1000 lines, int
        colors = {
            c.red.gui, c.green.gui, c.yellow.gui, c.blue.gui, c.purple.gui,
            c.cyan.gui, c.white.gui
        }, -- table of hex strings
        termcolors = {
            c.red.cterm, c.green.cterm, c.yellow.cterm, c.blue.cterm,
            c.purple.cterm, c.cyan.cterm, c.white.cterm
        } -- table of colour name strings
    }
}
