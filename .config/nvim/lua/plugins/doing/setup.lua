vim.keymap.set("n", "<leader>da", '<CMD>lua require("doing").add()<CR>', { desc = "[D]oing: [A]dd" })
vim.keymap.set("n", "<leader>de", '<CMD>lua require("doing").edit()<CR>', { desc = "[D]oing: [E]dit" })
vim.keymap.set("n", "<leader>dd", '<CMD>lua require("doing").done()<CR>', { desc = "[D]oing: Do[n]e" })
vim.keymap.set("n", "<leader>dt", '<CMD>lua require("doing").toggle()<CR>', { desc = "[D]oing: [T]oggle" })

vim.keymap.set(
	"n",
	"<leader>ds",
	function()
		vim.notify(
			require("doing").status(true),
			vim.log.levels.INFO,
			{ title = "Doing:", icon = "", }
		)
	end,
	{ desc = "[D]oing: [S]tatus" }
)

vim.api.nvim_set_hl(0, "WinBar", { link = "TodoBgTODO" })
