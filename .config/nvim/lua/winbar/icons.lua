-- Nerd-font icons for the winbar + statusbar.
--
-- Built from codepoints so the source stays legible regardless of terminal
-- font rendering and survives any text-processing tool (Write, paste, email,
-- etc.) that might mangle multi-byte glyphs.
-- Look up codepoints at https://www.nerdfonts.com/cheat-sheet.

return {
	branch     = vim.fn.nr2char(0xE725),   -- U+E725  pl-branch
	clock      = vim.fn.nr2char(0xF017),   -- U+F017  fa-clock_o
	diag_error = vim.fn.nr2char(0xF015A),  -- U+F015A md-close_box_outline
	diag_warn  = vim.fn.nr2char(0xF002A),  -- U+F002A md-alert
	diag_info  = vim.fn.nr2char(0xF02FD),  -- U+F02FD md-information
	diag_hint  = vim.fn.nr2char(0xF0336),  -- U+F0336 md-lightbulb_on_outline
	fmt_unix   = vim.fn.nr2char(0xF17C),   -- U+F17C  fa-linux
	fmt_dos    = vim.fn.nr2char(0xE70F),   -- U+E70F  dev-windows
	fmt_mac    = vim.fn.nr2char(0xE711),   -- U+E711  dev-apple

	-- Breadcrumb kind icons (used by winbar/breadcrumb.lua).
	-- Match nvim-navic defaults so the visual is unchanged from the
	-- plugin being replaced.
	crumb_function  = vim.fn.nr2char(0xF0295),  -- U+F0295 md-function
	crumb_method    = vim.fn.nr2char(0xF01A7),  -- U+F01A7 md-cube
	crumb_class     = vim.fn.nr2char(0xF0317),  -- U+F0317 md-shape (also struct)
	crumb_interface = vim.fn.nr2char(0xF0558),  -- U+F0558 md-shape_outline
	crumb_enum      = vim.fn.nr2char(0xF0557),  -- U+F0557 md-format_list_bulleted_type
	crumb_module    = vim.fn.nr2char(0xF03D6),  -- U+F03D6 md-package
	crumb_heading   = vim.fn.nr2char(0xF026B),  -- U+F026B md-format_header_pound
}
