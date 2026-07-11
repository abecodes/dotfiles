-- Aggregator for the domain-split utils/* modules. Reach submodule functions
-- via require('utils').<submodule>.<fn> or require('utils.<submodule>').<fn>.

local M = {}

M.str     = require('utils.str')
M.keys    = require('utils.keys')
M.buf     = require('utils.buf')
M.ui_buffer = require('utils.ui_buffer')
M.cmd     = require('utils.cmd')
M.autocmd = require('utils.autocmd')
M.proc    = require('utils.proc')
M.git     = require('utils.git')
M.tbl     = require('utils.tbl')
M.hl      = require('utils.hl')

return M
