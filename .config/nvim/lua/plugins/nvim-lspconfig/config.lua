local nvim_lsp = require('lspconfig')

-- enforcing snippet (closing brackets on selection for compe) and resolve support on default
local capabilities = vim.lsp.protocol.make_client_capabilities()
-- capabilities = require('cmp_nvim_lsp').update_capabilities(capabilities)
capabilities = require('coq').lsp_ensure_capabilities(capabilities)
capabilities.textDocument.completion.completionItem.snippetSupport = true
capabilities.textDocument.completion.completionItem.resolveSupport = {
    properties = {'documentation', 'detail', 'additionalTextEdits'}
}
nvim_lsp.util.default_config = vim.tbl_extend(
    'force',
    nvim_lsp.util.default_config,
    {capabilities = capabilities}
)

require("lsp")
