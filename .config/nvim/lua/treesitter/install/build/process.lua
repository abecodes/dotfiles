-- Coroutine-based async shell for the install pipeline.
--
-- sys() must be called from inside a coroutine started via spawn_co(). It
-- yields until the process exits, returning the { code, stdout, stderr }
-- object from vim.system. UI stays responsive — yields let nvim redraw /
-- handle other events between step transitions.

local log = require('logger')

local M = {}

-- Every resume of a pipeline coroutine routes through here so an error
-- raised after the first yield (sys() callback, semaphore wakeup) surfaces
-- instead of being swallowed by coroutine.resume's return-value contract.
local function safe_resume(co, ...)
	local ok, err = coroutine.resume(co, ...)
	if not ok then
		log.error('[treesitter] coroutine crashed: ' .. tostring(err))
	end
end

---run a command and yield the coroutine until it finishes.
---MUST be called from inside a coroutine started via spawn_co().
---@param cmd string[]
---@param opts? vim.SystemOpts
---@return vim.SystemCompleted
function M.sys(cmd, opts)
	opts = opts or {}
	local co = coroutine.running()
	assert(co, 'sys() must be called from a coroutine')
	-- vim.system raises synchronously on spawn failure (ENOENT etc.). If we
	-- didn't catch it here, the raise would happen before the yield below,
	-- tearing down the coroutine while still holding a semaphore permit.
	local ok, err = pcall(vim.system, cmd, opts, function(obj)
		vim.schedule(function() safe_resume(co, obj) end)
	end)
	if not ok then
		return { code = 127, signal = 0, stdout = '', stderr = tostring(err) }
	end
	return coroutine.yield()
end

---start a coroutine running fn. Any uncaught error is surfaced via logger.
---@param fn fun()
function M.spawn_co(fn)
	local co = coroutine.create(fn)
	safe_resume(co)
end

---bounded-concurrency primitive for coroutines. acquire() yields when the
---counter is exhausted; release() resumes the oldest waiter (FIFO) via
---vim.schedule so we never resume from inside a caller's own stack frame.
---@param n integer permits
function M.new_semaphore(n)
	local s = { count = n, waiters = {} }
	function s:acquire()
		if self.count > 0 then
			self.count = self.count - 1
			return
		end
		local co = assert(coroutine.running(),
			'semaphore acquire() must be called from a coroutine')
		table.insert(self.waiters, co)
		coroutine.yield()
	end
	function s:release()
		local co = table.remove(self.waiters, 1)
		if co then
			vim.schedule(function() safe_resume(co) end)
		else
			self.count = self.count + 1
		end
	end
	return s
end

return M
