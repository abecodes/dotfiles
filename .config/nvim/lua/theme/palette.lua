-- Cross-cutting palette.
--
-- Scope: colors that appear in more than one file. Scheme-specific
-- literals (e.g. base2tone_evening's diagnostic colors that only exist
-- inside that one overwrite file) stay local to their scheme — extracting
-- them here would conflate "shared design tokens" with "one scheme's
-- internal palette."
--
-- `raw` holds the hex literals. `semantic` names the role each hex plays
-- at the call sites that reference them. Call sites should prefer the
-- semantic layer; reach for `raw` only when the role isn't settled.

local raw = {
	ink         = '#201d2a', -- StickyTodo fg (near-black purple)
	mint_bright = '#29d398', -- StickyTodo bg, todo-comments TODO
	mint        = '#09f7a0', -- horizon green, telekasten link brackets
	coral       = '#fab795', -- horizon yellow, todo-comments FIX/HACK
	violet      = '#b877db', -- horizon purple, telekasten tag
	azure       = '#599eff', -- horizon blue, SpellBad undercurl
	slate       = '#6c6f93', -- horizon grey, evening/lavender DiagnosticHint
}

local semantic = {
	-- Notes sticky todo bar
	sticky_fg    = raw.ink,
	sticky_bg    = raw.mint_bright,

	-- todo-comments keywords (cross-referenced in 1 plugin file)
	todo_keyword = raw.mint_bright,
	fix_keyword  = raw.coral,
	hack_keyword = raw.coral,
	warn_keyword = '#E95678', -- todo-comments WARN; single-use, no palette name

	-- telekasten [[link]] and #tag highlights
	tk_tag       = raw.violet,
	tk_link      = raw.mint,

	-- SpellBad undercurl color (theme.lua) + horizon blue
	spell_bad    = raw.azure,

	-- DiagnosticHint fg across scheme overwrites
	diag_hint_muted = raw.slate,
}

return { raw = raw, semantic = semantic }
