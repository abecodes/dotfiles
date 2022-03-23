require('coq')
local utils = require 'utils'

utils.map('i', utils.replace '<Tab>', 'pumvisible() ? "<C-n>" : "<Plug>Tabout"',
          {silent = true, expr = true})
utils.map('i', utils.replace '<S-Tab>',
          'pumvisible() ? "<C-p>" : "<Plug>TaboutBack"',
          {silent = true, expr = true})
utils.map('i', utils.replace '<Esc>', 'pumvisible() ? "<C-e><Esc>" : "<Esc>"',
          {silent = true, expr = true})
-- utils.map('i', utils.replace '<CR>',
--           'pumvisible() ? (complete_info().selected == -1 ? "<C-e><CR>" : "<C-y>") : "<CR>"',
--           {silent = true, expr = true})
