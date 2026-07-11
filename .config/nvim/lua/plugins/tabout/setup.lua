require('tabout').setup {
    backwards_enabled = true,
    pairs = {
        { open = "'", close = "'" },
        { open = '"', close = '"' },
        { open = '`', close = '`' },
        { open = '(', close = ')' },
        { open = '[', close = ']' },
        { open = '{', close = '}' },
        { open = '<', close = '>' },
    },
}
-- Keymaps live in plugins/tabout/keys.lua — the pack loader auto-registers
-- them after this setup runs (utils.keys.register with silent default).
