-- Shared diagnostic-count renderer used by winbar and statusbar.
-- Both bars iterate the same four severities in the same order and build
-- a string from a caller-supplied per-severity formatter. The formatter
-- returns the pre-styled chunk (highlight-wrapped icon + count).

local severities = {
	{ key = vim.diagnostic.severity.ERROR, kind = 'error' },
	{ key = vim.diagnostic.severity.WARN,  kind = 'warn'  },
	{ key = vim.diagnostic.severity.INFO,  kind = 'info'  },
	{ key = vim.diagnostic.severity.HINT,  kind = 'hint'  },
}

-- kind → highlight-name suffix. Winbar and statusbar share this shape and
-- differ only in the group-name prefix (Bar* vs Status*).
local KIND_SUFFIX = { error = 'Error', warn = 'Warn', info = 'Info', hint = 'Hint' }

local M = {}

---Build a kind→hl-group map for the given prefix (e.g. 'Bar' → 'BarDiagError').
---@param prefix string
---@return table<'error'|'warn'|'info'|'hint', string>
function M.kind_hl_map(prefix)
	local out = {}
	for kind, suffix in pairs(KIND_SUFFIX) do
		out[kind] = prefix .. 'Diag' .. suffix
	end
	return out
end

---Render a diagnostic count line from `counts` using `fmt(kind, n)`.
---Severities with zero count are skipped. Returns '' when all zero.
---@param counts table<integer, integer>
---@param fmt fun(kind: 'error'|'warn'|'info'|'hint', n: integer): string
---@return string
function M.render(counts, fmt)
	local s = ''
	for _, sev in ipairs(severities) do
		local n = counts[sev.key] or 0
		if n > 0 then s = s .. fmt(sev.kind, n) end
	end
	return s
end

return M
