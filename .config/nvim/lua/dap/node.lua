local dap = require('dap')

dap.adapters.node2 = {
    type = 'executable',
    command = 'node',
    args = {
        os.getenv('HOME') .. '/_REPOS/vscode-node-debug2/out/src/nodeDebug.js'
    }
}
dap.configurations.javascript = {
    {
        type = 'node2',
        name = 'Debug Node',
        request = 'launch',
        program = '${workspaceFolder}/${file}',
        cwd = vim.fn.getcwd(),
        sourceMaps = true,
        protocol = 'inspector',
        console = 'integratedTerminal'
    }
}
