local opts = {
    highlight_hovered_item = true,
    show_guides = true,
    auto_preview = true,
    position = 'right',
    show_numbers = false,
    show_relative_numbers = false,
    show_symbol_details = true,
    border = {
		{"╭", "DiagnosticHint"},
		{"─", "DiagnosticHint"},
		{"╮", "DiagnosticHint"},
		{"│", "DiagnosticHint"},
		{"╯", "DiagnosticHint"},
		{"─", "DiagnosticHint"},
		{"╰", "DiagnosticHint"},
		{"│", "DiagnosticHint"},
	},
    keymaps = {
        close = "<Esc>",
        goto_location = "<Cr>",
        focus_location = "o",
        hover_symbol = "<C-space>",
        rename_symbol = "r",
        code_actions = "a"
    },
    lsp_blacklist = {}
}

require("symbols-outline").setup(opts)
