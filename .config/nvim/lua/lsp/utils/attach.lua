local methods = require('vim.lsp.protocol').Methods
local autocmd = require('utils.autocmd')
local completion = require('completion')

-- Severity-coloured floating-window border for hover / signature help /
-- diagnostic floats. Reads the current window cursor and the diagnostics
-- on that line, picks the DiagnosticHint/Info/Warn/Error highlight group
-- for the worst severity, and returns the 8-tuple border table
-- nvim_open_win accepts. Computed at call time so `<Cmd>LspDiagNext<CR>`
-- can recompute after the jump.
local BORDER_CHARS = { '╭', '─', '╮', '│', '╯', '─', '╰', '│' }

local function severity_border(bufnr, lnum)
    bufnr = bufnr or vim.api.nvim_get_current_buf()
    lnum  = lnum  or (vim.api.nvim_win_get_cursor(0)[1] - 1)
    local max_severity = vim.diagnostic.severity.HINT
    for _, d in ipairs(vim.diagnostic.get(bufnr, { lnum = lnum })) do
        if d.severity < max_severity then max_severity = d.severity end
    end
    local hl = ({
        [vim.diagnostic.severity.HINT]  = 'DiagnosticHint',
        [vim.diagnostic.severity.INFO]  = 'DiagnosticInfo',
        [vim.diagnostic.severity.WARN]  = 'DiagnosticWarn',
        [vim.diagnostic.severity.ERROR] = 'DiagnosticError',
    })[max_severity]
    local out = {}
    for i, c in ipairs(BORDER_CHARS) do out[i] = { c, hl } end
    return out
end

