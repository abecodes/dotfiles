local utils = require('utils')

local M = {}

-- Prefix → severity map. Populated below from per-severity lists (kept as
-- lists for readability; flattened into BY_FIRST_CHAR for dispatch).
local PREFIXES = {
	{ "shadow",                          vim.diagnostic.severity.WARN },
	{ "use-any",                         vim.diagnostic.severity.WARN },
	{ "add-constant",                    vim.diagnostic.severity.WARN },
	{ "unhandled-error",                 vim.diagnostic.severity.WARN },
	{ "nested-structs",                  vim.diagnostic.severity.WARN },
	{ "unexported-return",               vim.diagnostic.severity.WARN },
	{ "unused-receiver",                 vim.diagnostic.severity.WARN },
	{ "unused-parameter",                vim.diagnostic.severity.WARN },
	{ "singleCaseSwitch",                vim.diagnostic.severity.WARN },
	{ "var-declaration",                 vim.diagnostic.severity.WARN },
	{ "flag-parameter",                  vim.diagnostic.severity.WARN },
	{ "return with no blank line before",vim.diagnostic.severity.WARN },
	{ "composites",                      vim.diagnostic.severity.WARN },
	{ "SA4006",                          vim.diagnostic.severity.WARN },
	{ "cognitive-complexity",            vim.diagnostic.severity.WARN },

	{ "confusing-naming",                vim.diagnostic.severity.HINT },
	{ "line-length-limit",               vim.diagnostic.severity.HINT },
	{ "get-return",                      vim.diagnostic.severity.HINT },
	{ "error-strings",                   vim.diagnostic.severity.HINT },
	{ "empty-block",                     vim.diagnostic.severity.HINT },
	{ "import-alias-naming",             vim.diagnostic.severity.HINT },
	{ "exported",                        vim.diagnostic.severity.HINT },
	{ "package-comments",                vim.diagnostic.severity.HINT },

	{ "function-length",                 vim.diagnostic.severity.INFO },
	{ "ifElseChain",                     vim.diagnostic.severity.INFO },
	{ "max-public-structs",              vim.diagnostic.severity.INFO },
	{ "cyclomatic",                      vim.diagnostic.severity.INFO },
	{ "argument-limit",                  vim.diagnostic.severity.INFO },
	{ "function-result-limit",           vim.diagnostic.severity.INFO },
	{ "redundant-import-alias",          vim.diagnostic.severity.INFO },
}

-- Dispatch by first char. Typical bucket holds 2–5 entries; a classify call
-- does one hash lookup then 2–5 short prefix compares instead of scanning
-- all 30 entries across three lists. Exact `str_has_prefix` semantics are
-- preserved — we only skip buckets whose first char cannot match.
local BY_FIRST_CHAR = {}
for _, entry in ipairs(PREFIXES) do
	local c = entry[1]:sub(1, 1)
	BY_FIRST_CHAR[c] = BY_FIRST_CHAR[c] or {}
	table.insert(BY_FIRST_CHAR[c], entry)
end

local function prefix_severity(text)
	local bucket = BY_FIRST_CHAR[text:sub(1, 1)]
	if not bucket then return nil end
	for _, entry in ipairs(bucket) do
		if utils.str.str_has_prefix(text, entry[1]) then
			return entry[2]
		end
	end
	return nil
end

---classify a golangci-lint issue into a diagnostic severity.
---@param issue { Text: string, Severity?: string }
---@return integer severity vim.diagnostic.severity value
function M.classify(issue)
	local text = issue.Text

	local by_prefix = prefix_severity(text)
	if by_prefix then return by_prefix end

	if utils.str.str_has_suffix(text, "is unused")
		or string.find(text, "is missing field", 1, true) then
		return vim.diagnostic.severity.HINT
	end

	-- "returns generic interface" must be checked before "returns interface"
	-- because the latter is a substring of the former.
	if string.find(text, "returns generic interface", 1, true)
		or string.find(text, "returns interface", 1, true) then
		return vim.diagnostic.severity.INFO
	end

	if issue.Severity == "error" then
		return vim.diagnostic.severity.ERROR
	end

	return vim.diagnostic.severity.WARN
end

return M
