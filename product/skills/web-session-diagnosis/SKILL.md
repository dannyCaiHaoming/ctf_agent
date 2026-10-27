---
name: web-session-diagnosis
description: Use when a Web CTF task involves login or session state, comparing supplied source, routes or version materials with observed behavior, HTTP response completeness or business postconditions, or unclear input representation, parsing, calculation or business effects.
---

# Web Session Diagnosis

Version: 6

Use the relevant sections when a Web task involves:

- Login, account state, CSRF state, or a response that appears to depend on an earlier request.
- Comparing supplied source code, routes, or version materials with observed behavior.
- HTTP response completeness or the business postcondition of a request.
- Input that appears transformed, causes a parsing error, or has an unclear calculation or business effect.

Choose sections according to the observed problem and available materials; do not perform login checks when no session question is involved, or read every Reference by default. This method does not apply to pure offline computation or tasks without a related Web problem.

## Shared prerequisites and supplied materials

Inspect the supplied challenge statement and original attachments with managed workspace tools under `materials/`, `work/`, and `published/`. If an attachment is an archive, an authorized role can use `ctf_job_run` with available Python or tar to list or unpack it into its own work directory, then read/search individual text members. Do not treat binary bytes as UTF-8, execute attached programs, install dependencies during a run, or replace supplied materials with outside sources. Preserve the material references and extraction paths with findings.

## Session diagnosis: minimal checks

Use these checks when login, account state, CSRF state, or dependence on an earlier request needs diagnosis.

1. Use `ctf_http_request` within the authorized origin. Record method, `status`, `headers`, `headersTruncated`, and `redirectChain`. `follow_redirects` defaults to false; inspect the Location header when available and decide whether a separate request or explicit in-scope following is justified. A truncated header set is incomplete evidence; keep cross-origin redirects blocked.
2. After a normal login or state-changing request, request the evidenced protected route. Recon and Domain Solver share the host cookie jar for the same challenge; another Agent is not an anonymous control. There is no independent session selection or reset interface. Use reliable pre-login evidence for comparison when available, otherwise record the missing anonymous baseline.
3. The host automatically stores and carries applicable jar cookies. This does not establish login success, and the tool exposes no sent-cookie-name summary. Returned headers may include Set-Cookie values; do not copy those values into notes or handoffs. Judge authentication from protected content and observable state, preserving uncertainty about cookie transmission.
4. If the protected response still looks unauthenticated, check status, available redirect destination, route, method, and the observed state transition before trying another supported login flow. Do not repeatedly guess routes or credentials without new evidence.

## Follow challenge clues into available materials

Use this method when the statement mentions source code, history, a fix, or version differences, or when supplied files contain forms, API routes, or script references.

When supplied source code, version information, or history needs comparison with observed behavior, consult [Source Version and Behavior Comparison](references/source-version-and-behavior-comparison.md) using the Reference path returned by the native skill tool, through the permitted tools. If it is unavailable, report that limitation; do not infer its contents or expand access scope. A version label is not supplied history or proof of deployed contents. A single source snapshot can still be inspected; without comparable revisions or history, record changes as unknown.

1. List the supplied materials and identify what each one can establish. Follow concrete references such as a form's method/action or a page's script path into available handlers or files.
2. For each relevant reference, record its source and what remains unknown. If a referenced handler or history is unavailable, report that material gap; do not invent its behavior or replace supplied material with a writeup.
3. Trace a relevant frontend action through its form or script to the request method, target, parameters, object identifier, and available handler. Distinguish permission to perform the action (function-level authorization) from permission to act on the selected object (object-level authorization). Login, CSRF checks, and business authorization establish different conditions. A blocked page does not establish how its related action endpoints are protected. If the script or handler is unavailable, record that gap rather than infer its behavior.
4. Turn one supported clue into a falsifiable experiment. Identify the necessary precondition, the evidence that establishes it, and the observable result that would support or weaken the hypothesis. Compare with a known normal request or state when available, changing one relevant variable at a time. Do not treat a status code alone as proof of authorization or the intended business effect. Keep state-changing checks within the task scope and the recovery boundary described below.
5. If the reference does not match the deployed version, its preconditions are absent, or the next action has an unclear or destructive side effect, preserve the evidence and choose a different check within scope.

When input representation, parsing/calculation, or the effect behind a page response is unclear, consult [Input to Observable Effect](references/input-to-observable-effect.md) through the permitted Reference path returned by the native skill tool. Use its relevant comparison with the minimal experiment above and the business postcondition checks below; do not load it for unrelated tasks or perform all three comparisons by default. If unavailable, report that limitation without expanding access.

