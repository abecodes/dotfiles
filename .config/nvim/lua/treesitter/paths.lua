-- Canonical treesitter filesystem paths + existence helper.
--
-- Source of truth for DATA_ROOT, PARSER_DIR, QUERIES_DIR. Consumers must
-- require this module rather than recomputing the joins locally — past
-- drift between copies has hidden bugs (e.g. one site updated, others
-- not).

local fsutil = require('treesitter.fsutil')

local M = {}

M.DATA_ROOT   = vim.fs.joinpath(vim.fn.stdpath('data'), 'treesitter')
M.PARSER_DIR  = vim.fs.joinpath(M.DATA_ROOT, 'parser')
M.QUERIES_DIR = vim.fs.joinpath(M.DATA_ROOT, 'queries')

function M.parser_path(lang)  return vim.fs.joinpath(M.PARSER_DIR, lang .. '.so') end
function M.queries_path(lang) return vim.fs.joinpath(M.QUERIES_DIR, lang) end
function M.exists(p)          return vim.uv.fs_stat(p) ~= nil end

---Sorted list of installed parser langs (filenames matching `<lang>.so`).
---@return string[]
function M.installed_parsers()
	local result = {}
	for _, fname in ipairs(fsutil.list_by_ext(M.PARSER_DIR, 'so')) do
		table.insert(result, (fname:gsub('%.so$', '')))
	end
	table.sort(result)
	return result
end

return M
