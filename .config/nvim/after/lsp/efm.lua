local prettier = require 'lsp.formatters.prettier'
local eslint = require 'lsp.linters.eslint'

local languages = {
    typescript = {prettier, eslint},
    javascript = {prettier, eslint},
    typescriptreact = {prettier, eslint},
    javascriptreact = {prettier, eslint},
    vue = {prettier, eslint},
    yaml = {prettier},
    json = {prettier},
    html = {prettier},
    scss = {prettier},
    css = {prettier},
    markdown = {prettier}
}


return {
		-- prettierd and eslint_d are socket-based singleton daemons:
		--   * prettierd binds ~/.prettierd, eslint_d binds ~/.eslint_d
		--   * any `start` call connects to the existing socket if one is
		--     already held — a second daemon can never be spawned
		--   * efm-langserver invokes the CLI on demand and piggy-backs on
		--     the same socket
		-- So for ALL buffers and even ALL concurrently running Nvim
		-- instances, exactly one daemon per user is guaranteed by the socket
		-- lock itself. That means we do NOT need an explicit `start` call
		-- here — the first format request via efm brings the daemon up
		-- automatically. We only wire a cleanup hook so the daemon stops
		-- when the editor exits.
		-- Caveat: with multiple Nvim instances open, the first one to quit
		-- stops the daemon; the others will silently re-spawn it on the next
		-- format request. Acceptable.
		on_init = function()
			local autocmd = require('utils.autocmd')
			local grp = autocmd.new_augroup('LspEfmCleanup')
			autocmd.new_autocmd('VimLeavePre', grp, {
				callback = function()
					-- Fire-and-forget: vim.fn.system blocks :qa while each
					-- daemon exits (serially). detach=true lets them outlive
					-- nvim without keeping the event loop alive.
					vim.system({ 'prettierd', 'stop' }, { detach = true })
					vim.system({ 'eslint_d',  'stop' }, { detach = true })
				end,
			})
		end,
    -- on_exit was previously a `vim.schedule_wrap(function() ... end)` that
    -- was never invoked — it returned the wrapped callback instead of calling
    -- it, so the stop/cleanup inside never ran. Removed: VimLeavePre above
    -- handles shutdown and the augroup is auto-cleared when Nvim exits.
    cmd = {'efm-langserver', '-loglevel', '2', '-logfile', '/tmp/efm.log'},
    init_options = {documentFormatting = true},
    filetypes = vim.tbl_keys(languages),
		root_markers = {
			'package.json',
			'.git'
		},
    settings = {
        rootMarkers = { 'package.json', '.git' },
        lintDebounce = 100,
        languages = languages
    }
}
