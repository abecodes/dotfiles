# env vars
set -x FLUTTERBIN ~/flutter/bin
set -x GOPATH ~/go
set -x GOBIN $GOPATH/bin

# Path
set PATH $PATH ~/.deno/bin $GOBIN $FLUTTERBIN

# Spacefish Sort Order
set SPACEFISH_PROMPT_ORDER dir host git package node docker golang pyenv kubecontext exec_time line_sep time user battery jobs exit_code char

# Spacefish Prompt options
set SPACEFISH_CHAR_SYMBOL 🙈🙉🙊🦄
set SPACEFISH_TIME_SHOW true
set SPACEFISH_JULIA_SHOW false
set SPACEFISH_RUBY_SHOW false
set SPACEFISH_HASKELL_SHOW false
set SPACEFISH_AWS_SHOW false
set SPACEFISH_VENV_SHOW false
set SPACEFISH_CONDA_SHOW false
set SPACEFISH_ELIXIR_SHOW false
set SPACEFISH_PHP_SHOW false
set SPACEFISH_RUST_SHOW false
set SPACEFISH_DOTNET_SHOW false
set SPACEFISH_KUBECONTEXT_SHOW false
set SPACEFISH_TIME_PREFIX ""
