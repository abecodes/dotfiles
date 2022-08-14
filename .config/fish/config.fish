# env vars
# CODIUM '/Applications/VSCodium.app/Contents/Resources/app/bin'
# DENO ~/.deno/bin
# FLUTTERBIN ~/flutter/bin
# QMK_ARM '/usr/local/opt/arm-gcc-bin@8/bin'
# QMK_AVR '/usr/local/opt/avr-gcc@8/bin'
# RUSTUP_DIR $HOME/.cargo/bin

set -x FZF_DEFAULT_COMMAND fd --hidden --no-ignore --follow
set -x FZF_CTRL_T_COMMAND $FZF_DEFAULT_COMMAND --type file . '$dir'
set -x FZF_CTRL_T_OPTS "--preview 'bat --style numbers --color always {}'"
set -x FZF_ALT_C_COMMAND $FZF_DEFAULT_COMMAND --type directory
set -x FZF_ALT_C_OPTS "--preview='exa --icons -T {}'"
set -x GOPATH ~/go
set -x GOBIN $GOPATH/bin

# Path
fish_add_path $GOBIN
