function update
  brew upgrade
  brew upgrade --cask --greedy
  npm i -g eslint_d @fsouza/prettierd vscode-langservers-extracted typescript typescript-language-server https://github.com/jez/bars.git
  npm update -g
  go install mvdan.cc/gofumpt@latest
  go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest
  go install github.com/fdaines/spm-go@latest
  go install github.com/praetorian-inc/gokart@latest
  go install github.com/quasilyte/go-consistent@latest
  go install goa.design/model/cmd/mdl@master
  go install github.com/divan/expvarmon@latest
  go install github.com/segmentio/golines@latest
  go install github.com/onsi/ginkgo/v2/ginkgo@latest
  go install github.com/daixiang0/gci@latest
  go install go.uber.org/nilaway/cmd/nilaway@latest
end
