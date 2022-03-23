return {
    name = '+search',
    n = {':Telescope find_files', 'filename'},
    F = {':Telescope live_grep', 'in files in current dir'},
    f = {':Telescope live_grep grep_open_files=true', 'in open file(s)'},
    B = {':Telescope buffers', 'in buffers'},
    b = {':Telescope current_buffer_fuzzy_find', 'in buffer'},
    g = {':Telescope git_files', 'in git files'},
    s = {':Telescope grep_string', 'string in project'},
    q = {':Telescope quickfix', 'in quickfix'},
    t = {':Telescope treesitter', 'in tree'},
    h = {':Telescope help_tags', 'in help tags'}
}
