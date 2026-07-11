-- Require the submodule directly: lua/utils/init.lua aggregates utils.git,
-- so depending on 'utils' here would be a cycle. utils.proc has no deps.
local proc = require('utils.proc')

local M = {}

---current git branch for cwd, or '' when not in a repo / git unavailable.
---@return string
M.git_branch = function()
	local res = proc.run_sync({ 'git', 'rev-parse', '--abbrev-ref', 'HEAD' })
	if res.code ~= 0 then return '' end
	local stdout = res.stdout or ''
	local first = stdout:match('^([^\n]*)')
	return first or ''
end

return M
