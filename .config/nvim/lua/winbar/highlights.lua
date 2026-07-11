-- Central highlight definitions for winbar and statusbar.
--
-- Pattern:
--   Bar*      — base groups, fg only, no bg. Safe to use in the winbar (transparent bg).
--   Status*   — statusbar variants created via with_bg(): same fg + explicit section bg.
--               Use these inside the statusbar's B-section so the bg is uniform.

local autocmd = require('utils.autocmd')

-- Pull fg/bg from a live hl group, falling back to the given hex int when
-- the group is undefined or missing the component. Fallbacks are the old
-- base2tone_lavender_dark values, so a minimal scheme keeps a usable baseline.
-- Each source group was chosen because it carries the *same hex* as the
-- original lavender slot — so lavender stays pixel-identical and other
-- base2tone variants shift cohesively via their own definitions of those
-- groups.
local function fg_of(name, fallback)
	local h = vim.api.nvim_get_hl(0, { name = name, link = false })
	return h.fg or fallback
end

local function bg_of(name, fallback)
	local h = vim.api.nvim_get_hl(0, { name = name, link = false })
	return h.bg or fallback
end

-- Linear RGB blend of two 0xRRGGBB ints, floored per channel (matches the
-- lavender palette's original B1 value exactly). Used to derive slots that
-- have no single source hl group.
local function blend(c1, c2, t)
	local r1 = math.floor(c1 / 0x10000) % 256
	local g1 = math.floor(c1 / 0x100)   % 256
	local b1 = c1 % 256
	local r2 = math.floor(c2 / 0x10000) % 256
	local g2 = math.floor(c2 / 0x100)   % 256
	local b2 = c2 % 256
	local r  = math.floor(r1 + (r2 - r1) * t)
	local g  = math.floor(g1 + (g2 - g1) * t)
	local b  = math.floor(b1 + (b2 - b1) * t)
	return r * 0x10000 + g * 0x100 + b
end

-- Creates a copy of `source` hl group with an explicit `bg`, stored as `target`.
-- Call after the source group has been defined.
local function with_bg(target, source, bg)
	local src = vim.api.nvim_get_hl(0, { name = source, link = false })
	vim.api.nvim_set_hl(0, target, { fg = src.fg, bg = bg })
end

-- Nvim clears user-defined highlight groups on :colorscheme, so the Status*
-- derivations must be (re)minted on every switch — not once at module load.
-- The palette itself is rebuilt from the active scheme's groups on each run.
local function apply()
	local c = {
		-- Structural
		A0 = bg_of('Normal',            0x201d2a), -- b-section bg (darkest)
		A1 = bg_of('CursorLine',        0x2c2839), -- c-section bg / mode-letter fg
		A4 = fg_of('Pmenu',             0x6e658b), -- c-section fg
		A6 = fg_of('markdownCodeBlock', 0x9992b0), -- replace mode bg
		A7 = fg_of('DiagnosticHint',    0xafa9c1), -- hint fg

		-- Git diff
		B0 = fg_of('GitSignsAdd',    0x7451e6),
		C0 = fg_of('GitSignsChange', 0x7c6f85),
		D0 = fg_of('GitSignsDelete', 0xb042ff),

		-- Diagnostics
		C5_warn = fg_of('DiagnosticWarn',  0xd8cce0),
		C5_info = fg_of('DiagnosticInfo',  0xd8cce0),
		D4      = fg_of('DiagnosticError', 0xd294ff),

		-- Mode bgs — each source carries the original lavender hex in that scheme
		B2 = fg_of('ModeMsg',  0x9375f5), -- normal / b-section fg
		D2 = bg_of('CursorIM', 0xc16bff), -- insert
		-- C2 (visual) has no reliable source group; frozen to the lavender value
		C2 = 0xa092aa,
	}
	-- B1 (command) sits halfway between git-add and normal-mode fg; derive it
	-- so it tracks the scheme instead of staying fixed.
	c.B1 = blend(c.B0, c.B2, 0.5)

	-- WinBar/WinBarNC are Neovim built-ins; clear them so empty winbar regions
	-- stay transparent (sections paint their own fg via %#WinBar*#).
	-- This intentionally removes the default inactive-winbar dimming — splits
	-- all look the same. Re-add a bg on WinBarNC to get it back.
	vim.api.nvim_set_hl(0, 'WinBar',         {})
	vim.api.nvim_set_hl(0, 'WinBarNC',       {})
	vim.api.nvim_set_hl(0, 'WinBarPath',     { link = 'Comment' })
	vim.api.nvim_set_hl(0, 'WinBarModified', { link = 'SpecialComment' })

	-- INFO: Statusbar mode blocks (dark fg on mode-specific bg, bold — mirrors lualine "a" section)
	vim.api.nvim_set_hl(0, 'StatusModeNormal',  { fg = c.A1, bg = c.B2, bold = true })
	vim.api.nvim_set_hl(0, 'StatusModeInsert',  { fg = c.A1, bg = c.D2, bold = true })
	vim.api.nvim_set_hl(0, 'StatusModeVisual',  { fg = c.A1, bg = c.C2, bold = true })
	vim.api.nvim_set_hl(0, 'StatusModeCommand', { fg = c.A1, bg = c.B1, bold = true })
	vim.api.nvim_set_hl(0, 'StatusModeReplace', { fg = c.A1, bg = c.A6, bold = true })
	vim.api.nvim_set_hl(0, 'StatusModeOther',   { fg = c.A1, bg = c.A4, bold = true })

	-- INFO: Statusbar sections
	vim.api.nvim_set_hl(0, 'StatusBarB', { fg = c.B2, bg = c.A0 }) -- branch / git / diagnostics
	vim.api.nvim_set_hl(0, 'StatusBarC', { fg = c.A4, bg = c.A1 }) -- center fill

	-- INFO: Git diff — base (fg only, winbar-safe)
	vim.api.nvim_set_hl(0, 'BarGitAdd',    { fg = c.B0 })
	vim.api.nvim_set_hl(0, 'BarGitChange', { fg = c.C0 })
	vim.api.nvim_set_hl(0, 'BarGitDel',    { fg = c.D0 })

	-- Git diff — statusbar B-section variants (same fg + B-section bg)
	with_bg('StatusGitAdd',    'BarGitAdd',    c.A0)
	with_bg('StatusGitChange', 'BarGitChange', c.A0)
	with_bg('StatusGitDel',    'BarGitDel',    c.A0)

	-- INFO: Diagnostics — base (fg only, winbar-safe)
	vim.api.nvim_set_hl(0, 'BarDiagError', { fg = c.D4 })
	vim.api.nvim_set_hl(0, 'BarDiagWarn',  { fg = c.C5_warn })
	vim.api.nvim_set_hl(0, 'BarDiagInfo',  { fg = c.C5_info })
	vim.api.nvim_set_hl(0, 'BarDiagHint',  { fg = c.A7 })

	-- Diagnostics — statusbar B-section variants (same fg + B-section bg)
	with_bg('StatusDiagError', 'BarDiagError', c.A0)
	with_bg('StatusDiagWarn',  'BarDiagWarn',  c.A0)
	with_bg('StatusDiagInfo',  'BarDiagInfo',  c.A0)
	with_bg('StatusDiagHint',  'BarDiagHint',  c.A0)
end

apply()

autocmd.new_autocmd('ColorScheme', 'codes.abe.winbar.highlights', {
	callback = apply,
})
