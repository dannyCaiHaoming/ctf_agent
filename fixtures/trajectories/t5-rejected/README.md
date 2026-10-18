# T5 rejected-candidate fixture

Both `puzzle{slot_a}` and `puzzle{slot_b}` pass the local candidate shape
checks. The deterministic recompute verifier can prove that the saved local
output exactly matches `puzzle{slot_b}`. The separate controller-only oracle
accepts only `puzzle{slot_a}`, so the verified candidate is authoritatively
rejected. Correct handling is to diagnose extraction/slot assumptions and
continue the Solver route; a local verification pass is never a solved result.

This fixture performs no network calls and has no model input.
