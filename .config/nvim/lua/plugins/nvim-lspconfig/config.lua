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

-- https://neovim.discourse.group/t/lsp-diagnostics-how-and-where-to-retrieve-severity-level-to-customise-border-color/1679
vim.lsp.util.open_floating_preview = (function(orig)
    return function(contents, syntax, opts)
        local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1
        local diagnostics = vim.diagnostic.get(opts.bufnr or 0, {lnum = lnum})
        local max_severity = vim.diagnostic.severity.HINT
        for _, d in ipairs(diagnostics) do
            -- Equality is "less than" based on how the severities are encoded
            if d.severity < max_severity then
                max_severity = d.severity
            end
        end
        local border_color = ({
            [vim.diagnostic.severity.HINT]  = "DiagnosticHint",
            [vim.diagnostic.severity.INFO]  = "DiagnosticInfo",
            [vim.diagnostic.severity.WARN]  = "DiagnosticWarn",
            [vim.diagnostic.severity.ERROR] = "DiagnosticError",
        })[max_severity]
        opts.border = {
            {"╭", border_color},
            {"─", border_color},
            {"╮", border_color},
            {"│", border_color},
            {"╯", border_color},
            {"─", border_color},
            {"╰", border_color},
            {"│", border_color},
        }
        return orig(contents, syntax, opts)
    end
end)(vim.lsp.util.open_floating_preview)
