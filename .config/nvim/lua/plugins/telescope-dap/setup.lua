local map = require'utils'.map

map('n', '<leader>dcc',
    '<cmd>lua require"telescope".extensions.dap.commands{}<CR>')
map('n', '<leader>dco',
    '<cmd>lua require"telescope".extensions.dap.configurations{}<CR>')
map('n', '<leader>dlb',
    '<cmd>lua require"telescope".extensions.dap.list_breakpoints{}<CR>')
map('n', '<leader>dv',
    '<cmd>lua require"telescope".extensions.dap.variables{}<CR>')
map('n', '<leader>df', '<cmd>lua require"telescope".extensions.dap.frames{}<CR>')
