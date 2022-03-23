local g = vim.g

local singles = require("plugins.vim-which-key.singles")
local c = require("plugins.vim-which-key.c")
local t = require("plugins.vim-which-key.t")
local s = require("plugins.vim-which-key.s")

-- Create map to add keys to
local which_key_map = vim.fn.get(g, 'which_key_map', {})

which_key_map = singles
which_key_map.c = c
which_key_map.t = t
which_key_map.s = s

g.which_key_map = which_key_map
