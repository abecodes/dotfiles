-- Central BufWritePre format-on-save hook registration.
-- Per-server after/lsp/<server>.lua files were each declaring a nearly
-- identical 3-line hooks.register block; this helper keeps the policy in
-- one place while leaving per-server opt-in (servers that don't format on
-- save, like efm/gopls, simply don't call it).
--
-- Hook ordering: BufWritePre hooks are stored in registration order inside
-- lua/hooks/bucket.lua. Within one pattern, pre-callbacks run first, then
-- the LSP format, then post-callbacks.

local hooks = require('hooks.hooks')

local M = {}

local function fmt()
	vim.lsp.buf.format({ timeout_ms = 1000 })
end

---register a BufWritePre hook that runs `pre` (optional) then `vim.lsp.buf.format`
---then `post` (optional) for the given pattern.
---@param pattern string  hooks pattern, e.g. '*.lua', '*.ts,*.tsx,*.js,*.jsx'
---@param pre?    (fun())[]  callbacks to run BEFORE format (e.g. organize_imports)
---@param post?   (fun())[]  callbacks to run AFTER  format (e.g. vim.diagnostic.show)
M.register = function(pattern, pre, post)
	local list = {}
	if pre then
		for _, f in ipairs(pre) do table.insert(list, f) end
	end
	table.insert(list, fmt)
	if post then
		for _, f in ipairs(post) do table.insert(list, f) end
	end
	hooks.register(pattern, 'BufWritePre', list)
end

return M
