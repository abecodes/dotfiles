-- Baseline languages every machine should have.
--
-- `:TSInstall sync` installs every entry below that isn't already present in
-- `stdpath('data')/treesitter/parser/`. Per-machine extras added ad-hoc via
-- `:TSInstall <lang>` live only in the data dir, never committed.
--
-- The dispatcher (attach.lua) reads from installed-parsers-on-disk, not from
-- this list — so the runtime reflects the union of baseline + ad-hoc.
--
-- To discover what can go here: see `lua/treesitter/registry.json` (language
-- keys) or run `:TSInstall <TAB>` once the install engine is wired up.

return {
	baseline = {
		-- 'go', 'lua', 'python', 'typescript', 'tsx', 'javascript', 'jsx',
		-- 'rust', 'json', 'yaml', 'toml', 'bash', 'markdown', 'html', 'css',
		'bash',
		'fish',
		'go',
		'json',
		'lua',
		'markdown',
		'toml',
		'yaml'
	},
}
