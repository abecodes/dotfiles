-- {
--   icons = {
--     expanded = "▾",
--     collapsed = "▸"
--   },
--   mappings = {
--     -- Use a table to apply multiple mappings
--     expand = {"<CR>", "<2-LeftMouse>"},
--     open = "o",
--     remove = "d",
--     edit = "e",
--   },
--   sidebar = {
--     open_on_start = true,
--     elements = {
--       -- You can change the order of elements in the sidebar
--       "scopes",
--       "breakpoints",
--       "stacks",
--       "watches"
--     },
--     width = 40,
--     position = "left" -- Can be "left" or "right"
--   },
--   tray = {
--     open_on_start = true,
--     elements = {
--       "repl"
--     },
--     height = 10,
--     position = "bottom" -- Can be "bottom" or "top"
--   },
--   floating = {
--     max_height = nil, -- These can be integers or a float between 0 and 1.
--     max_width = nil   -- Floats will be treated as percentage of your screen.
--   }
-- }
-- require("dapui").setup {}
local dap, dapui = require("dap"), require("dapui")

dapui.setup()

dap.listeners.before.attach.dapui_config = function()
  dapui.open()
end
dap.listeners.after.attach.dapui_config = function(session, body)
  if (not body or not body.body) then
    return
  end

  if body.body.error then
    print(
      "unable to attach to debug process: ",
      body.body.error.format
    )

    dapui.close()
  end
end
dap.listeners.before.launch.dapui_config = function()
  dapui.open()
end
dap.listeners.after.launch.dapui_config = function(session, body)
  if (not body or not body.body) then
    return
  end

  if body.body.error then
    print(
      "unable to launch debug process: ",
      body.body.error.format
    )

    dapui.close()
  end
end
dap.listeners.before.disconnect.dapui_config = function()
  dapui.close()
end
dap.listeners.before.event_terminated.dapui_config = function()
  dapui.close()
end
dap.listeners.before.event_exited.dapui_config = function()
  dapui.close()
end
