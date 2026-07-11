-- Semver tag resolution for parser / queries repos.

local log     = require('logger')
local process = require('treesitter.install.build.process')

local M = {}

---pick the highest semver-looking tag from a remote. numeric-core comparison
---plus a semver-2.0.0 pre-release tiebreaker: when numeric parts tie, the tag
---without a suffix ranks higher than any -rc / -beta / -alpha variant.
---@param url string
---@return string? tag nil when ls-remote fails or no tag matches
function M.latest_tag(url)
	local r = process.sys({ 'git', 'ls-remote', '--tags', '--refs', url })
	if r.code ~= 0 then
		log.warn(('[treesitter] ls-remote %s failed: %s'):format(url, r.stderr or ''))
		return nil
	end
	local tags = {}
	for line in (r.stdout or ''):gmatch('[^\n]+') do
		local tag = line:match('refs/tags/(v?%d+%.%d+%.%d+[%w%.%-]*)')
		if tag then table.insert(tags, tag) end
	end
	if #tags == 0 then return nil end
	local function parts(t)
		local core = t:gsub('^v', '')
		local numbers, suffix = core:match('^(%d+%.%d+%.%d+)(.*)$')
		local p = {}
		for n in (numbers or ''):gmatch('%d+') do table.insert(p, tonumber(n)) end
		-- has_suffix = 1 when a pre-release / build tag is present, 0 otherwise.
		-- Lower is better so a bare v1.0.0 outranks v1.0.0-rc1.
		p.has_suffix = (suffix and suffix ~= '') and 1 or 0
		return p
	end
	table.sort(tags, function(a, b)
		local pa, pb = parts(a), parts(b)
		for i = 1, math.max(#pa, #pb) do
			local va, vb = pa[i] or 0, pb[i] or 0
			if va ~= vb then return va > vb end
		end
		if pa.has_suffix ~= pb.has_suffix then
			return pa.has_suffix < pb.has_suffix
		end
		return false
	end)
	return tags[1]
end

return M
