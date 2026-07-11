local utils  = require('utils')
local logger = require('logger')
local badge  = require('ui.float_badge')

-- Synchronous by design. BufWritePre needs the buffer to be final before the
-- write completes, so we can't yield here without risking a write of the
-- pre-format content. golines is non-negotiable (width control) so we can't
-- swap to an LSP-only format path either.
--
-- Async alternative (not implemented): move the pipeline to BufWritePost,
-- run golines|gci on the just-written file, diff the output against the
-- current buffer, apply the diff as a single atomic edit, then
-- `silent noautocmd write`. Trade-offs:
--   + UI never blocks on format.
--   - Two writes per save (double fsync; git hooks fire twice).
--   - Brief window where the on-disk file is unformatted.
--   - Diff-apply must rebase if the user typed between save and format.
-- Only worth it if golines+gci routinely exceeds ~200ms on your codebase.
-- abefmt's -t is the tab width used when measuring line length. Go indents
-- with hard tabs, so this should match how the buffer displays them.
-- 'tabstop' is the authoritative source; fall back to 'shiftwidth' (0 means
-- "follow tabstop", so it's ignored), and default to 2 when neither is
-- meaningfully set. Returned as a string because proc args must be strings.
local function tab_width()
	for _, opt in ipairs({ 'tabstop', 'shiftwidth' }) do
		local v = vim.api.nvim_get_option_value(opt, { buf = 0 })
		if type(v) == 'number' and v ~= 0 and v ~= 2 then
			return tostring(v)
		end
	end
	return '2'
end

return function()
	if utils.buf.is_effectively_empty(0) then
		return
	end

	local content = vim.api.nvim_buf_get_lines(0, 0, -1, false)
	local view = vim.fn.winsaveview()

	local handle = badge.open(' formatting... ')
	vim.cmd('redraw')

	local ok, err = pcall(function()
		local abefmt_res = utils.proc.run_sync(
			{
				'abefmt',
				'-m', '80',
				'-t', tab_width(),
			},
			{ stdin = content }
		)
		if abefmt_res.code ~= 0 then
			logger.warn(utils.proc.format_err('abefmt', abefmt_res.code, abefmt_res.stderr))
			return
		end

		-- local golines_res = utils.proc.run_sync(
		-- 	{ 'golines', '-m', '80', '-t', '2', '--no-chain-split-dots', '--base-formatter', 'gofumpt' },
		-- 	{ stdin = content }
		-- )
		-- if golines_res.code ~= 0 then
		-- 	logger.warn(utils.proc.format_err('golines', golines_res.code, golines_res.stderr))
		-- 	return
		-- end
		--
		-- local gci_res = utils.proc.run_sync(
		-- 	{ 'gci', 'print', '-s', 'standard', '-s', 'default', '-s', 'blank', '-s', 'dot' },
		-- 	{ stdin = golines_res.stdout }
		-- )
		-- if gci_res.code ~= 0 then
		-- 	logger.warn(utils.proc.format_err('gci', gci_res.code, gci_res.stderr))
		-- 	return
		-- end

		-- vim.api.nvim_buf_set_lines(0, 0, -1, false, vim.split(gci_res.stdout, '\n'))
		vim.api.nvim_buf_set_lines(0, 0, -1, false, vim.split(abefmt_res.stdout, '\n'))
		utils.buf.trim_trailing_blanks(0)
	end)

	badge.close(handle)
	vim.fn.winrestview(view)

	if not ok then
		logger.error('go/format: ' .. tostring(err))
	end
end
