-- nvim-dap signs (override after loading `dap`):
--   DapBreakpoint         — breakpoint           (default 'B')
--   DapBreakpointRejected — rejected by adapter  (default 'R')
--   DapLogPoint           — log point            (default 'L')
--   DapStopped            — current stop marker  (default '→')
--
-- Launch-config variable substitution (nvim-dap does the substitution before
-- handing the request to the adapter):
--   ${file}                   Active filename (abs path)
--   ${fileBasename}           Basename of active file
--   ${fileBasenameNoExtension}
--   ${fileDirname}            Absolute dir of active file  ← most useful for Go
--   ${fileExtname}
--   ${relativeFile}           File relative to getcwd()
--   ${relativeFileDirname}
--   ${workspaceFolder}        Neovim cwd
--   ${workspaceFolderBasename}
local dap = require('dap')

-- ============================================================
-- Delve adapter
-- ============================================================
-- nvim-dap calls this function to produce the adapter descriptor for each
-- "delve"-typed configuration. Two branches:
--
--   mode == "remote" + request == "attach":
--     Do NOT spawn anything locally — just tell nvim-dap to open a TCP
--     connection to the already-running remote `dlv` (which was started
--     elsewhere with e.g. `dlv debug --headless --listen=:38697 --api-version=2`).
--
--   everything else (launch OR local attach):
--     Spawn `dlv dap -l 127.0.0.1:<port>` as a child process. nvim-dap picks a
--     free <port>, waits for dlv to listen, then sends the DAP launch/attach
--     request over that socket. `--log --log-output=dap` surfaces DAP protocol
--     traffic in `:DapShowLog` — keep it; it's invaluable when configs
--     misbehave.
--
-- `detached = true` on non-Windows is required so SIGINT to nvim doesn't
-- forward to the dlv child (which would kill the debug session prematurely).
dap.adapters.delve = function(callback, config)
  if config.mode == 'remote' and config.request == 'attach' then
    callback({
      type = 'server',
      host = config.host or '127.0.0.1',
      port = config.port or '38697',
    })
    return
  end

  callback({
    type = 'server',
    port = '${port}',
    executable = {
      command = 'dlv',
      args = { 'dap', '-l', '127.0.0.1:${port}', '--log', '--log-output=dap' },
      detached = vim.fn.has('win32') == 0,
    },
  })
end

