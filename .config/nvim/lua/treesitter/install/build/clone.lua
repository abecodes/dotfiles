-- Shallow git clone with optional ref pinning.
--
-- LOCKFILE HOOK: when we add lua/treesitter/lock.json (future), intercept
-- `shallow()` here: read the lockfile entry for <lang>, pass the exact SHA
-- as `ref` instead of a tag/branch, and on a successful install write the
-- resolved SHA back.

local process = require('treesitter.install.build.process')

local M = {}

---clone url at optional ref (tag/branch) into a fresh temp dir.
---@param url string
---@param ref? string
---@return string? tmp_dir
---@return string? err
function M.shallow(url, ref)
	local tmp = vim.fn.tempname()
	-- Submodules in some grammar repos use git@github.com: URLs, which
	-- require a working ssh key to github. Rewrite SSH → HTTPS at the git
	-- config level so public submodules clone cleanly without keys.
	local cmd = {
		'git', '-c', 'url.https://github.com/.insteadOf=git@github.com:',
		'clone', '--depth', '1', '--recurse-submodules',
	}
	if ref then
		table.insert(cmd, '--branch')
		table.insert(cmd, ref)
	end
	table.insert(cmd, url)
	table.insert(cmd, tmp)
	local r = process.sys(cmd)
	if r.code ~= 0 then
		return nil, ('git clone %s failed: %s'):format(url, (r.stderr or ''):gsub('\n$', ''))
	end
	return tmp, nil
end

return M
