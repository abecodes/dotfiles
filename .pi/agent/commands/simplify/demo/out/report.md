# Simplify — 3 files

- Scope: 3 files
- Generated: 2026-06-26T15:28:35Z
- Focus: nesting
- Models: opus

## TL;DR

Three behavior-preserving cleanups: the access check flattens three nested if/else levels into early returns, the membership helper returns on first match instead of latching a flag, and IsAllowed is rewritten to reuse the existing containsName helper (dropping a duplicated loop and a dead branch).

## Proposals (HIGH → MEDIUM → LOW)

**[HIGH] [nesting] Flatten nested if/else into early returns**
`access.go:6` · model: opus

**Why simpler / behavior preserved:** Each guard returns immediately, so the trailing branch reduces to `return owner`. Same truth table: banned→false, admin→true, else owner.

```diff
-	if banned {
-		return false
-	} else {
-		if role == "admin" {
-			return true
-		} else {
-			if owner {
-				return true
-			} else {
-				return false
-			}
-		}
-	}
+	if banned {
+		return false
+	}
+	if role == "admin" {
+		return true
+	}
+	return owner
```

---

**[HIGH] [duplication] Reuse containsName instead of reinventing membership**
`validate.go:5` · model: opus · **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-3`

**Why simpler / behavior preserved:** containsName already implements this exact membership check in the same package; delegating removes the duplicated loop and the dead branch in one move. Behavior is identical.

```diff
-	ok := false
-	for _, a := range allowed {
-		if a == tag {
-			ok = true
-		}
-	}
-	if false {
-		// legacy escape hatch, never taken
-		ok = true
-	}
-	return ok
+	return containsName(allowed, tag)
```

---

**[MEDIUM] [idiom] Return on first match instead of a found flag**
`stringsutil.go:5` · model: opus

**Why simpler / behavior preserved:** Returning true on the first hit and false after the loop is equivalent — the flag only ever latches true — and avoids scanning the rest of the slice.

```diff
-	found := false
-	for _, n := range names {
-		if n == name {
-			found = true
-		}
-	}
-	return found
+	for _, n := range names {
+		if n == name {
+			return true
+		}
+	}
+	return false
```

---

**[MEDIUM] [dead-code] Remove dead legacy branch**
`validate.go:11` · model: opus · **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-1`

**Why simpler / behavior preserved:** `if false` is never entered, so the block has no effect on the result.

```diff
-	if false {
-		// legacy escape hatch, never taken
-		ok = true
-	}
```

---

## Model disagreements / conflicts

### Overlapping ranges

- `validate.go:5` — **Reuse containsName instead of reinventing membership** (model: opus): **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-3`
- `validate.go:11` — **Remove dead legacy branch** (model: opus): **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-1`

## Caller-visible (review before applying)

_None — every proposal is an internal change._

## Not auto-patchable

- [HIGH] `validate.go:5` — **Reuse containsName instead of reinventing membership**: **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-3`
- [MEDIUM] `validate.go:11` — **Remove dead legacy branch**: **NO AUTO-PATCH: overlaps another proposal**; conflicts with `#prop-1`

## Apply

`git apply ~/.pi/agent/commands/simplify/demo/out/simplify.patch` applies the 2 patchable proposal(s).

No auto-patch breakdown:
- 2 overlaps another proposal