-- ============================================================
-- Go / delve debug configurations
-- ============================================================
-- How a configuration reaches delve:
--   `dap.continue()` serialises the chosen configuration table to a DAP
--   "launch" or "attach" request (JSON). The adapter function above spawns
--   `dlv dap -l 127.0.0.1:<port>` and pipes the DAP request into it. Delve
--   reads `mode`, `program`, `args`, `cwd`, `processId`, `host`, `port`,
--   `buildFlags`, `env`, `stopOnEntry` etc. from the launch/attach arguments
--   — see https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_dap.md
--
--   Key fields:
--     mode     : "debug" | "test" | "exec" | "local" | "remote"
--     program  : path to a .go file OR a package directory
--                - mode="debug": must resolve to `package main`
--                - mode="test" : any Go package (incl. libraries)
--                - mode="exec" : pre-built binary path (unused here)
--     args     : string[] passed after `--` to the debuggee
--                (for test mode: `-test.run`, `-test.v`, etc.)
--     cwd      : working dir of the debuggee (default: nvim cwd)
--     processId: pid to attach to (mode="local", request="attach")
--     host/port: remote dlv to attach to (mode="remote")
-- ============================================================
dap.configurations.go = {
  -- ----------------------------------------------------------
  -- Debug package
  -- ----------------------------------------------------------
  -- Covers: running the *package* the current file lives in.
  -- Requires: that package to be `package main` (has a `main()`).
  -- Why `${fileDirname}` and not `${file}`: delve's `mode=debug` expects
  -- either a main-package directory or a single-file main program.
  -- `${fileDirname}` is the package dir — delve compiles every .go file in
  -- it (respecting build tags) into one binary, which matches `go run .`
  -- semantics.
  -- Wire: { mode:"debug", program:"/abs/path/to/pkg" } → delve runs
  -- `go build -o <tmp> ./pkg`, then launches <tmp> under the debugger.
  {
    type    = 'delve',
    name    = 'Debug package',
    request = 'launch',
    mode    = 'debug',
    program = '${fileDirname}',
  },

  -- ----------------------------------------------------------
  -- Debug file
  -- ----------------------------------------------------------
  -- Covers: running a *single* .go file as a standalone main.
  -- Use when: you have a one-off throwaway like a scratch `cmd_foo.go` that
  -- doesn't belong to a package with siblings.
  -- Note: will fail if the file references other files in the same dir —
  -- pick "Debug package" in that case.
  -- Wire: { mode:"debug", program:"/abs/path/to/file.go" } → delve runs
  -- `go build -o <tmp> /abs/path/to/file.go`.
  {
    type    = 'delve',
    name    = 'Debug file',
    request = 'launch',
    mode    = 'debug',
    program = '${file}',
  },

  -- ----------------------------------------------------------
  -- Debug tests (package)
  -- ----------------------------------------------------------
  -- Covers: ALL tests in the current package. This is the ONLY way to
  -- "debug" a library (no `main`), so this entry is load-bearing.
  -- Why `mode="test"`: delve compiles the package as a test binary
  -- (`go test -c`), preserving access to `internal/` helpers and test-only
  -- files. `mode="debug"` on a library fails — no `main()`.
  -- Why `${fileDirname}`: test binaries are produced per-package; the
  -- program arg must point at the package dir.
  -- Wire: { mode:"test", program:"/abs/path/to/pkg" } → delve runs
  -- `go test -c -o <tmp> ./pkg`, launches <tmp> with the standard `testing`
  -- flags available (unchanged → runs everything).
  {
    type    = 'delve',
    name    = 'Debug tests (package)',
    request = 'launch',
    mode    = 'test',
    program = '${fileDirname}',
  },

  -- ----------------------------------------------------------
  -- Debug test (nearest)
  -- ----------------------------------------------------------
  -- Covers: debugging the single `TestFoo` / `(*T).TestFoo` under the
  -- cursor. Same compile path as "Debug tests (package)", but feeds
  -- `-test.run=^TestFoo$` to the test binary so only that one test runs.
  -- How we find the name: reuses `pde.lang.go._ts_nodes.nodes_at_cursor`
  -- (the same treesitter helper `pde/lang/go/tests.lua` uses for
  -- `:Gotestadd`). The deepest enclosing `function_declaration` or
  -- `method_declaration` wins.
  -- Wire: { mode:"test", program:"<pkg>", args:["-test.run","^Name$"] }
  -- → delve appends `args` after `--` when launching the test binary, so
  -- the Go `testing` framework filters to that test.
  {
    type    = 'delve',
    name    = 'Debug test (nearest)',
    request = 'launch',
    mode    = 'test',
    program = '${fileDirname}',
    args    = function()
      local ok, ts = pcall(require, 'pde.lang.go._ts_nodes')
      if not ok then return {} end
      local row, col = unpack(vim.api.nvim_win_get_cursor(0))
      local q = [[
        ((method_declaration name: (field_identifier)@method.name)@method.declaration)
        ((function_declaration name: (identifier)@function.name)@function.declaration)
      ]]
      local nodes = ts.nodes_at_cursor(q, 0, row, col)
      if not nodes or #nodes == 0 then
        vim.notify('[dap] place cursor on a test function', vim.log.levels.WARN)
        return {}
      end
      -- deepest enclosing func/method wins
      return { '-test.run', '^' .. nodes[#nodes].name .. '$' }
    end,
  },

  -- ----------------------------------------------------------
  -- Attach (local pid)
  -- ----------------------------------------------------------
  -- Covers: attaching to an already-running local Go process (e.g. a
  -- long-lived server you started outside nvim).
  -- Requires: the target binary was built with debug info — i.e. NOT with
  -- `-ldflags="-s -w"`. Plain `go build` is fine.
  -- Permissions: on macOS you may need to codesign dlv for task_for_pid; on
  -- Linux, `kernel.yama.ptrace_scope` may need to be 0.
  -- `dap.utils.pick_process` shows a vim.ui.select picker of PIDs (this
  -- repo's custom select in `lua/ui/select.lua` handles the UI).
  -- Wire: { mode:"local", request:"attach", processId:<pid> } → delve runs
  -- `dlv attach <pid>` via ptrace/task_for_pid.
  {
    type      = 'delve',
    name      = 'Attach (local pid)',
    mode      = 'local',
    request   = 'attach',
    processId = require('dap.utils').pick_process,
  },

  -- ----------------------------------------------------------
  -- Attach (remote)
  -- ----------------------------------------------------------
  -- Covers: attaching to a `dlv` instance already listening as a DAP
  -- server, e.g. started with
  --   dlv debug --headless --listen=:38697 --api-version=2 ./...
  -- or the server side of a port-forward into a container.
  -- Host/port are prompted per invocation — tweak the defaults inline if
  -- you always hit the same target.
  -- Wire: our `dap.adapters.delve` function (above) detects
  -- `mode=="remote"` + `request=="attach"` and returns
  -- `{ type:"server", host, port }` WITHOUT spawning a local `dlv` —
  -- nvim-dap opens a plain TCP connection to the remote.
  {
    type    = 'delve',
    name    = 'Attach (remote)',
    mode    = 'remote',
    request = 'attach',
    host    = function() return vim.fn.input('Host [127.0.0.1]: ', '127.0.0.1') end,
    port    = function() return tonumber(vim.fn.input('Port [38697]: ', '38697')) end,
  },
}

vim.fn.sign_define('DapBreakpoint', { text = '🟥', texthl = '', linehl = '', numhl = '' })
vim.fn.sign_define('DapStopped', { text = '▶️', texthl = '', linehl = '', numhl = '' })
