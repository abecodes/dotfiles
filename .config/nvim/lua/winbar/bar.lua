-- Section registry + redraw wiring for the winbar and statusline.
--
-- The old implementation pushed renders through a 16ms timer loop. The new
-- one is pull-based: `vim.o.winbar` and `vim.o.statusline` are set to
-- `%!v:lua.require('winbar.winbar').render()` (and the statusbar equivalent)
-- so Neovim calls `render()` once per screen redraw. Cursor moves, mode
-- changes, buffer/window switches, and scroll already cause redraws.
-- Events that don't (LSP attach/detach, DiagnosticChanged, gitsigns update)
-- are wired via autocmds that call `vim.api.nvim__redraw`. A single 60s
-- timer remains for the wall-clock tick in the statusbar.
--
-- See ARCHITECTURE.md in this directory for the section authoring guide.

local logger  = require('logger')
local autocmd = require('utils.autocmd')

local M = {}

-- Styling helpers (`wrap_hl`, `hl`, `limit_str`) live in `utils.hl` — reach
-- them via `require('utils.hl')` from section code.

-- ----------------------------------------------------------------------
-- Section registry
-- ----------------------------------------------------------------------

---@alias BarTarget 'statusline' | 'winbar'
---@alias BarSide  'left' | 'center' | 'right'

---@alias BarCtx { winid: integer, bufnr: integer }

---@class BarSection
---@field side     BarSide                    which side the section belongs to
---@field priority integer                    lower = earlier within its side
---@field render   fun(ctx: BarCtx): string   returns the section's content string (winbar: ctx is the drawn window; statusline: ctx may be nil)
---@field condition? fun(ctx: BarCtx): boolean  optional gate; when false the section is skipped this render
---@field name?    string                     optional label used in error messages

---@type table<BarTarget, BarSection[]>
local sections = {
	statusline = {},
	winbar     = {},
}

---Register a section for the given target. Sections are sorted once per
---registration (low-frequency; sections are typically registered at startup).
---@param target BarTarget
---@param spec BarSection
function M.register_section(target, spec)
	assert(sections[target], 'unknown target: ' .. tostring(target))
	assert(spec.side and spec.render, 'spec needs side and render')
	spec.priority = spec.priority or 100
	table.insert(sections[target], spec)
	table.sort(sections[target], function(a, b)
		if a.side ~= b.side then
			-- left < center < right (stable visual order)
			local order = { left = 1, center = 2, right = 3 }
			return order[a.side] < order[b.side]
		end
		return a.priority < b.priority
	end)
end

-- errors are logged once per section to keep `:messages` clean when a
-- section fails repeatedly (every redraw would re-log otherwise).
local logged_errors = {}

local function render_section(target, sec, ctx)
	if sec.condition and not sec.condition(ctx) then
		return ''
	end
	local ok, result = pcall(sec.render, ctx)
	if not ok then
		local key = target .. ':' .. (sec.name or tostring(sec.render))
		if not logged_errors[key] then
			logged_errors[key] = true
			logger.error('[winbar] section ' .. key .. ' errored: ' .. tostring(result))
		end
		return ''
	end
	return result or ''
end

---Compose the final `%!`-expression string for `target`. Called by Neovim
---on every redraw (via the `%!v:lua.require(...).render()` expression).
---MUST stay fast and side-effect-free — it runs in a display-eval context.
---Target-specific gating (e.g. suppress winbar on UI buffers) lives in each
---section's `condition`; this function only composes.
---`ctx` carries the drawn-window id and its buffer so winbar sections read
---the right window (statusline_winid). Statusbar callers pass nil since
---laststatus=3 makes the drawn window == focused window anyway.
---@param target BarTarget
---@param ctx? {winid: integer, bufnr: integer}
---@return string
function M.render(target, ctx)
	local left, center, right = {}, {}, {}
	for _, sec in ipairs(sections[target] or {}) do
		local out = render_section(target, sec, ctx)
		if out ~= '' then
			if sec.side == 'left' then
				table.insert(left, out)
			elseif sec.side == 'center' then
				table.insert(center, out)
			else
				table.insert(right, out)
			end
		end
	end

	local L = table.concat(left)
	local C = table.concat(center)
	local R = table.concat(right)

	-- If nothing rendered, produce a fully empty bar instead of a bare `%=`.
	if L == '' and C == '' and R == '' then return '' end

	if C ~= '' then
		return L .. '%=' .. C .. '%=' .. R
	end
	return L .. '%=' .. R
end

-- ----------------------------------------------------------------------
-- Diagnostic count cache
-- ----------------------------------------------------------------------
-- vim.diagnostic.get(nil) on every statusline redraw walks every buffer's
-- diagnostic list; vim.diagnostic.get(0) walks the current buffer's. Both
-- render on nearly every user input. The counts only change when
-- DiagnosticChanged fires — rebuild the cache there, let render_* read 4
-- integers. vim.diagnostic.count returns the full {[severity]=n} table, so
-- the recount is cheaper than the previous walk-and-count loops anyway.

M.diag_workspace = {}        -- { [severity] = count } for the whole session
M.diag_by_buf    = {}        -- { [bufnr] = { [severity] = count } }

local function recount_workspace() M.diag_workspace = vim.diagnostic.count(nil) end
local function recount_buf(bufnr)  M.diag_by_buf[bufnr] = vim.diagnostic.count(bufnr) end

