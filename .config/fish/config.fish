# env vars
# CODIUM '/Applications/VSCodium.app/Contents/Resources/app/bin'
# DENO ~/.deno/bin
# FLUTTERBIN ~/flutter/bin
# QMK_ARM '/usr/local/opt/arm-gcc-bin@8/bin'
# QMK_AVR '/usr/local/opt/avr-gcc@8/bin'
# RUSTUP_DIR $HOME/.cargo/bin

# set --universal nvm_default_version v12

set -x FZF_DEFAULT_COMMAND fd --type file --hidden --no-ignore
set -x GOPATH ~/go
set -x GOBIN $GOPATH/bin

# Path
fish_add_path $GOBIN
fish_add_path '/Applications/Visual Studio Code.app/Contents/Resources/app/bin'
