-- Per-language install orchestration. MUST run inside a coroutine
-- (spawn_co), because the build primitives all yield via process.sys().

local log         = require('logger')
local paths       = require('treesitter.paths')
local fsutil      = require('treesitter.fsutil')
local registry    = require('treesitter.registry')
local queries_mod = require('treesitter.queries')

local semver      = require('treesitter.install.build.semver')
local clone       = require('treesitter.install.build.clone')
local compile     = require('treesitter.install.build.compile')
local query_fetch = require('treesitter.install.build.query_fetch')
local postcheck   = require('treesitter.install.build.postcheck')

local M = {}

---run the install pipeline for a single language. Returns true on success.
---@param lang string
---@return boolean ok
function M.run(lang)
	local entry = registry.get(lang)
	if not entry then
		log.error(('[treesitter] unknown language: %s'):format(lang))
		return false
	end

	local src = entry.source
	log.info(('[treesitter] installing %s…'):format(lang))

	-- Parser fetch + build (external_queries only)
	if src.type == 'external_queries' then
		local parser_ref
		if src.parser_semver then
			-- parser_semver is a hint, not a contract — the registry sets it
			-- optimistically and many listed repos don't actually tag. Warn
			-- so drift is visible, but fall back to the default branch
			-- rather than failing the install outright.
			parser_ref = semver.latest_tag(src.parser_url)
			if not parser_ref then
				log.warn(('[treesitter] %s: no semver tag at %s, using default branch'):format(lang, src.parser_url))
			end
		end
		local ptmp, perr = clone.shallow(src.parser_url, parser_ref)
		if not ptmp then
			log.error(('[treesitter] %s: %s'):format(lang, perr))
			return false
		end
		local so, berr = compile.parser(lang, ptmp, src.parser_location)
		if not so then
			fsutil.rm(ptmp)
			log.error(('[treesitter] %s: %s'):format(lang, berr))
			return false
		end
		fsutil.ensure_dir(paths.PARSER_DIR)
		local dst = paths.parser_path(lang)
		-- Copy to a sibling temp then atomic-rename into place. A direct
		-- fs_copyfile into `dst` would truncate the target on crash/OOM,
		-- leaving a broken `.so` that postcheck only warns about.
		local tmp_dst = dst .. '.tmp'
		vim.uv.fs_unlink(tmp_dst)
		local ok_cp, cp_err = vim.uv.fs_copyfile(so, tmp_dst)
		if not ok_cp then
			fsutil.rm(ptmp)
			log.error(('[treesitter] %s: copy %s -> %s failed: %s')
				:format(lang, so, tmp_dst, tostring(cp_err)))
			return false
		end
		local ok_mv, mv_err = fsutil.atomic_rename(tmp_dst, dst)
		if not ok_mv then
			fsutil.rm(ptmp)
			log.error(('[treesitter] %s: %s'):format(lang, mv_err))
			return false
		end
		fsutil.rm(vim.fs.dirname(so))
		fsutil.rm(ptmp)
	end

	-- Queries fetch (both entry types)
	local q_url    = src.queries_url or src.url
	local q_semver = src.queries_semver
	if q_semver == nil then q_semver = src.semver end

	-- queries_only entries exist purely to fetch highlight/injection queries;
	-- a missing url means either a registry bug or a schema we don't
	-- understand. Fail loudly so the user knows no queries were installed.
	if src.type == 'queries_only' and not q_url then
		log.error(('[treesitter] %s: queries_only entry has no url'):format(lang))
		return false
	end

	local queries_ok = true
	if q_url then
		local qref
		if q_semver then
			qref = semver.latest_tag(q_url)
			if not qref then
				log.warn(('[treesitter] %s: no semver tag at %s, using default branch'):format(lang, q_url))
			end
		end
		local qtmp, qerr = clone.shallow(q_url, qref)
		if not qtmp then
			log.warn(('[treesitter] %s queries: %s'):format(lang, qerr))
			queries_ok = false
		else
			local ok, cerr = query_fetch.copy(lang, qtmp)
			fsutil.rm(qtmp)
			if not ok then
				log.warn(('[treesitter] %s: %s'):format(lang, cerr))
				queries_ok = false
			end
		end
	end

	-- queries_only: no parser was built, so failure to fetch queries means
	-- nothing was installed at all.
	if src.type == 'queries_only' and not queries_ok then
		log.error(('[treesitter] %s: queries fetch failed — nothing installed. Retry with `:TSInstall %s` once the network is available.'):format(lang, lang))
		return false
	end

	-- external_queries: parser compiled and copied into place, but queries
	-- failed. A parser without highlight/injection queries is useless for
	-- its primary purpose, so roll back the .so rather than leave a
	-- half-broken state on disk — the user shouldn't have to remember
	-- that <lang>.so exists but can't highlight anything. Trade-off: on a
	-- :TSUpdate where the old install was fine and only the refresh
	-- failed, the user loses the old parser too. Acceptable because they
	-- can re-run :TSInstall to recover, and "half-installed" is worse UX
	-- than "not installed" when the user has to reason about it later.
	if src.type == 'external_queries' and not queries_ok then
		fsutil.rm(paths.parser_path(lang))
		log.error(('[treesitter] %s: queries fetch failed — parser rolled back, nothing installed. Retry with `:TSInstall %s` once the network is available.'):format(lang, lang))
		return false
	end

	postcheck.run(lang)
	queries_mod.reload(lang)

	require('treesitter.attach').attach_open_buffers(lang)

	log.info(('[treesitter] installed %s'):format(lang))
	return true
end

return M
