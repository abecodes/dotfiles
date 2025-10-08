local custom_attach = require('lsp.utils.attach')

return {
    on_attach = function(client, bufnr)
			-- disable formatting, handled with prettierd via efm ls
			client.server_capabilities.document_formatting = false
			custom_attach(client, bufnr)
		end,
    cmd = {'vscode-html-language-server', '--stdio'},
    filetypes = {'html'},
    init_options = {
        configurationSection = {'html', 'css', 'javascript'},
        embeddedLanguages = {css = true, javascript = true}
    },
		root_markers = {vim.fn.getcwd()},
    settings = {}
}
