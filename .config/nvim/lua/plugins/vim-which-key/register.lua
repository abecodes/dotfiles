local g = vim.g

local normal_singles = require("plugins.vim-which-key.normal.singles")
local normal_p = require("plugins.vim-which-key.normal.p")
local normal_t = require("plugins.vim-which-key.normal.t")
local normal_T = require("plugins.vim-which-key.normal.tt")
local normal_z = require("plugins.vim-which-key.normal.z")

local visual_singles = require("plugins.vim-which-key.visual.singles")
local visual_r = require("plugins.vim-which-key.visual.r")
local visual_t = require("plugins.vim-which-key.visual.t")


-- Create map to add keys to
local which_key_map = vim.fn.get(g, 'which_key_map', {})
local which_key_map_visual = vim.fn.get(g, 'which_key_map_visual', {})

which_key_map = normal_singles
which_key_map.p = normal_p
which_key_map.t = normal_t
which_key_map.T = normal_T
which_key_map.z = normal_z

which_key_map_visual = visual_singles
which_key_map_visual.r = visual_r
which_key_map_visual.t = visual_t

g.which_key_map = which_key_map
g.which_key_map_visual = which_key_map_visual
