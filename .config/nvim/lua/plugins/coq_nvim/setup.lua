local utils = require 'utils'

-- utils.map_key(
-- 	'i',
-- 	utils.replace_key '<Tab>',
-- 	'pumvisible() ? "<C-n>" : "<Plug>Tabout"',
--   {silent = true, expr = true}
-- )
-- utils.map_key(
-- 	'i',
-- 	utils.replace_key '<S-Tab>',
--   'pumvisible() ? "<C-p>" : "<Plug>TaboutBack"',
-- 	{silent = true, expr = true}
-- )
utils.map_key(
	'i',
	utils.replace_key '<Esc>',
	'pumvisible() ? "<C-e><Esc>" : "<Esc>"',
  {silent = true, expr = true}
)
utils.map_key(
	'i',
	utils.replace_key '<CR>',
  'pumvisible() ? (complete_info().selected == -1 ? "<C-e><C-O>zz<CR>" : "<C-y><C-O>zz") : "<C-O>zz<CR>"',
  {silent = true, expr = true}
)
utils.map_key(
	'i',
	utils.replace_key '<C-c>',
	'pumvisible() ? "<C-e><C-c>" : "<C-c>"',
  {silent = true, expr = true}
)