---Read per-buffer counts, populating the cache lazily on first access. Used
---by `winbar.lua` so the first render after startup isn't a blank
---diagnostics section (before any DiagnosticChanged has fired).
---@param bufnr integer
---@return table<integer, integer>
function M.buf_diag_counts(bufnr)
  local c = M.diag_by_buf[bufnr]
  if c == nil then
    c = vim.diagnostic.count(bufnr)
    M.diag_by_buf[bufnr] = c
  end
  return c
end

-- ----------------------------------------------------------------------
-- LSP client-name cache
-- ----------------------------------------------------------------------
-- vim.lsp.get_clients({bufnr=0}) allocates on every winbar redraw. The set
-- of attached clients only changes on LspAttach/LspDetach, so cache the
-- name list per buffer and invalidate there.

M.lsp_by_buf = {}  -- { [bufnr] = { 'gopls', 'efm', ... } }

local function recount_lsp(bufnr)
  local names = {}
  for _, c in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
    table.insert(names, c.name)
  end
  M.lsp_by_buf[bufnr] = names
end

---Read cached client names for `bufnr`, populating lazily on first access.
---@param bufnr integer
---@return string[]
function M.buf_lsp_names(bufnr)
  local n = M.lsp_by_buf[bufnr]
  if n == nil then
    recount_lsp(bufnr)
    n = M.lsp_by_buf[bufnr]
  end
  return n
end

-- ----------------------------------------------------------------------
-- Redraw wiring
-- ----------------------------------------------------------------------

---Force a bar redraw. Prefer the narrow-scope form where possible.
---@param opts? {statusline?: boolean, winbar?: boolean, tabline?: boolean}
local function redraw(opts)
	opts = opts or { statusline = true, winbar = true }
	-- nvim__redraw is the documented 0.10+ API; pcall-guard in case the
	-- signature shifts in a future release.
	pcall(vim.api.nvim__redraw, opts)
end

---Install the autocmds that cover the data sources not tied to a natural
---redraw trigger. Idempotent — safe to call twice; the augroup is cleared.
function M.setup_autocmds()
	local grp = autocmd.new_augroup('winbar_bar_redraw')

	-- Seed the workspace count so the first render after startup reflects any
	-- diagnostics already present (e.g. from a restored session).
	recount_workspace()

	-- LSP publishes diagnostics out-of-band — nothing redraws on its own.
	-- Per-buffer recount is synchronous so cursor-triggered redraws against
	-- the current buffer see fresh numbers. The workspace walk and forced
	-- redraw are debounced: LSP startup on a large project emits one publish
	-- per file, and vim.diagnostic.count(nil) is a workspace-wide walk —
	-- without coalescing that's O(n) cost per event.
	local diag_burst_seq = 0
	autocmd.new_autocmd('DiagnosticChanged', grp, {
		callback = function(ev)
			recount_buf(ev.buf)
			diag_burst_seq = diag_burst_seq + 1
			local my_seq = diag_burst_seq
			vim.defer_fn(function()
				if my_seq ~= diag_burst_seq then return end
				recount_workspace()
				redraw({ statusline = true, winbar = true })
			end, 50)
		end,
	})

	-- Drop per-buffer cache entries so the table doesn't grow unbounded over
	-- a long session. Both events are listened to because `:bdelete` fires
	-- BufDelete without BufWipeout (the buffer stays in memory unlisted),
	-- and `:bwipeout` fires BufWipeout without BufDelete. The callback is
	-- idempotent if both happen to fire for the same buffer.
	autocmd.new_autocmd({ 'BufDelete', 'BufWipeout' }, grp, {
		callback = function(ev)
			M.diag_by_buf[ev.buf] = nil
			M.lsp_by_buf[ev.buf]  = nil
		end,
	})

	-- LSP attach/detach changes what winbar.lsp and winbar.diagnostics report.
	-- Recount first so render_lsp reads fresh names; redraw second.
	autocmd.new_autocmd({ 'LspAttach', 'LspDetach' }, grp, {
		callback = function(ev)
			recount_lsp(ev.buf)
			redraw({ statusline = true, winbar = true })
		end,
	})

	-- Neovim redraws the statusline on most mode changes already; this
	-- catches the corner cases (e.g. operator-pending transitions).
	autocmd.new_autocmd('ModeChanged', grp, {
		callback = function() redraw({ statusline = true }) end,
	})

	-- gitsigns emits this when its b-vars change. Pattern'd to skip unrelated
	-- User events.
	autocmd.new_autocmd('User', grp, {
		pattern  = 'GitSignsUpdate',
		callback = function() redraw({ statusline = true }) end,
	})
end

-- ----------------------------------------------------------------------
-- Clock timer (the only remaining timer)
-- ----------------------------------------------------------------------

-- Minute-precision wall clock in the statusbar needs a periodic kick;
-- nothing else does. Fire at the next minute boundary then every 60s.
-- Stored globally so a `:luafile` / re-require doesn't create a leak.
if not _G.__winbar_clock_timer then
	local timer = vim.uv.new_timer()
	if timer then
		local ms_to_next_minute = ((60 - (os.time() % 60)) * 1000)
		timer:start(ms_to_next_minute, 60 * 1000, vim.schedule_wrap(function()
			-- Sections that cache wall-clock strings subscribe to this event
			-- and refresh before the redraw picks them up.
			pcall(vim.api.nvim_exec_autocmds, 'User',
				{ pattern = 'WinbarClockTick', modeline = false })
			pcall(vim.api.nvim__redraw, { statusline = true })
		end))
		_G.__winbar_clock_timer = timer
	end
end

return M
