require('coq')
local utils = require 'utils'

utils.map('i', utils.replace '<Tab>', 'pumvisible() ? "<C-n>" : "<Plug>Tabout"',
          {silent = true, expr = true})
utils.map('i', utils.replace '<S-Tab>',
          'pumvisible() ? "<C-p>" : "<Plug>TaboutBack"',
          {silent = true, expr = true})
utils.map('i', utils.replace '<Esc>', 'pumvisible() ? "<C-e><Esc>" : "<Esc>"',
          {silent = true, expr = true})
utils.map('i', utils.replace '<CR>',
          'pumvisible() ? (complete_info().selected == -1 ? "<C-e><CR>" : "<C-y>") : "<CR>"',
          {silent = true, expr = true})

-- function _G.__coq_cr()
--   if vim.fn.pumvisible() ~= 0 then
--     if vim.fn.complete_info({ 'selected' }).selected ~= -1 then
--       return npairs.esc('<c-y>')
--     else
--       return npairs.esc('<c-e>') .. npairs.autopairs_cr()
--     end
--   else
--     return npairs.autopairs_cr()
--   end
-- end
-- utils.map('i', utils.replace '<CR>', 'v:lua.__coq_cr()', {silent = true, expr = true})

-- function _G.__coq_bs()
--   if vim.fn.pumvisible() ~= 0 and vim.fn.complete_info({ 'mode' }).mode == 'eval' then
--     return npairs.esc('<c-e>') .. npairs.autopairs_bs()
--   else
--     return npairs.autopairs_bs()
--   end
-- end
-- utils.map('i', utils.replace '<BS>', 'v:lua.__coq_bs()', {silent = true, expr = true})
