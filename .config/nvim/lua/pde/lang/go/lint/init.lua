-- golangci-lint orchestrator.
-- Wiring: BufWritePost for *.go via lua/hooks.lua → this module's `.run`;
-- exposed as `:Golint` (and `ll`) from after/ftplugin/go.lua. The whole-module
-- variant is exposed as `.all` → `:GolintAll`.
--
-- Two scopes share one implementation via make_linter():
--   'package' — lint just the file's package (fast; default for save/`ll`/:Golint)
--   'module'  — lint the whole module via ./... (slower; only :GolintAll)
--
-- Both scopes invoke golangci-lint with the same `-c $HOME/.golangci.yaml`
-- config; the factory guarantees they cannot drift.
--
-- Concerns split into sibling modules:
--   severity   — prefix tables + classifier (pure)
--   parse      — stdout → vim.diagnostic.set (side-effecting)
--
-- The "linting…" float badge comes from ui.float_badge (shared with
-- pde.lang.go.format).
--
-- The orchestrator owns: namespace, per-buffer running job, per-buffer
-- badge handle, and the job lifecycle (cancel prior → open badge
-- → spawn → wire callbacks → close badge on exit).

local utils          = require('utils')
local logger         = require('logger')
local parse          = require('pde.lang.go.lint.parse')
local badge          = require('ui.float_badge')

local namespace      = vim.api.nvim_create_namespace('codes.abe.hooks.golangci')

-- Per-buffer in-flight jobstart job id. Rapid :wa / :e can spawn overlapping
-- golangci runs; we cancel the prior job so the latest-content run wins.
local running_jobs   = {}

-- Per-buffer badge handle, parallel to running_jobs and owned by the
-- same lifecycle so cancellation and exit both close the float.
local running_floats = {}

