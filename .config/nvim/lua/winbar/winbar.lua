-- Winbar: file-local information (path, modified flag, breadcrumb,
-- buffer diagnostics, attached LSPs, file format).
--
-- Sections are registered with `winbar.bar`. Composition + redraw is handled
-- by that module. See ARCHITECTURE.md for the authoring guide.

local bar        = require('winbar.bar')
require('winbar.highlights')
local buf_utils  = require('utils.ui_buffer')
local autocmd    = require('utils.autocmd')
local ICONS      = require('winbar.icons')
local diag       = require('winbar.diag')
local breadcrumb = require('winbar.breadcrumb')

local icons_ok, icons = pcall(require, 'nvim-web-devicons')

local M = {}

local PATH_LIMIT = 15
local DIAG_HL    = diag.kind_hl_map('Bar')

-- ----------------------------------------------------------------------
-- Section renderers
-- ----------------------------------------------------------------------

local hl_utils  = require('utils.hl')
local limit_str = hl_utils.limit_str

-- Hoisted highlight prefixes. Building '%#HL#' per redraw is cheap but avoidable
-- for module-constant groups; bar sections rerun on every cursor move.
local HL_MODIFIED_OPEN = '%#WinBarModified#'
local HL_PATH_OPEN     = '%#WinBarPath#'
local HL_CLOSE         = '%*'
local DIAG_HL_OPEN     = {}
for kind, hl in pairs(DIAG_HL) do DIAG_HL_OPEN[kind] = '%#' .. hl .. '#' end

-- Per-buffer caches for values that depend on the buffer's filename/path but
-- not on cursor/mode. Invalidated by the autocmd group below.
local path_cache = {}   -- [bufnr] = rendered path string
local icon_cache = {}   -- [bufnr] = rendered icon string

-- Winbar render is evaluated per-window (unlike statusline with laststatus=3).
-- Everything below scopes to ctx.bufnr / ctx.winid so inactive splits render
-- their own content instead of the focused window's. See ARCHITECTURE.md.

local function buf_name(bufnr) return vim.api.nvim_buf_get_name(bufnr) end

local function wrap_modified(str, bufnr)
	if not vim.bo[bufnr].modified then
		return str
	end
	return HL_MODIFIED_OPEN .. str .. HL_CLOSE
end

local function compute_icon(bufnr)
	local name = buf_name(bufnr)
	if name == '' or not icons_ok then return '' end
	local ext = vim.fn.fnamemodify(name, ':e')
	if ext == '' then return '' end
	return '%#DevIcon' .. ext .. '#' .. icons.get_icon(
		vim.fn.fnamemodify(name, ':t'),
		ext,
		{ default = true }
	) .. HL_CLOSE
end

local function render_icon(ctx)
	local v = icon_cache[ctx.bufnr]
	if v == nil then
		v = compute_icon(ctx.bufnr)
		icon_cache[ctx.bufnr] = v
	end
	return v
end

local function compute_path(bufnr)
	local name = buf_name(bufnr)
	if name == '' then return '' end
	local path = vim.fn.fnamemodify(name, ':~:.')
	if vim.fn.strchars(path) > PATH_LIMIT then
		local tail = vim.fn.fnamemodify(name, ':t')
		if vim.fn.strchars(tail) > PATH_LIMIT then
			path = tail
		else
			path = ''
			local splts = vim.split(vim.fn.fnamemodify(name, ':~:.:h'), '/', { plain = true })
			for key, value in ipairs(splts) do
				if key == #splts then
					local sep = (path == '') and '' or '/'
					path = path .. sep .. value:sub(1, 3) .. '/' .. tail
					break
				end
				if key ~= 1 then
					path = path .. '/'
				end
				path = path .. value:sub(1, 3)
			end
		end
	end
	return limit_str(path, PATH_LIMIT)
end

local function render_path(ctx)
	local v = path_cache[ctx.bufnr]
	if v == nil then
		v = compute_path(ctx.bufnr)
		path_cache[ctx.bufnr] = v
	end
	return v
end

local function render_gps(ctx)
	return breadcrumb.render(ctx.bufnr, nil, ctx.winid)
end

