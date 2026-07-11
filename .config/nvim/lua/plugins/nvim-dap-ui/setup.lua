local dap, dapui = require('dap'), require('dapui')

dapui.setup()

-- Open dap-ui panels on launch/attach, close them on terminate/disconnect/exit.
-- The string key ("dapui_config") namespaces the listener so it can be
-- replaced or removed by name without wiping other listeners on the same
-- event.
dap.listeners.before.attach.dapui_config = function() dapui.open() end
dap.listeners.before.launch.dapui_config = function() dapui.open() end
dap.listeners.before.event_terminated.dapui_config = function() dapui.close() end
dap.listeners.before.event_exited.dapui_config = function() dapui.close() end
dap.listeners.before.disconnect.dapui_config = function() dapui.close() end
