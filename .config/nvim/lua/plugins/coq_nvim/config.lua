-- vim.g.coq_settings must be set BEFORE packadd (i.e. in the config pass,
-- not setup.lua). coq's top-level module reads vim.g.coq_settings at
-- require-time and dispatches auto_start there; if the global isn't set
-- yet, auto_start is silently skipped.
vim.g.coq_settings = {
	-- Disabled: replaced by lua/completion/. Kept loaded so 'after' chains
	-- for autopairs/tabout still get their event ordering. Flip back to
	-- 'shut-up' for rollback.
	auto_start = false,
	['keymap.recommended'] = false,
	['display.preview.border'] = {
		{ "╭", "Pmenu" },
		{ "─", "Pmenu" },
		{ "╮", "Pmenu" },
		{ "│", "Pmenu" },
		{ "╯", "Pmenu" },
		{ "─", "Pmenu" },
		{ "╰", "Pmenu" },
		{ "│", "Pmenu" },
	},
}
