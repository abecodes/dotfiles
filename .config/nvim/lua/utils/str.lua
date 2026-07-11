local M = {}

---string is nil or blank
---@param str string|nil
---@return boolean
M.str_is_empty = function(str)
	return str == nil or str == ''
end

M.str_has_prefix = function(str, prefix)
	return str:sub(1, #prefix) == prefix
end

M.str_has_suffix = function(str, suffix)
	return suffix == "" or str:sub(-#suffix) == suffix
end

---tokenize a string on runs of whitespace, collapsing empties
---(e.g. tokenize('  a  b ') → {'a', 'b'}). returns {} for nil.
---for literal-separator splits use `vim.split(s, sep, { plain = true })`.
---@param str string|nil
---@return string[]
M.tokenize = function(str)
	local t = {}
	if str == nil then return t end
	for token in string.gmatch(str, '%S+') do
		table.insert(t, token)
	end
	return t
end

---uppercase first char of a string
---@param str string
---@return string
M.str_capitalize = function(str)
	return (str:gsub("^%l", string.upper))
end

---lowercase first char of a string
---@param str string
---@return string
M.str_lowerlize = function(str)
	return (str:gsub("^%u", string.lower))
end

---strip one or more trailing '/' from a string.
---@param s string
---@return string
M.trim_trailing_slash = function(s)
	return (s:gsub('/+$', ''))
end

---trim an ISO-8601 timestamp to minute precision and swap 'T' for a space
---(e.g. "2026-04-18T10:23:45.123+0000" → "2026-04-18 10:23"). returns '' when
---the input is not a non-empty string.
---@param iso string|nil
---@return string
M.format_timestamp = function(iso)
	if type(iso) ~= 'string' or iso == '' then return '' end
	return (iso:sub(1, 16):gsub('T', ' '))
end

return M
