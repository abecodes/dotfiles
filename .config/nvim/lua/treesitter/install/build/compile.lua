-- Compile a tree-sitter parser into a shared object.
--
-- Pipeline:
--   1. If src/parser.c missing + grammar.js present: run `tree-sitter generate`.
--   2. Compile cc/c++ + scanner.{c,cc} → <tempdir>/<lang>.so.
--      Honors $CC / $CXX for non-default toolchains.
--      Adds -std=c++17 when a C++ scanner is present (modern STL features).

local paths   = require('treesitter.paths')
local fsutil  = require('treesitter.fsutil')
local process = require('treesitter.install.build.process')

local M = {}

---compile the parser. src_dir is the cloned repo root; parser_location is
---an optional subdir for monorepo layouts (e.g. tree-sitter-typescript puts
---tsx/typescript in sibling dirs).
---@param lang string
---@param src_dir string
---@param parser_location? string
---@return string? so_path
---@return string? err
function M.parser(lang, src_dir, parser_location)
	local root = parser_location and vim.fs.joinpath(src_dir, parser_location) or src_dir
	local src  = vim.fs.joinpath(root, 'src')

	if not paths.exists(vim.fs.joinpath(src, 'parser.c')) then
		if not paths.exists(vim.fs.joinpath(root, 'grammar.js')) then
			return nil, ('no grammar.js or src/parser.c in %s'):format(root)
		end
		local gen = process.sys({ 'tree-sitter', 'generate' }, { cwd = root })
		if gen.code ~= 0 then
			return nil, ('tree-sitter generate failed: %s'):format((gen.stderr or ''):gsub('\n$', ''))
		end
	end

	local tmp_out = vim.fn.tempname()
	fsutil.ensure_dir(tmp_out)
	local out = vim.fs.joinpath(tmp_out, lang .. '.so')

	local has_c  = paths.exists(vim.fs.joinpath(src, 'scanner.c'))
	local has_cc = paths.exists(vim.fs.joinpath(src, 'scanner.cc'))
	-- Honor $CXX / $CC so users on custom toolchains (e.g. Nix, Alpine) don't
	-- silently fall back to a wrong default compiler.
	local cc     = has_cc and (vim.env.CXX or 'c++') or (vim.env.CC or 'cc')
	local cmd    = { cc, '-shared', '-fPIC', '-O2', '-I', src, '-o', out,
	                 vim.fs.joinpath(src, 'parser.c') }
	-- Several C++ scanners use modern STL features (structured bindings,
	-- string_view, if-init) that require c++17. c++17 is a strict superset
	-- of c++14 — safe for older scanners, unblocks newer ones.
	if has_cc then
		table.insert(cmd, '-std=c++17')
	end
	if has_c then
		table.insert(cmd, vim.fs.joinpath(src, 'scanner.c'))
	elseif has_cc then
		table.insert(cmd, vim.fs.joinpath(src, 'scanner.cc'))
	end

	local r = process.sys(cmd)
	if r.code ~= 0 then
		-- Caller only knows about the source clone temp; the success path
		-- cleans tmp_out via dirname(so). Mirror that on the failure path
		-- so a flaky compiler doesn't accrete tempdirs over a session.
		fsutil.rm(tmp_out)
		return nil, ('compile failed: %s'):format((r.stderr or ''):gsub('\n$', ''))
	end
	return out, nil
end

return M
