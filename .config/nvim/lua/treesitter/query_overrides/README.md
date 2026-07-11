# Query overrides

Hand-patched `.scm` files here win over the upstream-fetched queries in
`stdpath('data')/treesitter/queries/<lang>/`.

Layout: `<lang>/<name>.scm` — e.g. `go/highlights.scm`, `python/injections.scm`.

Standard query names nvim core recognizes: `highlights`, `injections`,
`locals`, `folds`, `indents`.

Use sparingly — every override here is a divergence from upstream that you
own forever. Prefer opening a PR against
`https://github.com/neovim-treesitter/nvim-treesitter-queries-<lang>` first.
