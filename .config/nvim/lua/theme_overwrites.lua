
-- per colorscheme option
---- base2tone_evening_dark
vim.api.nvim_create_autocmd({"ColorScheme"}, {
  -- pattern = {"base2tone_evening_dark"},
  pattern = {"base2tone_evening_dark"},
  callback = function(ev)
    -- print(string.format('event fired: %s', vim.inspect(ev)))
		vim.api.nvim_exec([[
			hi link RainbowDelimiterRed Macro
			hi link RainbowDelimiterYellow Define
			hi link RainbowDelimiterBlue Tag
			hi link RainbowDelimiterOrange SpellCap
			hi link RainbowDelimiterGreen Question
			hi link RainbowDelimiterViolet String
			hi link RainbowDelimiterCyan Special
		]], true)
  end
})
