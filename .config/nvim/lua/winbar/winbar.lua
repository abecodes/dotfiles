--[[
+1 Statusline to display project wide information ( workspace diagnostics, counting git repo changes etc) and winbar to display file local information (buffer diagnostics, counting buffer changes, LSP breadcrumbs, etc)	
]] --

local icons_ok, icons = pcall(require, 'nvim-web-devicons')
local navic_ok, navic = pcall(require, 'nvim-navic')
local utils = require('utils')

local path_limit = 15

-- INFO: tracking if we are already rendering
local rendering = false

local excludes = {
	"help",
	"startify",
	"packer",
	"neogitstatus",
	-- TODO: check if those are still used
	"Trouble",
	"Outline",
}

-- INFO: styling
vim.api.nvim_set_hl(0, 'WinBar', {})
vim.api.nvim_set_hl(0, 'WinBarNC', {})
vim.api.nvim_set_hl(0, 'WinBarPath', { link = 'Comment' })
vim.api.nvim_set_hl(0, 'WinBarModified', { link = 'SpecialComment' })

local function wrap_hl(hl, str)
	return '%#' .. hl .. '#'
			.. str
			.. '%*'
end

local function wrap_modified(str)
	if not vim.api.nvim_get_option_value(
				'modified',
				{
					buf = 0
				}
			) then
		return str
	end

	return wrap_hl('WinBarPath', str)
end

local function limit_str(str, limit)
	if #str > limit then
		str = '..' .. str:sub(-1 * (limit - 2))
	end

	return str
end

local function render_icon()
	if not icons_ok or
			utils.str_is_empty(utils.get_fileext()) then
		return ''
	end

	return wrap_hl(
		'DevIcon' .. utils.get_fileext(),
		icons.get_icon(
			utils.get_filename(),
			utils.get_fileext(),
			{ default = true, strict = true }
		)
	)
end

local function render_lsp()
	local msg = ''
	local clients = vim.lsp.get_clients({ bufnr = 0 })

	if next(clients) == nil then
		return 'no_lsp'
	end

	for _, client in ipairs(clients) do
		if msg == '' then
			msg = client.name
		else
			msg = msg .. ", " .. client.name
		end
	end

	return msg
end

local function render_path()
	local path = vim.fn.expand('%:~:.:p')
	if #path > path_limit then
		if #vim.fn.expand('%:~:.:t') > path_limit then
			path = vim.fn.expand('%:~:.:t')
		else
			path = ''

			local splts = utils.split(vim.fn.expand('%:~:.:h'), "/")
			for key, value in ipairs(splts) do
				if key == #splts then
					path = path .. '/' .. value:sub(1, 3) .. '/' .. vim.fn.expand('%:~:.:t')

					break
				end

				if key ~= 1 then
					path = path .. '/'
				end

				path = path .. value:sub(1, 3)
			end
		end

		-- if #path > path_limit then
		--	path = '..' .. path:sub(-1 * (path_limit + 2))
		-- end
	end

	return limit_str(path, path_limit)

	-- return wrap_hl(
	--	'WinBarPath',
	--	-- remove ':.' to get absolute path instead relative one
	--	-- .. vim.fn.expand('%:~:.:p')
	--	path
	-- )
end

local function render_diagnostics()
	local diagnostics = vim.diagnostic.get(0)
	local count = { 0, 0, 0, 0 }

	for _, diagnostic in ipairs(diagnostics) do
		if vim.startswith(vim.diagnostic.get_namespace(diagnostic.namespace).name, 'vim.lsp') then
			count[diagnostic.severity] = count[diagnostic.severity] + 1
		end
	end
	local msg = ''

	if count[vim.diagnostic.severity.ERROR] > 0 then
		msg = msg .. wrap_hl('DiagnosticError', '󰅚 ' .. count[vim.diagnostic.severity.ERROR])
	end

	if count[vim.diagnostic.severity.WARN] > 0 then
		msg = msg .. wrap_hl('DiagnosticWarn', '󰀪 ' .. count[vim.diagnostic.severity.WARN])
	end

	if count[vim.diagnostic.severity.INFO] > 0 then
		msg = msg .. wrap_hl('DiagnosticInfo', '󰋽 ' .. count[vim.diagnostic.severity.INFO])
	end

	if count[vim.diagnostic.severity.HINT] > 0 then
		msg = msg .. wrap_hl('DiagnosticHint', '󰌶 ' .. count[vim.diagnostic.severity.HINT])
	end

	if #msg > 0 then
		return msg .. '|'
	end

	return msg
end

local function render_format()
	local format = vim.bo.fileformat

	if format == 'unix' then
		return ' '
	end

	if format == 'dos' then
		return ' '
	end

	if format == 'mac' then
		return ' '
	end

	return format
end

-- local function render_modified()
--	if not vim.api.nvim_get_option_value(
--				'modified',
--				{
--					buf = 0
--				}
--			) then
--		return ''
--	end

--	return wrap_hl('WinBarModified', '')
-- end

local function render_gps()
	if not navic_ok or not navic.is_available then
		return ''
	end

	local loc = navic.get_location()

	if utils.str_is_empty(loc) then
		return ''
	end

	return navic.get_location():gsub("%s+", "")
end

local function render()
	if rendering then
		return
	end

	if vim.tbl_contains(excludes, vim.bo.filetype) or
			utils.str_is_empty(utils.get_filename()) then
		vim.opt_local.winbar = nil

		return
	end

	rendering = true

	local width = vim.api.nvim_win_get_width(0)

	--[[
	-- TODO:
	-- - auto set '|' in group if prev/next string is not empty
	-- - move file name limiting to content
	-- (- for gps only trim whitespace next to alphanumeric chars)
	--]] --

	local content = render_icon()
			.. ' '
			.. wrap_modified(render_path())
			-- .. render_modified()
			.. '%=' -- nvim auto spacer
			.. wrap_hl(
				'WinBarPath', limit_str(render_gps(), width * 0.7)
			)
			.. '%=' -- nvim auto spacer
			.. '['
			.. render_diagnostics()
			-- .. '|'
			.. render_lsp()
			.. '|'
			.. render_format()
			.. ']'

	vim.schedule(function()
		local status_ok, _ = pcall(
			vim.api.nvim_set_option_value,
			'winbar',
			content,
			{ scope = 'local' }
		)

		rendering = false

		if not status_ok then
			return
		end

		-- vim.api.nvim__redraw({ winbar = true })
	end)
end

-- INFO: trigger render on events
-- vim.api.nvim_create_autocmd(
--	{
--		'DirChanged',
--		'CursorMoved',
--		'BufWinEnter',
--		'BufFilePost',
--		'InsertEnter',
--		'BufWritePost'
--	},
--	{
--		callback = function()
--			render()
--		end
--	}
-- )

-- INFO: scheduled render check
-- Create a timer handle (implementation detail: uv_timer_t).
local timer = vim.uv.new_timer()
-- Waits 1000ms, then repeats every 16ms until timer:close().
-- 16ms ~60fps
timer:start(1000, 16, vim.schedule_wrap(render))
