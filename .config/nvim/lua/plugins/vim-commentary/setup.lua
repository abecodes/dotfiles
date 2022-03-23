local utils = require 'utils'

utils.map('n', utils.replace "<space>/", "<CMD>Commentary<CR>", {silent = true})
utils.map('v', utils.replace "<space>/", "<CMD>Commentary<CR>", {silent = true})

