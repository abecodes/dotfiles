local navic = require("nvim-navic")

local function whichLsp()
	local msg = 'No Active Lsp'
	local buf_ft = vim.api.nvim_buf_get_option(0, 'filetype')
	local clients = vim.lsp.get_active_clients()
	if next(clients) == nil then
		return msg
	end
	for _, client in ipairs(clients) do
		local filetypes = client.config.filetypes
		if filetypes and vim.fn.index(filetypes, buf_ft) ~= -1 then
			return client.name
		end
	end
	return msg
end


require('lualine').setup({
  options = {
    icons_enabled = true,
    -- theme = 'horizon',
		theme = 'base2tone_evening_dark',
		component_separators = '',
    section_separators = '',
    -- component_separators = { left = '', right = ''},
    -- section_separators = { left = '', right = ''},
    -- disabled_filetypes = {},
    -- always_divide_middle = true,
  },
  sections = {
    -- lualine_a = {'mode'},
		lualine_a = {{ 'mode', fmt = function(str) return str:sub(1,1) end }},
    lualine_b = {'branch', 'diff', 'diagnostics'},
    lualine_c = {
			'filename',
			{
				function()
					return navic.get_location()
				end,
				cond = function()
					return navic.is_available()
				end
			},
		},
    lualine_x = {
			-- 'encoding',
			'fileformat',
			'filetype',
			'filesize',
			{
				whichLsp,
				-- icon = ' ',
				-- color = { fg = '#ffffff', gui = 'bold' },
			}
		},
    -- lualine_y = {'progress'},
		-- see https://vim.fandom.com/wiki/Insert_current_date_or_time for format
		lualine_y = {"os.date('%a %H:%M')"},
    lualine_z = {'location'}
  },
  -- inactive_sections = {
  --   lualine_a = {},
  --   lualine_b = {},
  --   lualine_c = {'filename'},
  --   lualine_x = {'location'},
  --   lualine_y = {},
  --   lualine_z = {}
  -- },
  -- tabline = {},
  -- extensions = {}
})
