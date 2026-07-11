vim.api.nvim_create_autocmd("User", {
	pattern = "TelescopePreviewerLoaded",
	callback = function(args)
		vim.api.nvim_set_option_value("tabstop", 2, { buf = args.buf })
		vim.api.nvim_set_option_value("softtabstop", 2, { buf = args.buf })
		vim.api.nvim_set_option_value("shiftwidth", 2, { buf = args.buf })
	end,
})
