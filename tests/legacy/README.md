# Frozen pre-OpenCode regression harness

These two implementations preserve deterministic regression coverage for frozen M1b assets and historical protocol fixes. They are excluded from the production build, are not exported from `@ctf/supervisor`, and cannot be selected by the product CLI. Do not extend or use them as the design for new product work.

The current product path is `solve` → OpenCode session → managed plugin → Bridge → Tool Runtime. `gate:m0` includes an actual OpenCode integration test; `gate:m1` runs its golden path and behavior grader through that same path.
