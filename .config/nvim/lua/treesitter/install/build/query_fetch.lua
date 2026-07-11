-- Copy .scm query files from a cloned queries repo into our queries dir.
--
-- Queries repos vary in layout. Candidates are tried in order; the first
-- layout that yields .scm files wins:
--   <repo>/queries/*.scm        — neovim-treesitter-queries-<lang> (common)
--   <repo>/*.scm                — scm at repo root
--   <repo>/<lang>/*.scm         — legacy
--   <repo>/queries/<lang>/*.scm — legacy
--
-- Write via a sibling staging dir + fs_rename so an interruption between
-- delete and copy never leaves `dest` empty or half-populated.

local paths  = require('treesitter.paths')
local fsutil = require('treesitter.fsutil')

local M = {}

---@param lang string
---@param src_dir string
---@return boolean ok
---@return string? err
function M.copy(lang, src_dir)
	local dest    = paths.queries_path(lang)
	local staging = dest .. '.tmp'
	fsutil.rm(staging)
	fsutil.ensure_dir(staging)

	local candidates = {
		vim.fs.joinpath(src_dir, 'queries'),
		src_dir,
		vim.fs.joinpath(src_dir, lang),
		vim.fs.joinpath(src_dir, 'queries', lang),
	}
	for _, dir in ipairs(candidates) do
		if paths.exists(dir) then
			local scms = fsutil.list_by_ext(dir, 'scm')
			for _, name in ipairs(scms) do
				local srcf = vim.fs.joinpath(dir, name)
				local dstf = vim.fs.joinpath(staging, name)
				local ok_cp, cp_err = vim.uv.fs_copyfile(srcf, dstf)
				if not ok_cp then
					fsutil.rm(staging)
					return false, ('copy %s -> %s failed: %s'):format(srcf, dstf, tostring(cp_err))
				end
			end
			if #scms > 0 then
				local ok_mv, mv_err = fsutil.atomic_rename(staging, dest)
				if not ok_mv then return false, mv_err end
				return true, nil
			end
		end
	end
	fsutil.rm(staging)
	return false, 'no .scm files found in queries repo'
end

return M
