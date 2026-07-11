-- Shared filesystem helpers for the in-tree treesitter install pipeline.
--
-- Extracted from duplicated copies across compile.lua, query_fetch.lua,
-- install_one.lua, queries.lua, postcheck.lua, commands.lua, registry.lua.

local M = {}

---Create the directory (and any missing parents). No error on existing.
---@param path string
function M.ensure_dir(path)
	vim.fn.mkdir(path, 'p')
end

---Read the file at `path` as a single string; lines are joined with '\n'.
---Returns nil if the file can't be read.
---@param path string
---@return string?
function M.read_text(path)
	local ok, lines = pcall(vim.fn.readfile, path)
	if not ok or not lines then return nil end
	return table.concat(lines, '\n')
end

---Atomically rename `tmp` into `dst`. Deletes any pre-existing `dst`; on
---rename failure cleans up `tmp` and returns the underlying error. Caller
---is responsible for populating `tmp` (file or directory) before invoking.
---@param tmp string
---@param dst string
---@return boolean ok
---@return string? err
function M.atomic_rename(tmp, dst)
	vim.fn.delete(dst, 'rf')
	local ok, err = vim.uv.fs_rename(tmp, dst)
	if not ok then
		vim.fn.delete(tmp, 'rf')
		return false, ('rename %s -> %s failed: %s'):format(tmp, dst, tostring(err))
	end
	return true, nil
end

---readdir that always returns a table (empty on missing / unreadable dir).
---@param path string
---@return string[]
function M.readdir(path)
	return vim.fn.readdir(path) or {}
end

---Delete path (file or dir) if it exists. No-op otherwise.
---@param path string
function M.rm(path)
	if vim.uv.fs_stat(path) then vim.fn.delete(path, 'rf') end
end

---List entries in `path` whose names end with `.<ext>`. Extension is matched
---case-sensitively without the dot (`list_by_ext(dir, 'scm')`).
---@param path string
---@param ext string
---@return string[]
function M.list_by_ext(path, ext)
	local out, suffix = {}, '%.' .. ext .. '$'
	for _, name in ipairs(M.readdir(path)) do
		if name:match(suffix) then table.insert(out, name) end
	end
	return out
end

return M
