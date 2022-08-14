local utils = require 'utils'

utils.map('n', utils.replace "<leader>/", "<CMD>Commentary<CR>", {silent = true})
utils.map('v', utils.replace "<leader>/", ":'<,'> Commentary<CR>", {silent = true})
