-- Gated on coq's auto_start. When auto_start = false (current default —
-- coq replaced by lua/completion/), these <Esc>/<CR>/<C-c> insert-mode
-- mappings would fight with lua/completion/keymaps.lua. Re-enabled
-- automatically if the user flips auto_start back to 'shut-up'.
if vim.g.coq_settings and vim.g.coq_settings.auto_start ~= false then
	local keys = require('utils.keys')

	keys.map_key('i', '<Esc>',
		'pumvisible() ? "<C-e><Esc>" : "<Esc>"',
		{ silent = true, expr = true })
	keys.map_key('i', '<CR>',
		'pumvisible() ? (complete_info().selected == -1 ? "<C-e><C-O>zz<CR>" : "<C-y><C-O>zz") : "<C-O>zz<CR>"',
		{ silent = true, expr = true })
	keys.map_key('i', '<C-c>',
		'pumvisible() ? "<C-e><C-c>" : "<C-c>"',
		{ silent = true, expr = true })
end
