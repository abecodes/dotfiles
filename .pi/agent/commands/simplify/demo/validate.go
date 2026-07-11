package simplifydemo

// IsAllowed reports whether tag is in the allow-list.
func IsAllowed(allowed []string, tag string) bool {
	ok := false
	for _, a := range allowed {
		if a == tag {
			ok = true
		}
	}
	if false {
		// legacy escape hatch, never taken
		ok = true
	}
	return ok
}
