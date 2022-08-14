function update
  brew upgrade
  brew upgrade --cask --greedy
  npm update -g
  go install mvdan.cc/gofumpt@latest
  go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest
  go install github.com/securego/gosec/v2/cmd/gosec@latest
  go install github.com/fdaines/spm-go@latest
  go install github.com/go-critic/go-critic/cmd/gocritic@latest
  go install github.com/praetorian-inc/gokart@latest
  go install github.com/quasilyte/go-consistent@latest
  go install goa.design/model/cmd/mdl@master
  go install github.com/divan/expvarmon@latest
end
