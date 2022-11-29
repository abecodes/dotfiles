local utils = require 'utils'

utils.map_key('n', utils.replace_key "<leader>/", "<CMD>Commentary<CR>", {silent = true})
utils.map_key('v', utils.replace_key "<leader>/", ":'<,'> Commentary<CR>", {silent = true})