---@param scope '"package"'|'"module"'
local function make_linter(scope)
	return function()
		-- Capture buffer identity at job-start time. The async callbacks close over
		-- these so that switching buffers while golangci runs does not corrupt results.
		local bufnr       = vim.api.nvim_get_current_buf()
		local filepath    = vim.fs.normalize(vim.api.nvim_buf_get_name(bufnr))
		local filedir     = vim.fs.normalize(utils.buf.get_filedir())

		-- golangci-lint reports Pos.Filename relative to the module root (go.mod dir),
		-- not relative to the invocation directory. Walk upward to find it.
		local go_mod      = vim.fs.find('go.mod', { upward = true, path = filedir, limit = 1 })
		local module_root = go_mod[1] and vim.fs.normalize(vim.fn.fnamemodify(go_mod[1], ':h')) or filedir

		-- Package path passed to golangci-lint (resolved against cwd=module_root).
		--   'module'  → lint the whole module
		--   'package' → lint just the file's package directory
		-- Defensive fallback to './...' if filedir is somehow not under module_root.
		local pkg_arg
		if scope == 'module' then
			pkg_arg = './...'
		elseif filedir == module_root then
			pkg_arg = '.'
		elseif filedir:sub(1, #module_root + 1) == module_root .. '/' then
			pkg_arg = './' .. filedir:sub(#module_root + 2)
		else
			pkg_arg = './...'
		end

		-- Cancel any prior run for this buffer. jobstop is a no-op on finished jobs,
		-- so this is safe regardless of whether the previous run completed. Close
		-- the prior float eagerly too — the cancelled job's on_exit will fire
		-- eventually but we don't want a stale "linting..." hanging around.
		if running_jobs[bufnr] then
			pcall(vim.fn.jobstop, running_jobs[bufnr])
			running_jobs[bufnr] = nil
		end
		if running_floats[bufnr] then
			badge.close(running_floats[bufnr])
			running_floats[bufnr] = nil
		end

		-- Clear both extmarks (highlight layer) and diagnostics (diagnostic layer).
		-- Short-circuit paths inside parse (decode failure, Report.Error, missing
		-- Issues field) would otherwise leave stale diagnostics behind.
		vim.api.nvim_buf_clear_namespace(bufnr, namespace, 0, -1)
		vim.diagnostic.reset(namespace, bufnr)

		local ctx = {
			bufnr       = bufnr,
			filepath    = filepath,
			module_root = module_root,
			namespace   = namespace,
		}

		local handle_stdout = function(_, data)
			if not data then return end
			-- stdout_buffered=true delivers all lines in one call; join before
			-- decoding so the result is correct even if golangci ever emits
			-- pretty-printed JSON instead of compact single-line JSON.
			parse.apply(ctx, table.concat(data, ""))
		end

		local stderr_lines, handle_stderr = utils.proc.stderr_accumulator()

		local float = badge.open(' linting... ')
		running_floats[bufnr] = float

		-- golangci-lint exits 1 when it finds issues (delivered via stdout JSON).
		-- Exit code >= 2 indicates a tool error; only then surface stderr.
		-- Guard slot writes by identity: a cancelled prior run's on_exit fires
		-- after the new run has claimed the slot; unguarded writes would nil out
		-- the wrong entry.
		local job_id
		local handle_exit = function(_, code)
			if running_jobs[bufnr] == job_id then
				running_jobs[bufnr] = nil
			end
			if running_floats[bufnr] == float then
				running_floats[bufnr] = nil
			end
			badge.close(float)
			if code >= 2 and #stderr_lines > 0 then
				logger.warn(utils.proc.format_err('golangci-lint', code, table.concat(stderr_lines, '\n')))
			end
		end

		-- Run from the module root so package paths resolve correctly regardless
		-- of scope. `pkg_arg` selects between the file's package and `./...`.
		job_id = utils.proc.run_async(
			{
				-- 'golangci-lint',
				'custom-gcl',
				'run',
				'-c',
				-- vim.fs.normalize('~/.golangci.yaml'),
				vim.fs.normalize('~/.custom_golangci.yml'),
				'--output.tab.path=/dev/null',
				'--output.json.path=stdout',
				pkg_arg,
			},
			{
				cwd             = module_root,
				stdout_buffered = true,
				stderr_buffered = true,
				on_stdout       = handle_stdout,
				on_stderr       = handle_stderr,
				on_exit         = handle_exit,
			}
		)
		running_jobs[bufnr] = job_id
	end
end

-- Wiping a buffer mid-lint would otherwise leave a dangling job and a stale
-- "linting..." float. Clean up eagerly; also prevents bufnr-reuse races where
-- the old job's on_exit could touch state belonging to a new buffer.
vim.api.nvim_create_autocmd('BufWipeout', {
	group = vim.api.nvim_create_augroup('codes.abe.hooks.golangci.cleanup', { clear = true }),
	callback = function(args)
		local bufnr = args.buf
		if running_jobs[bufnr] then
			pcall(vim.fn.jobstop, running_jobs[bufnr])
			running_jobs[bufnr] = nil
		end
		if running_floats[bufnr] then
			badge.close(running_floats[bufnr])
			running_floats[bufnr] = nil
		end
	end,
})

-- Tear down every in-flight lint badge before exit. Without this, an async
-- badge spawned in BufWritePost outlives the quit and renders empty once
-- exit teardown wipes its scratch buffer; it also covers the cmdline area
-- that plugins like vim-startify use to prompt for session save.
--
-- QuitPre runs before such prompts, so the badge is gone by the time the
-- user sees one. VimLeavePre is the safety net for paths that bypass
-- QuitPre (plugin-driven exits, :cquit). Cancelled :q (modified buffer)
-- will also clear in-flight badges — acceptable since they are cosmetic.
local function reset_all()
	for bufnr, job_id in pairs(running_jobs) do
		pcall(vim.fn.jobstop, job_id)
		running_jobs[bufnr] = nil
	end
	for bufnr, float in pairs(running_floats) do
		badge.close(float)
		running_floats[bufnr] = nil
	end
end

vim.api.nvim_create_autocmd({ 'QuitPre', 'VimLeavePre' }, {
	group = vim.api.nvim_create_augroup('codes.abe.hooks.golangci.exit', { clear = true }),
	callback = reset_all,
})

return {
	run = make_linter('package'),
	all = make_linter('module'),
}
