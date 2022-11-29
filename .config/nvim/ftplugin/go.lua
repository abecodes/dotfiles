local utils = require('utils')

utils.new_buf_cmd('Golint', require('modules.go.lint'), {})
utils.new_buf_cmd('Goformat', require('modules.go.breakLines'), {})
