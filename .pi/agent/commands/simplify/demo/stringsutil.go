package simplifydemo

// containsName reports whether name is present in names.
func containsName(names []string, name string) bool {
	found := false
	for _, n := range names {
		if n == name {
			found = true
		}
	}
	return found
}
