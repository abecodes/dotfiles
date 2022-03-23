# env vars
set -x CODIUM '/Applications/VSCodium.app/Contents/Resources/app/bin'
set -x DENO ~/.deno/bin
set -x FLUTTERBIN ~/flutter/bin
set -x FZF_DEFAULT_COMMAND fd --type file --hidden --no-ignore
set -x GOPATH ~/go
set -x GOBIN $GOPATH/bin
set -x NVM_DIR $HOME/.nvm
set -x QMK_ARM '/usr/local/opt/arm-gcc-bin@8/bin'
set -x QMK_AVR '/usr/local/opt/avr-gcc@8/bin'
set -x RUSTUP_DIR $HOME/.cargo/bin
set -x VSCODE '/Applications/Visual Studio Code.app/Contents/Resources/app/bin'

# set --universal nvm_default_version v12

# Path
set PATH $PATH $GOBIN $NVM_DIR $RUSTUP_DIR $FLUTTERBIN $VSCODE $QMK_ARM $QMK_AVR $CODIUM
