local M = {}

---run an external command asynchronously via vim.fn.jobstart.
---@param cmds string[]
---@param opts? table jobstart opts (cwd, env, stdout_buffered, on_stdout, on_stderr, on_exit, ...)
---@return integer job_id (>0 ok, 0 invalid args, -1 command not executable)
M.run_async = function(cmds, opts)
	return vim.fn.jobstart(cmds, opts or {})
end

---run an external command synchronously via vim.system + :wait().
---defaults: text = true so stdin/stdout/stderr are strings.
---opts: { cwd?, env?, stdin?, text?, timeout? }.
---@param cmds string[]
---@param opts? table
---@return vim.SystemCompleted
M.run_sync = function(cmds, opts)
	opts = opts or {}
	local sys_opts = {
		cwd   = opts.cwd,
		env   = opts.env,
		stdin = opts.stdin,
		text  = opts.text ~= false,
	}
	return vim.system(cmds, sys_opts):wait(opts.timeout)
end

---build a stderr-line accumulator for `jobstart`. returns `(lines, on_stderr)`:
---  - `lines` — array populated in-place as non-empty stderr lines arrive
---  - `on_stderr` — drop-in `on_stderr` handler
---pair with `stderr_buffered = true` in jobstart opts.
---@return string[] lines
---@return fun(_: integer, data: string[]|nil)
M.stderr_accumulator = function()
	local lines = {}
	return lines, function(_, data)
		if not data then return end
		for _, line in ipairs(data) do
			if line ~= '' then
				table.insert(lines, line)
			end
		end
	end
end

---format a uniform "<name> exited with code <code>[: <stderr>]" message for
---external-command failures. stderr is trimmed of trailing whitespace and
---omitted entirely when nil or empty.
---@param name string
---@param code integer
---@param stderr? string
---@return string
M.format_err = function(name, code, stderr)
	local msg = name .. ' exited with code ' .. tostring(code)
	if stderr == nil or stderr == '' then return msg end
	return msg .. ': ' .. (stderr:gsub('%s+$', ''))
end

return M
