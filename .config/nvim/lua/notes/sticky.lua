-- Sticky todo bar: a non-focusable 1-line float anchored to the top of the
-- current window (row 0 in window-relative coords, below the winbar).
--
-- Event-driven, not timer-driven. Updates fire when:
--   - The user switches buffer/window           (BufEnter, WinEnter)
--   - A window is resized or scrolled            (WinResized, WinScrolled)
--   - A todo is added/removed                    (User TodoChanged)
--   - A .todo file is written externally         (BufWritePost *.todo)
--   - A window closes                            (WinClosed)
--
-- Todo-file reads are gated on mtime, so the vast majority of re-renders
-- skip disk I/O entirely.

local todo      = require('notes.todo')
local buf_utils = require('utils.ui_buffer')
local float     = require('ui.float')
local autocmd   = require('utils.autocmd')
local palette   = require('theme.palette').semantic

local M = {}

-- Wired to ColorScheme because `:colorscheme` wipes user-defined hl groups.
local function apply_sticky_hl()
	vim.api.nvim_set_hl(0, 'StickyTodo', { fg = palette.sticky_fg, bg = palette.sticky_bg, bold = true })
end

require('utils.hl').apply_on_colorscheme(apply_sticky_hl, 'codes.abe.notes.sticky.highlights')

-- Nerd-font icons. Built from codepoints so the source stays legible
-- regardless of terminal font rendering and survives any text-processing
-- tool (Write, paste, email, etc.) that might mangle multi-byte glyphs.
-- Look up codepoints at https://www.nerdfonts.com/cheat-sheet.
local ICONS = {
	scope_branch  = vim.fn.nr2char(0xF062C),  -- U+F062C md-source_branch
	scope_project = vim.fn.nr2char(0xF0B8A),  -- U+F0B8A md-folder_multiple
}

-- ----------------------------------------------------------------------
-- Float state
-- ----------------------------------------------------------------------

local state = {
	win    = nil,  -- sticky float window id
	buf    = nil,  -- scratch buffer id
	anchor = nil,  -- window the float is attached to
	text   = nil,  -- currently displayed text (change detection)
}

-- ----------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------

local function center(text, width)
	local tw = vim.fn.strdisplaywidth(text)
	if tw >= width then return text end
	return string.rep(' ', math.floor((width - tw) / 2)) .. text
end

local function close_sticky()
	if state.win and vim.api.nvim_win_is_valid(state.win) then
		pcall(vim.api.nvim_win_close, state.win, true)
	end
	if state.buf and vim.api.nvim_buf_is_valid(state.buf) then
		pcall(vim.api.nvim_buf_delete, state.buf, { force = true })
	end
	state.win, state.buf, state.anchor, state.text = nil, nil, nil, nil
end

local function open_sticky(win_id, text)
	local width = vim.api.nvim_win_get_width(win_id)
	local buf   = float.scratch_buf()

	local ok, win = pcall(vim.api.nvim_open_win, buf, false, {
		relative  = 'win',
		win       = win_id,
		row       = 0,
		col       = 0,
		width     = width,
		height    = 1,
		focusable = false,
		style     = 'minimal',
		border    = 'none',
		zindex    = 10,
	})

	if not ok then
		pcall(vim.api.nvim_buf_delete, buf, { force = true })
		return
	end

	vim.wo[win].winhighlight = 'Normal:StickyTodo,EndOfBuffer:StickyTodo'
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, { center(text, width) })

	state.win    = win
	state.buf    = buf
	state.anchor = win_id
	state.text   = text
end

local function get_active()
	local first = todo.get_first('branch')
	if first then return first, 'branch' end
	first = todo.get_first('project')
	return first, 'project'
end

-- ----------------------------------------------------------------------
-- Render
-- ----------------------------------------------------------------------

local function render()
	local cur_win = vim.api.nvim_get_current_win()
	local cur_buf = vim.api.nvim_win_get_buf(cur_win)

	-- Skip floating windows (notes floats, telescope, etc.)
	if vim.api.nvim_win_get_config(cur_win).relative ~= '' then
		if state.win then close_sticky() end
		return
	end

	-- Skip UI / unnamed buffers.
	if buf_utils.is_ui_buffer(cur_buf) or vim.fn.expand('%') == '' then
		if state.win then close_sticky() end
		return
	end

	-- Close immediately if the user switched windows.
	if state.win and state.anchor ~= cur_win then
		close_sticky()
	end

	-- Width sync (cheap, no I/O).
	if state.win and vim.api.nvim_win_is_valid(state.win) then
		local w = vim.api.nvim_win_get_width(cur_win)
		if vim.api.nvim_win_get_width(state.win) ~= w then
			vim.api.nvim_win_set_width(state.win, w)
		end
	end

	local first, scope = get_active()
	if not first then
		if state.win then close_sticky() end
		return
	end

	local icon = scope == 'branch' and ICONS.scope_branch or ICONS.scope_project
	local text = icon .. ' ' .. first

	if not state.win then
		open_sticky(cur_win, text)
		return
	end

	if state.text ~= text then
		local w = vim.api.nvim_win_get_width(cur_win)
		vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, { center(text, w) })
		state.text = text
	end
end

-- ----------------------------------------------------------------------
-- Public API
-- ----------------------------------------------------------------------

---Install the event handlers. Idempotent — safe to call twice; the augroup
---is cleared on each call. Should be called from init.lua after the winbar
---is wired up.
function M.attach()
	local grp = autocmd.new_augroup('notes_sticky')

	autocmd.new_autocmd({ 'BufEnter', 'WinEnter' }, grp, {
		callback = render,
	})

	autocmd.new_autocmd({ 'WinResized', 'WinScrolled' }, grp, {
		callback = render,
	})

	-- User TodoChanged is fired by notes/todo.lua after add/delete.
	autocmd.new_autocmd('User', grp, {
		pattern  = 'TodoChanged',
		callback = render,
	})

	-- External edits to .todo files (e.g. review float saving).
	autocmd.new_autocmd('BufWritePost', grp, {
		pattern  = '*.todo',
		callback = render,
	})

	-- If the anchor window closes, we bail so we don't leak an orphan float
	-- pointing at a dead window.
	autocmd.new_autocmd('WinClosed', grp, {
		callback = function(args)
			local closed = tonumber(args.match)
			if state.anchor and state.anchor == closed then
				close_sticky()
			end
		end,
	})

	-- Fire once to render the initial state after startup completes.
	vim.schedule(render)
end

---Force an immediate refresh. Kept for external callers; now a thin wrapper
---around the User TodoChanged event so any other listeners also react.
function M.invalidate()
	vim.api.nvim_exec_autocmds('User', { pattern = 'TodoChanged', modeline = false })
end

return M
