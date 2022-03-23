local custom_attach = function(client, bufnr)
    -- local buf_map = vim.api.nvim_buf_set_keymap
    -- local buf_set_option = vim.api.nvim_buf_set_option
    local function buf_set_keymap(...) vim.api.nvim_buf_set_keymap(bufnr, ...) end
    local function buf_set_option(...) vim.api.nvim_buf_set_option(bufnr, ...) end

    local opts = { noremap=true, silent=true }

    buf_set_option('omnifunc', 'v:lua.vim.lsp.omnifunc')

    vim.cmd("command! LspDef lua vim.lsp.buf.definition()")
    -- vim.cmd("command! LspFormatting lua vim.lsp.buf.formatting()")
    vim.cmd("command! LspFormatting lua vim.lsp.buf.formatting_sync(nil, 1000)")
    vim.cmd("command! LspRangeFormatting lua vim.lsp.buf.range_formatting()")
    vim.cmd("command! LspCodeAction lua vim.lsp.buf.code_action()")
    vim.cmd("command! LspHover lua vim.lsp.buf.hover()")
    vim.cmd("command! LspRename lua vim.lsp.buf.rename()")
    vim.cmd("command! LspRefs lua vim.lsp.buf.references()")
    vim.cmd("command! LspTypeDef lua vim.lsp.buf.type_definition()")
    vim.cmd("command! LspImplementation lua vim.lsp.buf.implementation()")
    vim.cmd("command! LspDiagPrev lua vim.diagnostic.goto_prev()")
    vim.cmd("command! LspDiagNext lua vim.diagnostic.goto_next()")
    vim.cmd(
        "command! LspDiagLine lua vim.diagnostic.open_float()")
    vim.cmd("command! LspSignatureHelp lua vim.lsp.buf.signature_help()")
    buf_set_keymap("n", "gd", ":LspDef<CR>", opts)
    buf_set_keymap("n", "gr", ":LspRename<CR>", opts)
    buf_set_keymap("n", "gR", ":LspRefs<CR>", opts)
    buf_set_keymap("n", "gy", ":LspTypeDef<CR>", opts)
    buf_set_keymap("n", "K", ":LspHover<CR>", opts)
    buf_set_keymap("n", "[a", ":LspDiagPrev<CR>", opts)
    buf_set_keymap("n", "]a", ":LspDiagNext<CR>", opts)
    buf_set_keymap("n", "ga", ":LspCodeAction<CR>", opts)
    buf_set_keymap("n", "<Leader>a", ":LspDiagLine<CR>", opts)
    buf_set_keymap("i", "<C-x><C-x>", "<Cmd>LspSignatureHelp<CR>",
            opts)

    -- if client.resolved_capabilities.document_formatting then
    --     vim.api.nvim_exec([[
	-- 		 augroup LspAutocommands
	-- 			autocmd! * <buffer>
	-- 			autocmd BufWritePost <buffer> LspFormatting
	-- 		 augroup END
	-- 		 ]], true)
    -- end

    -- Set some keybinds conditional on server capabilities
    if client.resolved_capabilities.document_formatting then
        buf_set_keymap("n", "ff", ":LspFormatting<CR>", opts)
        vim.api.nvim_exec([[
			 augroup LspAutocommands
				autocmd! * <buffer>
				autocmd BufWritePost <buffer> LspFormatting
			 augroup END
			 ]], true)
    elseif client.resolved_capabilities.document_range_formatting then
        buf_set_keymap("n", "ff", ":LspRangeFormatting<CR>", opts)
        vim.api.nvim_exec([[
			 augroup LspAutocommands
				autocmd! * <buffer>
				autocmd BufWritePost <buffer> LspRangeFormatting
			 augroup END
			 ]], true)
    end

    -- Set autocommands conditional on server_capabilities
    -- hi LspReferenceRead cterm=bold ctermbg=DarkMagenta guibg=LightYellow
    -- hi LspReferenceText cterm=bold ctermbg=DarkMagenta guibg=LightYellow
    -- hi LspReferenceWrite cterm=bold ctermbg=DarkMagenta guibg=LightYellow
    if client.resolved_capabilities.document_highlight then
        vim.api.nvim_exec([[
        hi def link LspReferenceText CursorLine
        hi def link LspReferenceWrite CursorLine
        hi def link LspReferenceRead CursorLine
        augroup lsp_document_highlight
            autocmd! * <buffer>
            autocmd CursorHold <buffer> lua vim.lsp.buf.document_highlight()
            autocmd CursorMoved <buffer> lua vim.lsp.buf.clear_references()
        augroup END
        ]], false)
    end

end

return custom_attach
