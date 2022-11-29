local utils = require('utils')

utils.new_cmd(
	'Screenshot',
	require('modules.silicon'),
	{ range = '%' }
)
