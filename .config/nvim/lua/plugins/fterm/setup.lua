local map = require'utils'.map
local opts = { noremap = true, silent = true }

map('n', '<A-t>', '<CMD>lua require("FTerm").toggle()<CR>', opts)
map('t', '<A-t>', '<C-\\><C-n><CMD>lua require("FTerm").toggle()<CR>', opts)

vim.cmd('command! FTermOpen lua require("FTerm").open()')
vim.cmd('command! FTermClose lua require("FTerm").close()')
vim.cmd('command! FTermToggle lua require("FTerm").toggle()')
vim.cmd('command! FTermExit lua require("FTerm").exit()')

-- run() can take `string` or `table` just like `cmd` config
-- lua require('FTerm').run('man ls') -- with string
-- lua require('FTerm').run({'yarn', 'build'})
-- lua require('FTerm').run({'node', vim.api.nvim_get_current_buf()})

-- Or you can do this
-- vim.cmd('command! ManLs lua require("FTerm").run("man ls")')
-- vim.cmd('command! YarnBuild lua require("FTerm").run({"yarn", "build"})')
