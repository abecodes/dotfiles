-- Post-install validation (best-effort, warn-only).
-- Distinct from lua/treesitter/validate.lua (that's the startup ABI probe).

local log    = require('logger')
local paths  = require('treesitter.paths')
local fsutil = require('treesitter.fsutil')

local M = {}

---pcall language.add for the installed parser and query.parse for every
---installed .scm file. Failures log warnings; the install is NOT rolled
---back (queries can fail in ways that still let the parser load usefully).
---@param lang string
function M.run(lang)
	local p = paths.parser_path(lang)
	if paths.exists(p) then
		local ok, err = pcall(vim.treesitter.language.add, lang, { path = p })
		if not ok then
			log.warn(('[treesitter] %s: parser installed but language.add failed: %s'):format(lang, err))
		end
	end
	local qdir = paths.queries_path(lang)
	if paths.exists(qdir) then
		for _, name in ipairs(fsutil.list_by_ext(qdir, 'scm')) do
			local full = vim.fs.joinpath(qdir, name)
			local text = fsutil.read_text(full) or ''
			local ok, err = pcall(vim.treesitter.query.parse, lang, text)
			if not ok then
				log.warn(('[treesitter] %s/%s: query parse failed: %s'):format(lang, name, err))
			end
		end
	end
end

return M
