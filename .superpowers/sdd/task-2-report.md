# Task 2: Browser Login Handoff Bridge Report

## Scope

- Created `pentest-agent-harness/tools/browser_session_bridge.py`.
- Created `pentest-agent-harness/tests/test_browser_session_bridge.py`.
- Created this report.

## RED

1. Added tests for password-form plus image-captcha detection, OTP/SSO/login API
   detection, out-of-scope URLs, generated artifacts, the isolated overlay host, and
   prohibited browser APIs/data reads.
2. Ran `python3 pentest-agent-harness/tests/test_browser_session_bridge.py` before
   the bridge existed.
3. Observed the expected failure: `ModuleNotFoundError: No module named
   'browser_session_bridge'`.

## GREEN

- Implemented deterministic login-signal detection from input metadata, element kinds,
  SSO-related page URLs, and authentication request names. No input values, request
  payloads, cookies, tokens, or browser storage are read or persisted.
- Implemented exact host and path-prefix scope checks. Out-of-scope pages produce a
  `blocked` handoff and record `browser.login_handoff_out_of_scope` in
  `detection_signals`.
- Implemented a closed-shadow-root overlay injection script with a unique
  `data-pentest-login-handoff` host that replaces any existing host. Its click handler
  only dispatches `pentest-agent:login-confirmed` with `{ handoffId }`.
- Added CLI support: `python3 tools/browser_session_bridge.py <run_dir>
  <browser_login_observation.json>`.
- Writes allowed-page artifacts to:
  - `artifacts/browser-pentest-agent/login_handoff.json`
  - `artifacts/browser-pentest-agent/login_handoff_injection.json`

## VERIFY

- `python3 pentest-agent-harness/tests/test_browser_session_bridge.py`: PASS, 4 tests.
- `python3 pentest-agent-harness/tests/run_all.py`: PASS, including
  `test_browser_session_bridge.py`.
- `git diff --check`: PASS.

## Concern

`login_handoff.schema.json` has `additionalProperties: false`, so a blocked handoff
cannot legally add top-level `root_cause` or `event` fields. The required explicit
out-of-scope event is therefore stored as the sole `detection_signals` value, keeping
the artifact valid under the Task 1 closed schema while preserving the event name.

## Commit

Commit message: `feat: add browser login handoff bridge`.
