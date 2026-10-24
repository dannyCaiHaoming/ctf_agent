---
name: web-session-diagnosis
description: Diagnose Web CTF tasks that depend on login, account state, CSRF state, or a response that appears to depend on an earlier request.
---

# Web Session Diagnosis

Version: 2

Use this method when a Web task has login, account state, CSRF state, or a response that appears to depend on an earlier request.

## Minimal checks

1. Inspect the supplied challenge statement and original attachments with managed workspace tools. If an attachment is an archive, list and unpack it with the host-provided archive tool, then choose and read/search individual text members. Do not treat binary bytes as UTF-8, execute attached files, or replace supplied materials with outside sources. Keep the host-provided source/member references with any findings.
2. Record the request method and response status. Treat 3xx as a redirect signal; inspect the reported in-scope `redirect_location` and choose whether a separate request is justified. Redirects are not followed automatically.
3. After a normal login or state-changing request, make one request to the evidenced protected route in the same HTTP session. Compare it with an unauthenticated request made in a separate session when that comparison is useful.
4. Use `set_cookie_names` and `cookie_names_sent` to tell whether the host received and later sent session state. Cookie values are host-owned and are not shown. Judge authentication from the protected response as well as these summaries.
5. If the protected response still looks unauthenticated, check status, redirect destination, route, method, and whether the cookie name was sent before trying another supported login flow. Do not repeatedly guess routes or credentials without new evidence.

## Follow challenge clues into available materials

Use this method when the statement mentions source code, history, a fix, or version differences, or when supplied files contain forms, API routes, or script references.

When supplied source code, version information, or history needs comparison with observed behavior, consult [Source Version and Behavior Comparison](references/source-version-and-behavior-comparison.md) if available through the permitted tools. If it is unavailable, report that limitation; do not infer its contents or expand access scope.

1. List the supplied materials and identify what each one can establish. Follow concrete references such as a form's method/action or a page's script path into available handlers or files.
2. For each relevant reference, record its source and what remains unknown. If a referenced handler or history is unavailable, report that material gap; do not invent its behavior or replace supplied material with a writeup.
3. Trace a relevant frontend action through its form or script to the request method, target, parameters, object identifier, and available handler. Distinguish permission to perform the action (function-level authorization) from permission to act on the selected object (object-level authorization). Login, CSRF checks, and business authorization establish different conditions. A blocked page does not establish how its related action endpoints are protected. If the script or handler is unavailable, record that gap rather than infer its behavior.
4. Turn one supported clue into a falsifiable experiment. Identify the necessary precondition, the evidence that establishes it, and the observable result that would support or weaken the hypothesis. Compare with a known normal request or state when available, changing one relevant variable at a time. Do not treat a status code alone as proof of authorization or the intended business effect. Keep state-changing checks within the task scope and the recovery boundary described below.
5. If the reference does not match the deployed version, its preconditions are absent, or the next action has an unclear or destructive side effect, preserve the evidence and choose a different check within scope.

## Check response continuation and business postconditions

Use this method after a POST or other state-changing request, when a 2xx response is being treated as success, or when a response is truncated and the omitted part could affect the decision.

1. Before sending a state-changing request, state the expected business postcondition and how it can be observed safely. A 2xx status confirms an HTTP response, not that the intended state change occurred.
2. Check whether the response is complete. If omitted content could change the conclusion, continue reading the referenced observation only as far as needed to decide.
3. Compare the response and any safe before/after state evidence with the stated postcondition. Classify the hypothesis as supported, weakened, or unresolved; keep page exposure, debugger text, successful execution, and obtaining a flag as separate claims.
4. If the response is empty, unchanged, or repeats an earlier result, record what it establishes and do not repeat the same request without new evidence or a justified parameter change.
5. For actions that may delete or alter target state, use only actions allowed by the task scope and with a clear recovery boundary. If the side effect or recovery is unknown, do not perform the action; choose a non-mutating check or report the specific missing condition.

## Solve and hand off a candidate

- The goal is to solve the supplied challenge and find its flag. Continue from exploration to evidence-backed experiments; do not finish with only a route summary while a supported path remains.
- Register a candidate with `candidate.register` only when the exact value is present in observed response evidence. The host owns independent verification and any configured local-oracle submission.
- Use the host-provided oracle status and submission instructions. A target site's own challenge list or submit UI does not indicate whether a separate host-side oracle is configured.
- If no host oracle is configured, a candidate cannot be called accepted or solved. If a candidate depends on cookies, POST, multiple requests, or side effects that the current verifier cannot reproduce safely, preserve its actual evidence and report the verification limit; never substitute an anonymous GET.

## Interpret results

- A login response that sets a cookie proves only that state was issued, not that login succeeded.
- A later request that sends the cookie and reaches the protected page supports session continuity; it does not prove a vulnerability or a solved challenge.
- A redirect to a login page, an authorization error, or a missing cookie is evidence to revise the session hypothesis. Keep cross-origin redirects blocked.
- If the response does not distinguish authenticated from unauthenticated state, seek another evidence-backed observation or report the limitation. Do not register a candidate from an ambiguous response.
- If a supported experiment does not produce a candidate, state what the evidence rules out and the smallest next test. `no_route` is a host run classification, not proof that every solution path is exhausted.

## Stop and change direction

After an experiment, distinguish an invalid request, an unmet precondition, evidence against the hypothesis, and insufficient evidence. A tool error or failed authentication does not by itself disprove the whole route. Use actionable feedback to correct a local invocation error.

Before repeating an experiment, identify what relevant input, state, or evidence has changed and why that change could affect the result. Changing a payload without addressing a missing precondition is not enough. If a necessary precondition remains unmet and no evidence-backed way to establish it is available, park the route and return to an unresolved material reference or another supported hypothesis. A parked route is not proven impossible.

Preserve the response evidence and relevant status, safe redirect location, and cookie-name summaries. Never expose or copy cookie values into notes, tool arguments, or candidate data.
