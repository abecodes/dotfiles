package simplifydemo

// CanAccess reports whether a user with the given role may access a resource.
// banned always wins; admins may access anything; otherwise only the owner may.
func CanAccess(role string, owner bool, banned bool) bool {
	if banned {
		return false
	} else {
		if role == "admin" {
			return true
		} else {
			if owner {
				return true
			} else {
				return false
			}
		}
	}
}
