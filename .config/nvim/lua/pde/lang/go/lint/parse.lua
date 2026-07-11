-- Parse golangci-lint JSON output (stdout_buffered=true delivers one chunk)
-- and write the resulting diagnostics into the namespace. Pure side-effect
-- on vim.diagnostic; no process/job handling here.
--
-- Sample shape (abridged):
--   {"Issues":[{"FromLinter":"ineffassign","Text":"...","Severity":"error",
--     "SourceLines":["..."],"Replacement":null,
--     "LineRange":{"From":13,"To":127},          -- may be missing
--     "Pos":{"Filename":"msg.go","Offset":4435,"Line":169,"Column":3},
--     "ExpectNoLint":false,"ExpectedNoLintLinter":""}]}

local logger   = require('logger')
local severity = require('pde.lang.go.lint.severity')

local M = {}

---@class lint.Ctx
---@field bufnr integer
---@field filepath string absolute path of the buffer being linted
---@field module_root string go.mod dir (or file dir fallback)
---@field namespace integer vim.diagnostic namespace id

---@param ctx lint.Ctx
---@param raw string raw stdout text (may be empty, "null", or JSON)
function M.apply(ctx, raw)
	-- Buffer may have been wiped (:bd) while golangci-lint was in flight.
	-- vim.diagnostic.set/reset on a stale bufnr errors; on_exit cleanup runs
	-- after on_stdout, so we can't rely on running_jobs tracking here.
	if not vim.api.nvim_buf_is_valid(ctx.bufnr) then return end
	if raw == "" or raw == "null" then return end

	local ok, decoded = pcall(vim.json.decode, raw)
	if not ok then
		logger.warn("golangci-lint: failed to parse output: " .. tostring(decoded))
		return
	end

	if decoded.Report and decoded.Report.Error then
		logger.warn("golangci-lint: " .. decoded.Report.Error)
		return
	end

	if not decoded.Issues then return end

	-- Resolve the buffer's treesitter tree once; get_node() re-does parser
	-- lookup per call, which adds up on files with hundreds of diagnostics.
	local root
	local ok_parser, parser = pcall(vim.treesitter.get_parser, ctx.bufnr)
	if ok_parser and parser then
		local trees = parser:parse()
		if trees and trees[1] then
			root = trees[1]:root()
		end
	end

	local out = {}

	for _, issue in ipairs(decoded.Issues) do
		-- Pos.Filename may be absolute (go/packages reports absolute paths) or
		-- relative to the module root. Resolve to a full path either way.
		-- Normalize because fnamemodify(':p') leaves './' components intact
		-- while vim.fs.normalize collapses them; ctx.filepath is already
		-- normalized by the orchestrator.
		local fname = issue.Pos.Filename
		local issue_path = fname:sub(1, 1) == '/'
			and fname
			or (ctx.module_root .. '/' .. fname)
		issue_path = vim.fs.normalize(issue_path)
		if issue_path ~= ctx.filepath then goto continue_issue end

		if not issue.LineRange then
			issue.LineRange = {
				From = issue.Pos.Line,
				To = issue.Pos.Line,
			}
		end

		-- golangci columns are 1-based; treesitter and diagnostics are 0-based.
		local start_col = math.max(0, issue.Pos.Column - 1)
		local end_col = start_col + 1

		-- Line/Column can be 0 for file-level issues; guard before descending
		-- the tree, which requires non-negative positions. On a blank line
		-- descendant_for_range returns root, whose range spans the whole file —
		-- skip that case so a blank-line diagnostic doesn't highlight everything.
		if root and issue.Pos.Line >= 1 and issue.Pos.Column >= 1 then
			local lnum = issue.Pos.Line - 1
			local cnum = issue.Pos.Column - 1
			local node = root:descendant_for_range(lnum, cnum, lnum, cnum)
			if node and node ~= root then
				_, start_col, _, end_col = node:range()
			end
		end

		local msg = {
			bufnr     = ctx.bufnr,
			lnum      = issue.LineRange.From - 1,
			end_lnum  = issue.LineRange.To - 1,
			col       = start_col,
			end_col   = end_col,
			severity  = severity.classify(issue),
			source    = issue.FromLinter,
			message   = issue.Text,
			user_data = {},
		}

		-- Several golangci linters (revive/file-header, revive/package-comments,
		-- funlen, cyclop, gocognit, …) report a LineRange that spans the whole
		-- offending construct. Neovim's builtin vim.diagnostic.handlers.virtual_lines
		-- anchors its virt_lines extmark at end_lnum (see render_virtual_lines:
		-- line_anchor[lnum] = max(end_lnum) → set_extmark(line_anchor[lnum])),
		-- so a multi-line diagnostic renders far below the line it was reported at.
		-- lsp_lines uses lnum so it isn't affected, but lsp_lines isn't always
		-- installed before the first BufWritePost lint runs — the builtin then
		-- wins and lines drift down by (LineRange.To - LineRange.From). Pin
		-- end_lnum to lnum; the treesitter-resolved col/end_col already gives
		-- a precise underline on the reported line.
		if msg.end_lnum > msg.lnum then
			msg.end_lnum = msg.lnum
			if msg.end_col <= msg.col then
				msg.end_col = msg.col + 1
			end

			-- Alternative: underline the *entire* start line instead of just the
			-- treesitter-resolved column range. Costs one nvim_buf_get_lines call
			-- per multi-line diagnostic. Uncomment the block below (and comment
			-- out the two lines above that pin end_col) to enable.
			--
			-- local line = vim.api.nvim_buf_get_lines(ctx.bufnr, msg.lnum, msg.lnum + 1, false)[1]
			-- msg.col = 0
			-- msg.end_col = line and #line or (msg.col + 1)
		end

		table.insert(out, msg)
		::continue_issue::
	end

	if #out > 0 then
		vim.diagnostic.set(
			ctx.namespace,
			ctx.bufnr,
			out,
			{
				severity_sort = true,
				underline     = true,
			}
		)
		return
	end

	vim.diagnostic.reset(ctx.namespace, ctx.bufnr)
end

return M