## Check response continuation and business postconditions

Use this method after a POST or other state-changing request, when a 2xx response is being treated as success, or when only a response preview is visible or a response is truncated and the omitted part could affect the decision. These checks do not require a login flow.

1. Before sending a state-changing request, state the expected business postcondition and how it can be observed safely. A 2xx status confirms an HTTP response, not that the intended state change occurred.
2. Distinguish `preview` from the saved body: use workspace reads of `bodyPath` to inspect the saved `bodyBytes` as needed. If `bodyTruncated` is true, the original response was not fully saved; reading all of bodyPath cannot recover its missing tail. Preserve that limit. A new request is a new observation, not continuation or proof that the original response was complete.
3. Compare the response and any safe before/after state evidence with the stated postcondition. Classify the hypothesis as supported, weakened, or unresolved; keep page exposure, debugger text, successful execution, and obtaining a flag as separate claims.
4. If the response is empty, unchanged, or repeated, record its limits and do not repeat without new evidence or a justified input change. For a decisive remote search, retain the search process's own status, stderr, bounded stdout, and searched scope using available capabilities. Keep its status separate from downstream commands, HTTP, and local jobs. Interpret no-match status according to the actual tool; if status, errors, or necessary output are unavailable, preserve search validity as unknown. Hand off the supported local conclusion with a small decisive excerpt and its source.
5. For actions that may delete or alter target state, use only actions allowed by the task scope and with a clear recovery boundary. If the side effect or recovery is unknown, do not perform the action; choose a non-mutating check or report the specific missing condition.

## Solve and hand off a candidate

- The goal is to solve the supplied challenge and find its flag. Continue from exploration to evidence-backed experiments; do not finish with only a route summary while a supported path remains.
- Preserve an exact candidate only when supported by managed HTTP, job, or trustworthy extraction evidence from supplied attachments. Recon / Domain Solver publish their own source with `ctf_artifact_publish` and hand off its actual ref, the half-open candidate byte range, extraction and required dependencies. Engineer fixes the candidate and solution package with `ctf_package_publish` and returns the actual version. Publication is not independent verification or solved.
- Coordinator binds the challenge/version with `ctf_challenge_assign` before dispatching an independent Verifier. Verifier uses the bound package and `ctf_verification_report`; Coordinator fully reads the specified report through `ctf_verification_read` and may request trusted completion with `ctf_completion_request` only for a currently effective verified result. Roles retain their own permissions; this method grants no extra scope, tools or budget. Transport unknown pauses the affected handoff; an unknown submission must not be blindly resent or bypassed with a new version.
- Use the host-provided oracle status and submission instructions. A target site's own challenge list or submit UI does not indicate whether a separate host-side oracle is configured.
- If no host oracle is configured, a candidate cannot be called accepted or solved. If a candidate depends on cookies, POST, multiple requests, or side effects that the current verifier cannot reproduce safely, preserve its actual evidence and report the verification limit; never substitute an anonymous GET.

## Interpret results

- A login response that sets a cookie proves only that state was issued, not that login succeeded.
- A later request that reaches evidenced protected content supports session continuity; it does not prove a vulnerability or a solved challenge.
- A redirect to a login page, an authorization error, or missing expected state is evidence to revise the session hypothesis. Keep cross-origin redirects blocked.
- If the response does not distinguish authenticated from unauthenticated state, seek another evidence-backed observation or report the limitation. Do not treat an ambiguous response as exact candidate evidence.
- If a supported experiment does not produce a candidate, state what the evidence rules out and the smallest next test. One experiment without a candidate does not establish that every solution path is exhausted.

## Stop and change direction

After an experiment, distinguish an invalid request, an unmet precondition, evidence against the hypothesis, and insufficient evidence. A tool error or failed authentication does not by itself disprove the whole route. Use actionable feedback to correct a local invocation error.

Before repeating an experiment, identify what relevant input, state, or evidence has changed and why that change could affect the result. Changing a payload without addressing a missing precondition is not enough. If a necessary precondition remains unmet and no evidence-backed way to establish it is available, park the route and return to an unresolved material reference or another supported hypothesis. A parked route is not proven impossible.

Preserve the response evidence and relevant status, safe redirect destination and observable state changes. Do not copy cookie values from headers into summaries, tool arguments or candidate data; avoid exposing them in handoffs.