local function render_diagnostics(ctx)
	-- Per-buffer counts come from winbar.bar, refreshed on DiagnosticChanged.
	-- buf_diag_counts populates lazily on first access so the initial render
	-- reflects existing diagnostics (e.g. from a restored session).
	local counts = bar.buf_diag_counts(ctx.bufnr)
	return diag.render(counts, function(kind, n)
		return DIAG_HL_OPEN[kind] .. ICONS['diag_' .. kind] .. ' ' .. n .. HL_CLOSE
	end)
end

local function render_lsp(ctx)
	local names = bar.buf_lsp_names(ctx.bufnr)
	if #names == 0 then return 'no_lsp' end
	return table.concat(names, ', ')
end

local function render_format(ctx)
	local format = vim.bo[ctx.bufnr].fileformat
	if format == 'unix' then return ICONS.fmt_unix .. ' ' end
	if format == 'dos'  then return ICONS.fmt_dos  .. ' ' end
	if format == 'mac'  then return ICONS.fmt_mac  .. ' ' end
	return format
end

-- ----------------------------------------------------------------------
-- Conditions
-- ----------------------------------------------------------------------

-- The winbar should only render for normal file buffers. UI/chrome buffers
-- and unnamed buffers get no winbar. One condition used by all sections.
local function is_file_buffer(ctx)
	if buf_utils.is_ui_buffer(ctx.bufnr) then return false end
	return buf_name(ctx.bufnr) ~= ''
end

-- ----------------------------------------------------------------------
-- Section registrations
-- ----------------------------------------------------------------------

bar.register_section('winbar', {
	side     = 'left',
	priority = 10,
	name     = 'winbar.file',
	condition = is_file_buffer,
	render = function(ctx)
		return render_icon(ctx) .. ' ' .. wrap_modified(render_path(ctx), ctx.bufnr)
	end,
})

bar.register_section('winbar', {
	side     = 'center',
	priority = 10,
	name     = 'winbar.gps',
	condition = is_file_buffer,
	render = function(ctx)
		local width = vim.api.nvim_win_get_width(ctx.winid)
		local gps   = render_gps(ctx)
		if gps == '' then return '' end
		return HL_PATH_OPEN .. limit_str(gps, math.floor(width * 0.7)) .. HL_CLOSE
	end,
})

bar.register_section('winbar', {
	side     = 'right',
	priority = 10,
	name     = 'winbar.status',
	condition = is_file_buffer,
	render = function(ctx)
		local parts = {}
		local d = render_diagnostics(ctx)
		if d ~= '' then table.insert(parts, d) end
		table.insert(parts, render_lsp(ctx))
		table.insert(parts, render_format(ctx))
		return '[' .. table.concat(parts, '|') .. ']'
	end,
})

-- ----------------------------------------------------------------------
-- Cache invalidation
-- ----------------------------------------------------------------------
-- path_cache/icon_cache are keyed by bufnr. The values derive from
-- nvim_buf_get_name + fnamemodify(:~:.) — they change on rename (BufFilePost),
-- save-as (BufWritePost), or cwd change (DirChanged, which shifts every
-- buffer's cwd-relative path). Buffer deletion (both :bd and :bwipeout)
-- should drop the entries.

do
	local grp = autocmd.new_augroup('winbar_winbar_cache')

	autocmd.new_autocmd({ 'BufFilePost', 'BufWritePost' }, grp, {
		callback = function(ev)
			path_cache[ev.buf] = nil
			icon_cache[ev.buf] = nil
		end,
	})

	autocmd.new_autocmd({ 'BufDelete', 'BufWipeout' }, grp, {
		callback = function(ev)
			path_cache[ev.buf] = nil
			icon_cache[ev.buf] = nil
		end,
	})

	autocmd.new_autocmd('DirChanged', grp, {
		callback = function() path_cache = {} end,
	})
end

-- ----------------------------------------------------------------------
-- Public entry — called by `%!v:lua.require('winbar.winbar').render()`
-- ----------------------------------------------------------------------

function M.render()
	-- `%!` expressions set vim.g.statusline_winid to the window being drawn.
	-- Fall back to the focused window if it's absent (e.g. direct require/call).
	local winid = vim.g.statusline_winid
	if winid == nil or winid == 0 or not vim.api.nvim_win_is_valid(winid) then
		winid = vim.api.nvim_get_current_win()
	end
	local bufnr = vim.api.nvim_win_get_buf(winid)
	return bar.render('winbar', { winid = winid, bufnr = bufnr })
end

return M
