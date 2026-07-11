-- Public install API: list_installed, install, update, uninstall.
-- Orchestration for a single language lives in install_one.lua.
-- User commands and the verify-sources report live in treesitter/commands.lua.

local log         = require('logger')
local fsutil      = require('treesitter.fsutil')
local paths       = require('treesitter.paths')
local registry    = require('treesitter.registry')
local process     = require('treesitter.install.build.process')
local install_one = require('treesitter.install.install_one')

local M = {}

---@return string[] sorted list of installed parser langs
function M.list_installed()
	return paths.installed_parsers()
end

-- Default parallelism for :TSInstall all / :TSUpdate. Each worker is a git
-- clone + compile; 10 cuts :TSInstall all (~170 langs) to a reasonable
-- wall-clock on modern laptops. Override via $TS_INSTALL_JOBS when network
-- or CPU contention demands a smaller pool.
local DEFAULT_JOBS = 10

local function jobs()
	local n = tonumber(vim.env.TS_INSTALL_JOBS)
	if n and n > 0 then return n end
	return DEFAULT_JOBS
end

-- Fan out install_one.run(lang) for each entry in `ordered` across a
-- bounded pool of coroutines. Logs a summary once the last worker finishes.
---@param ordered string[]
local function run_parallel(ordered)
	local sem = process.new_semaphore(jobs())
	local total, done, ok_count, fail_count = #ordered, 0, 0, 0
	for _, lang in ipairs(ordered) do
		process.spawn_co(function()
			sem:acquire()
			-- pcall is defense-in-depth: process.sys already wraps
			-- vim.system, but install_one also calls reload/attach which
			-- could raise. A raise here without release would leak a
			-- permit and wedge the tail of the queue forever.
			local pok, result = pcall(install_one.run, lang)
			sem:release()
			if not pok then
				log.error(('[treesitter] %s crashed: %s'):format(lang, tostring(result)))
			end
			local ok = pok and result
			if ok then ok_count = ok_count + 1 else fail_count = fail_count + 1 end
			done = done + 1
			if done == total then
				local level = fail_count > 0 and vim.log.levels.WARN or vim.log.levels.INFO
				log.log(
					('[treesitter] install finished: %d ok, %d failed'):format(ok_count, fail_count),
					level
				)
			end
		end)
	end
end

---install one or more languages.
---opts.sync  — install all baseline langs not yet present.
---opts.all   — install every lang in the registry.
---otherwise  — install each lang in `langs` and its transitive deps.
---@param langs? string[]
---@param opts? { sync?: boolean, all?: boolean }
function M.install(langs, opts)
	opts = opts or {}
	local todo = {}

	if opts.sync then
		local config = require('treesitter.config')
		local installed = M.list_installed()
		local seen = {}
		for _, l in ipairs(installed) do seen[l] = true end
		for _, l in ipairs(config.baseline or {}) do
			if not seen[l] then
				local ok_r, deps = pcall(registry.resolve_deps, l)
				if ok_r then
					for _, d in ipairs(deps) do table.insert(todo, d) end
				else
					log.error(('[treesitter] %s: %s'):format(l, deps))
				end
			end
		end
	elseif opts.all then
		-- :TSInstall all means "install every registry entry that isn't
		-- already installed" — not "reinstall everything". Force-reinstall
		-- is what :TSUpdate (no args) is for.
		local installed = M.list_installed()
		local seen_inst = {}
		for _, l in ipairs(installed) do seen_inst[l] = true end
		for _, l in registry.iter() do
			if not seen_inst[l] then table.insert(todo, l) end
		end
	else
		for _, l in ipairs(langs or {}) do
			local ok_r, deps = pcall(registry.resolve_deps, l)
			if ok_r then
				for _, d in ipairs(deps) do table.insert(todo, d) end
			else
				log.error(('[treesitter] %s: %s'):format(l, deps))
			end
		end
	end

	-- Dedupe preserving order.
	local seen, ordered = {}, {}
	for _, l in ipairs(todo) do
		if not seen[l] then
			seen[l] = true
			table.insert(ordered, l)
		end
	end

	if #ordered == 0 then
		log.info('[treesitter] nothing to install')
		return
	end

	run_parallel(ordered)
end

---re-install one or more languages. no args → every installed lang.
---@param langs? string[]
function M.update(langs)
	local targets = langs and #langs > 0 and langs or M.list_installed()
	if #targets == 0 then
		log.info('[treesitter] no parsers installed to update')
		return
	end
	run_parallel(targets)
end

---remove parser .so + queries dir for each lang. Synchronous (no clone/build).
---@param langs string[]
function M.uninstall(langs)
	for _, lang in ipairs(langs) do
		fsutil.rm(paths.parser_path(lang))
		fsutil.rm(paths.queries_path(lang))
		pcall(function() require('treesitter.attach').detach_for_lang(lang) end)
		log.info(('[treesitter] uninstalled %s'):format(lang))
	end
end

return M
