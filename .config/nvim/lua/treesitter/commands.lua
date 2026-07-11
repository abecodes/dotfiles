-- User commands: :TSInstall, :TSUpdate, :TSUninstall, :TSVerifySources.
-- The verify-sources report is colocated here because it's purely a
-- user-facing diagnostic against the pinned registry.json.

local log      = require('logger')
local install  = require('treesitter.install')
local registry = require('treesitter.registry')
local fsutil   = require('treesitter.fsutil')
local process  = require('treesitter.install.build.process')
local cmd_util = require('utils.cmd')

local M = {}

---structural diff of our pinned registry.json against upstream main.
---Opens a scratch buffer with the report.
function M.verify_sources()
	process.spawn_co(function()
		if vim.fn.executable('curl') ~= 1 then
			log.error('[treesitter] verify_sources: curl not found on PATH')
			return
		end
		local upstream_url = 'https://raw.githubusercontent.com/neovim-treesitter/treesitter-parser-registry/main/registry.json'
		local r = process.sys({ 'curl', '-sL', upstream_url })
		if r.code ~= 0 then
			log.error('[treesitter] verify_sources: curl failed: ' .. (r.stderr or ''))
			return
		end
		local ok_u, upstream = pcall(vim.json.decode, r.stdout)
		if not ok_u then
			log.error('[treesitter] verify_sources: invalid JSON from upstream')
			return
		end

		local our_path = vim.fs.joinpath(vim.fn.stdpath('config'), 'lua/treesitter/registry.json')
		local our_text = fsutil.read_text(our_path)
		if not our_text then
			log.error('[treesitter] verify_sources: cannot read registry.json')
			return
		end
		local ok_o, ours = pcall(vim.json.decode, our_text)
		if not ok_o then
			log.error('[treesitter] verify_sources: invalid JSON in pinned registry.json: ' .. tostring(ours))
			return
		end

		local added, removed, changed = {}, {}, {}
		for k, _ in pairs(upstream) do
			if k:sub(1, 1) ~= '$' and not ours[k] then table.insert(added, k) end
		end
		for k, v in pairs(ours) do
			if k:sub(1, 1) ~= '$' then
				if not upstream[k] then
					table.insert(removed, k)
				elseif not vim.deep_equal(upstream[k], v) then
					table.insert(changed, k)
				end
			end
		end
		table.sort(added); table.sort(removed); table.sort(changed)

		local function count_entries(t)
			local n = 0
			for k, _ in pairs(t) do if k:sub(1, 1) ~= '$' then n = n + 1 end end
			return n
		end

		local lines = {
			('Pinned commit:        %s'):format(registry.pinned_commit()),
			('Upstream main @ now:  %d entries'):format(count_entries(upstream)),
			('Our pinned copy:      %d entries'):format(count_entries(ours)),
			'',
			('Added upstream (%d):'):format(#added),
		}
		for _, k in ipairs(added)   do table.insert(lines, '  + ' .. k) end
		table.insert(lines, ('Removed upstream (%d):'):format(#removed))
		for _, k in ipairs(removed) do table.insert(lines, '  - ' .. k) end
		table.insert(lines, ('Changed upstream (%d):'):format(#changed))
		for _, k in ipairs(changed) do table.insert(lines, '  ~ ' .. k) end

		vim.schedule(function()
			vim.cmd('new')
			local buf = vim.api.nvim_get_current_buf()
			vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
			vim.bo[buf].bufhidden = 'wipe'
			vim.bo[buf].buftype = 'nofile'
			vim.bo[buf].filetype = 'text'
		end)
	end)
end

---register the :TS* user commands. Idempotent (nvim_create_user_command
---overwrites an existing command with the same name).
function M.setup()
	local function installed_completion(arglead)
		return vim.tbl_filter(
			function(x) return x:find(arglead, 1, true) == 1 end,
			install.list_installed()
		)
	end
	local function registry_completion(arglead)
		local out = {}
		for _, l in registry.iter() do
			if l:find(arglead, 1, true) == 1 then table.insert(out, l) end
		end
		return out
	end

	cmd_util.new_cmd('TSInstall', function(args)
		if #args.fargs == 0 then
			log.error('[treesitter] :TSInstall needs <lang>..., "sync", or "all"')
			return
		end
		if args.fargs[1] == 'sync' then
			install.install(nil, { sync = true })
		elseif args.fargs[1] == 'all' then
			install.install(nil, { all = true })
		else
			install.install(args.fargs)
		end
	end, {
		nargs = '+',
		complete = function(arglead) return registry_completion(arglead) end,
		desc = 'Install treesitter parser(s). Args: <lang>... | sync | all',
	})

	cmd_util.new_cmd('TSUpdate', function(args)
		install.update(args.fargs)
	end, {
		nargs = '*',
		complete = function(arglead) return installed_completion(arglead) end,
		desc = 'Re-install parser(s). No args = all installed',
	})

	cmd_util.new_cmd('TSUninstall', function(args)
		install.uninstall(args.fargs)
	end, {
		nargs = '+',
		complete = function(arglead) return installed_completion(arglead) end,
		desc = 'Uninstall parser(s)',
	})

	cmd_util.new_cmd('TSVerifySources', function()
		M.verify_sources()
	end, {
		desc = 'Diff our pinned registry.json against upstream main',
	})
end

return M
