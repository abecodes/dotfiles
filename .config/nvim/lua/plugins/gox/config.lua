require('gox').setup({
	revive = {
		enabled = false,
		config = '$HOME/revive.toml'
	},
	gosec = {
		enabled = false,
	},
	gocritic = {
		enabled = false,
	},
	golangci = {
		enabled = true,
		cool = 1234,
		config = "$HOME/.golangci.yaml"
	}
})
