return {
  -- lintCommand = 'cargo clean && cargo clippy -q --message-format=short -- -Wclippy::pedantic',
  lintCommand = 'cargo clean && cargo clippy -q --message-format=json -- -Wclippy::pedantic',
  lintIgnoreExitCode = true,
  -- lintStdin = true,
  -- lintFormats = {"%f:%l:%c: %tarning: %m", "%f:%l:%c: %rror: %m"},
}