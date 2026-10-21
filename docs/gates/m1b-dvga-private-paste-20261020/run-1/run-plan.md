# DVGA private paste ID finding run 1

Date: 2026-10-20 (Asia/Tokyo).
Target: user-authorized local DVGA at `http://localhost:5013/`.
Task: send one unauthenticated `POST /graphql` query `{ pastes(public: false) { id } }`, register the exact complete response if it returns IDs, then independently replay the same request through the host verifier. Do not request paste content or make mutations.

Proposed limits: 300,000 observable tokens, 900 seconds, 60 steps, 40 tool jobs. Usage is accounted for after completed responses, so the threshold may be exceeded by the final response. One real run only; no automatic retry.

The local candidate result is not an authoritative DVGA completion result. Even a successful replay remains `candidate_only`; it is not `solved`.
