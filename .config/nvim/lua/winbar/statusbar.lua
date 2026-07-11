-- Statusline: project-wide information (mode, branch, git diff, workspace
-- diagnostics, cursor location, clock).
--
-- Sections are registered with `winbar.bar`. Composition + redraw is handled
-- by that module. See ARCHITECTURE.md for the authoring guide.

local bar     = require('winbar.bar')
require('winbar.highlights')
local ICONS   = require('winbar.icons')
local diag    = require('winbar.diag')
local autocmd = require('utils.autocmd')

local M = {}

-- ----------------------------------------------------------------------
-- Mode handling
-- ----------------------------------------------------------------------

local mode_map = {
	['n']    = 'N',  ['no']   = 'N',  ['nov']  = 'N',
	['niI']  = 'N',  ['niR']  = 'N',  ['niV']  = 'N',
	['nt']   = 'N',  ['ntT']  = 'N',
	['v']    = 'V',  ['vs']   = 'V',
	['V']    = 'V',  ['Vs']   = 'V',
	['\22']  = 'V',  ['\22s'] = 'V',
	['s']    = 'S',  ['S']    = 'S',  ['\19']  = 'S',
	['i']    = 'I',  ['ic']   = 'I',  ['ix']   = 'I',
	['R']    = 'R',  ['Rc']   = 'R',  ['Rx']   = 'R',
	['Rv']   = 'R',  ['Rvc']  = 'R',  ['Rvx']  = 'R',
	['c']    = 'C',  ['cv']   = 'C',  ['ce']   = 'C',
	['r']    = 'R',  ['rm']   = 'M',  ['r?']   = '?',
	['!']    = '!',  ['t']    = 'T',
}

local mode_hls = {
	N = 'StatusModeNormal',
	I = 'StatusModeInsert',
	V = 'StatusModeVisual',
	S = 'StatusModeVisual',
	C = 'StatusModeCommand',
	R = 'StatusModeReplace',
}

local sw      = require('utils.hl').hl
local DIAG_HL = diag.kind_hl_map('Status')

-- Hoisted highlight prefixes. The statusline redraws on every cursor move /
-- mode change; static '%#HL#' strings can be built once at load time.
local HL_BAR_B   = sw('StatusBarB')
local HL_BAR_C   = sw('StatusBarC')
local HL_GIT_ADD = sw('StatusGitAdd')
local HL_GIT_CHG = sw('StatusGitChange')
local HL_GIT_DEL = sw('StatusGitDel')

local MODE_HL_PREFIX = {}
for letter, hl in pairs(mode_hls) do MODE_HL_PREFIX[letter] = sw(hl) end
local MODE_HL_OTHER = sw('StatusModeOther')

local DIAG_HL_PREFIX = {}
for kind, hl in pairs(DIAG_HL) do DIAG_HL_PREFIX[kind] = sw(hl) end

-- ----------------------------------------------------------------------
-- Section renderers
-- ----------------------------------------------------------------------

local function render_mode()
	local raw    = vim.api.nvim_get_mode().mode
	local letter = mode_map[raw] or raw:sub(1, 1):upper()
	return (MODE_HL_PREFIX[letter] or MODE_HL_OTHER) .. ' ' .. letter .. ' '
end

local function render_branch()
	local branch = vim.b.gitsigns_head
	if not branch or branch == '' then
		return ''
	end
	return ' ' .. ICONS.branch .. ' ' .. branch .. ' '
end

local function render_diff()
	local dict = vim.b.gitsigns_status_dict
	if not dict then
		return ''
	end

	local s = ''
	if (dict.added or 0) > 0 then
		s = s .. HL_GIT_ADD .. ' +' .. dict.added
	end
	if (dict.changed or 0) > 0 then
		s = s .. HL_GIT_CHG .. ' ~' .. dict.changed
	end
	if (dict.removed or 0) > 0 then
		s = s .. HL_GIT_DEL .. ' -' .. dict.removed
	end
	if s ~= '' then
		s = s .. ' '
	end
	return s
end

-- Workspace diagnostic counts are cached in winbar.bar and refreshed once per
-- DiagnosticChanged. Statusline redraws fire on every CursorMoved/scroll/mode
-- change; render_diagnostics only reads the cached table.
local function render_diagnostics()
	local s = diag.render(bar.diag_workspace, function(kind, n)
		return DIAG_HL_PREFIX[kind] .. ' ' .. ICONS['diag_' .. kind] .. ' ' .. n
	end)
	if s ~= '' then s = s .. ' ' end
	return s
end

-- os.date is cheap but non-zero, and the statusline redraws on every cursor
-- move. The wall-clock string only changes once per minute — cache it and let
-- the 60s timer in winbar.bar refresh it via User WinbarClockTick.
local cached_datetime = os.date('%a %H:%M')

do
	local grp = autocmd.new_augroup('winbar_statusbar_clock')
	autocmd.new_autocmd('User', grp, {
		pattern  = 'WinbarClockTick',
		callback = function() cached_datetime = os.date('%a %H:%M') end,
	})
end

local function render_datetime()
	return ' ' .. ICONS.clock .. ' ' .. cached_datetime .. ' '
end

local function render_location()
	return '| ' .. string.format('%3d:%-2d ', vim.fn.line('.'), vim.fn.charcol('.'))
end

-- ----------------------------------------------------------------------
-- Section registrations
-- ----------------------------------------------------------------------

bar.register_section('statusline', {
	side     = 'left',
	priority = 10,
	name     = 'statusbar.mode',
	render   = render_mode,
})

bar.register_section('statusline', {
	side     = 'left',
	priority = 20,
	name     = 'statusbar.git_and_diag',
	render   = function()
		-- B-section background: branch + diff, then reset and apply B-section
		-- fg/bg pair for diagnostics, then hand off to C-section bg that fills
		-- the center gap.
		return HL_BAR_B
			.. render_branch()
			.. render_diff()
			.. HL_BAR_B
			.. render_diagnostics()
			.. HL_BAR_C
	end,
})

bar.register_section('statusline', {
	side     = 'right',
	priority = 10,
	name     = 'statusbar.clock_and_location',
	render   = function()
		return HL_BAR_B .. render_datetime() .. render_location()
	end,
})

-- ----------------------------------------------------------------------
-- Public entry
-- ----------------------------------------------------------------------

function M.render()
	return bar.render('statusline')
end

return M