local custom_attach = function(client, bufnr)
    completion.attach(client, bufnr)

    -- Disabled: most LSPs advertise textDocument/semanticTokens (gopls,
    -- rust-analyzer, tsserver, clangd, lua_ls, ruff/pyright), so this
    -- unconditionally disables treesitter highlighting nearly everywhere
    -- an LSP attaches — and LSP semantic tokens are coarser than TS for
    -- punctuation / operators / string escapes / etc. If a specific
    -- language's LSP genuinely produces richer tokens than TS, gate by
    -- filetype in an allowlist:
    --   local TS_OFF_FT = { rust = true }
    --   if TS_OFF_FT[vim.bo[bufnr].filetype] and
    --        client:supports_method(methods.textDocument_semanticTokens_full) then
    --     vim.treesitter.stop(bufnr)
    --   end
    -- if client:supports_method(methods.textDocument_semanticTokens_full) then
    --     vim.treesitter.stop(bufnr)
    -- end

    if client:supports_method(methods.textDocument_inlayHint) then
        vim.lsp.inlay_hint.enable(true, { bufnr = bufnr })
    end

    local kopts = { buffer = bufnr, silent = true }

    -- Buffer-local user commands: the keymaps dispatch through these
    -- (`<Cmd>Lsp…<CR>`), and the commands stay discoverable via `:Lsp<Tab>`
    -- in buffers that actually have an LSP attached.
    local function bcmd(name, fn)
        vim.api.nvim_buf_create_user_command(bufnr, name, fn, {})
    end

    bcmd('LspDef',            function() vim.lsp.buf.definition() end)
    bcmd('LspFormatting',     function() vim.lsp.buf.format({ timeout_ms = 3000 }) end)
    bcmd('LspCodeAction',     function() vim.lsp.buf.code_action() end)
    bcmd('LspHover',          function() vim.lsp.buf.hover({ border = severity_border() }) end)
    bcmd('LspRename',         function() vim.lsp.buf.rename() end)
    bcmd('LspRefs',           function() vim.lsp.buf.references() end)
    bcmd('LspTypeDef',        function() vim.lsp.buf.type_definition() end)
    bcmd('LspImplementation', function() vim.lsp.buf.implementation() end)
    -- Peek the destination with get_prev/get_next, compute the severity
    -- border for that line up-front, then hand it to jump's built-in
    -- `float = {opts}`. Letting jump own the open_float call avoids a race
    -- where the previous float's CursorMoved close-handler and a manually
    -- scheduled open_float land in the same deferred batch — the symptom
    -- is the second invocation jumping but not showing a float.
    bcmd('LspDiagPrev', function()
        local d = vim.diagnostic.get_prev()
        if not d then return end
        vim.diagnostic.jump({
            count = -1,
            float = { border = severity_border(d.bufnr, d.lnum) },
        })
    end)
    bcmd('LspDiagNext', function()
        local d = vim.diagnostic.get_next()
        if not d then return end
        vim.diagnostic.jump({
            count = 1,
            float = { border = severity_border(d.bufnr, d.lnum) },
        })
    end)
    bcmd('LspDiagLine',       function() vim.diagnostic.open_float({ border = severity_border() }) end)
    bcmd('LspSignatureHelp',  function() vim.lsp.buf.signature_help({ border = severity_border() }) end)

    vim.keymap.set('n', 'gd',        '<Cmd>LspDef<CR>',            kopts)
    vim.keymap.set('n', 'gr',        '<Cmd>LspRename<CR>',         kopts)
    vim.keymap.set('n', 'gR',        '<Cmd>LspRefs<CR>',           kopts)
    vim.keymap.set('n', 'gI',        '<Cmd>LspImplementation<CR>', kopts)
    vim.keymap.set('n', 'gy',        '<Cmd>LspTypeDef<CR>',        kopts)
    vim.keymap.set('n', 'K',         '<Cmd>LspHover<CR>',          kopts)
    vim.keymap.set('n', '[a',        '<Cmd>LspDiagPrev<CR>',       kopts)
    vim.keymap.set('n', ']a',        '<Cmd>LspDiagNext<CR>',       kopts)
    vim.keymap.set('n', 'ga',        '<Cmd>LspCodeAction<CR>',     kopts)
    vim.keymap.set('n', '<Leader>a', '<Cmd>LspDiagLine<CR>',       kopts)
    vim.keymap.set('i', '<C-x><C-x>','<Cmd>LspSignatureHelp<CR>',  kopts)

    if client:supports_method(methods.textDocument_formatting) then
        -- Only install the LSP-format `ff` mapping when nothing else already
        -- claimed it (e.g. Go's ftplugin installs a golines|gci pipeline that
        -- must win over vim.lsp.buf.format — losing golines means losing
        -- width control, see pde/lang/go/format.lua header).
        local shouldMap = true
        for _, e in ipairs(vim.api.nvim_buf_get_keymap(bufnr, 'n')) do
            if e.lhs == 'ff' then
                shouldMap = false
                break
            end
        end

        if shouldMap then
            vim.keymap.set('n', 'ff', function() vim.lsp.buf.format({ timeout_ms = 3000 }) end, { buffer = bufnr })
        end
    end

    if client:supports_method(methods.textDocument_documentHighlight) then
        -- `default = true` mirrors the old `hi def link` semantic so a theme
        -- or user override of these groups wins over our fallback.
        vim.api.nvim_set_hl(0, 'LspReferenceText',  { link = 'CursorLine', default = true })
        vim.api.nvim_set_hl(0, 'LspReferenceRead',  { link = 'CursorLine', default = true })
        vim.api.nvim_set_hl(0, 'LspReferenceWrite', { link = 'CursorLine', default = true })

        -- Shared augroup (not per-buffer) so empty groups don't accumulate as
        -- buffers are wiped. Buffer-local autocmds inside it are GC'd by Neovim
        -- with the buffer. Re-attach clears this buffer's prior autocmds first.
        local grp = autocmd.new_augroup('lsp_document_highlight', false)
        vim.api.nvim_clear_autocmds({ group = grp, buffer = bufnr })
        autocmd.new_autocmd('CursorHold', grp, {
            buffer = bufnr,
            callback = function() vim.lsp.buf.document_highlight() end,
        })
        autocmd.new_autocmd('CursorMoved', grp, {
            buffer = bufnr,
            callback = function() vim.lsp.buf.clear_references() end,
        })
    end

end

return custom_attach
