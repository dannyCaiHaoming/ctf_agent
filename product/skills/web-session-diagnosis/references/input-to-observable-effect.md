# Input to Observable Effect

Version: 1 — reviewed 2026-10-27.

Use this reference for a Web input whose representation, parsing, calculation, or business effect is unclear. Select the relevant section; pure offline computation does not need it. These invented examples explain comparisons, not target routes or permission to perform them.

## 1. Select an observation

Start with the supplied materials and saved responses. Identify the input location and two plausible explanations, then ask which available observation would differ between them. Prefer one low-cost observation that separates several explanations. Do not perform all three mechanisms as a checklist.

Use the existing [minimal experiment method](../SKILL.md#follow-challenge-clues-into-available-materials) and [response continuation checks](../SKILL.md#check-response-continuation-and-business-postconditions). An authorized role can make an in-scope `ctf_http_request`; inspect saved responses through managed workspace tools. `preview` is only an excerpt: read the necessary saved `bodyPath` bytes before requesting again. `bodyBytes` describes the saved body; if `bodyTruncated` is true, further reads cannot recover the missing tail. A new request is a new observation.

## 2. Representation or transformation?

**Prerequisite:** an evidenced input location and a response region where an ordinary, non-secret marker can be traced. Establish the submitted value and its request representation; do not silently decode evidence repeatedly.

**Competing explanations:** the application returns the input literally; it encodes it for HTML; it transforms the value; or an observation layer changes its appearance.

**Minimal comparison:** use the harmless marker `amber&17` only where that input is authorized. Compare the saved response bytes, response type and character encoding, and the exact layer actually observed. In a known ordinary HTML text context, literal response text `amber&17` and encoded text `amber&amp;17` are different byte sequences. HTML character-reference processing predicts an ampersand for the latter. This is a conditional parsing prediction, not an observation of the target DOM or display. The same bytes in plain text, an attribute, or a script context require their own interpretation. See the HTML source below.

If necessary, change only the initial letter to `Amber&17` and inspect the corresponding saved region. Literal copying predicts case preservation; HTML encoding also preserves the letter while encoding the ampersand. Consistent lowercasing despite that change supports a transformation somewhere on the observed path, but does not identify the responsible component. Check supplied request handling or source when available.

**Counterexamples and next step:** an escaped marker supports a representation change, not code execution. A preview omitting the marker does not establish filtering; read the relevant saved region first. If the complete saved body lacks it, check the evidenced route, input location, response type and state before proposing another comparison. If only raw HTML is available, report only byte-level findings and conditional parsing expectations. Do not invent browser observations or install a browser to close the gap.

## 3. Data, parsing, or calculation?

**Prerequisite:** supplied source, a documented input format, or an existing parser-related error makes a syntax hypothesis relevant. An error can motivate a test without establishing a particular engine. Verify the actual preconditions before using the example.

**Competing explanations:** literal data is copied; a parser rejects syntax; an expression is calculated; an application computes a value independently; or a static/cached response happens to contain the expected number.

**Minimal comparison:** the following predictions apply to Jinja 3.1.x with default expression delimiters, only if the input actually enters template source. Passing a string as a template variable does not itself establish that it will be parsed again. Keep the entry point, observable output region and other relevant state fixed.

| Input | Literal-data prediction | Jinja expression prediction |
| --- | --- | --- |
| `amber17` | `amber17` | `amber17` (ordinary-text baseline) |
| `{{ 5 + 8 }}` | The expression remains text | `13` |
| `{{ 5 + 9 }}` | The changed expression remains text | `14` |
| `5 + 8` | `5 + 8` | `5 + 8` (no expression delimiters) |

Read the corresponding saved output, not an unrelated occurrence of `13`. Changing one operand tests whether the result tracks the expression. The final row is a literal negative control when needed; under the stated template hypothesis its ordinary text stays unchanged. If both wrapped and unwrapped expressions produce numbers, application-level calculation is a competing explanation. Delimiters are configurable, and HTML escaping is a separate output concern; do not assume target configuration from this example. See the Jinja source below.

**Counterexamples and next step:** one 500 or parser error supports only a possible parsing-related path, not a confirmed engine or evaluation. A constant result across changed operands leaves static output, caching, wrong input placement or an unmet precondition open. Recheck saved request/response evidence and available materials instead of blindly replacing expressions. Tracking results with an unchanged literal control supports calculation on the tested path; engine identity and execution location remain conditional without further evidence. This does not establish arbitrary code execution. Do not escalate this example into command execution, file reading, object traversal or payload enumeration.

## 4. Response or business effect?

**Prerequisite:** supplied forms, scripts or responses identify an action request and an independent observation request for the same object/session. Define the expected field and initial value before changing anything; a fixed page shell may not contain that field.

**Competing explanations:** an action changed state; it was rejected or had no effect; the response only returned the page shell; or the observation used a different identity, stale data or unrelated object.

**Minimal comparison:** suppose supplied materials explicitly describe a temporary, session-only display preference that never enters persistent storage. The authorized session has an independently observed `layout` of `compact`; both changing and restoring it are allowed, and the readback and recovery conditions are known. Only under those conditions:

1. Preserve the initial `layout: compact` observation and the evidenced action/readback relationship.
2. Change the preference to `spacious` using the evidenced action.
3. Independently read `layout` for that same session. A transition to `spacious` supports the intended effect; an unchanged shell or a redirect alone cannot decide it.
4. Restore `compact` through the same allowed action and independently read it back. An unconfirmed restoration remains unresolved; do not describe it as recovered.

**Counterexamples and next step:** a 2xx or redirect is not proof of the postcondition. A reliable unchanged field weakens the immediate-effect hypothesis; an uncertain identity, initial value, cache or readback leaves it unresolved. Reuse the evidenced field observation rather than repeatedly fetching a shell that cannot distinguish outcomes. Conversely, a relevant state change can justify the same GET again and yield new evidence; matching parameters or fingerprints do not make it redundant. If session continuity or recovery is unknown, use existing non-mutating evidence or report the missing condition. Do not assume real targets provide the example's temporary storage guarantees.

## 5. Boundaries and results

Use only existing tools, role permissions, challenge scope and budget. Shared cookie jars do not provide independent anonymous controls; switching roles does not create one. HTTP method names alone do not guarantee absence of implementation side effects (RFC 9110 below). Do not use deletion or persistent modification to manufacture a control, or retrieve target secrets for these examples. Jobs may parse saved data or support experiments already allowed by the task.

After the selected comparison, distinguish an invalid invocation, missing preconditions, contrary evidence and insufficient evidence. Repeat only for a relevant input/state change, an explicit control or necessary recheck. When no permitted observation can separate the explanations, preserve the specific unknown and change direction. Do not manufacture decisive facts from missing bytes, identities or baselines.

Keep candidate provenance, independent verification and trusted completion under the existing [handoff method](../SKILL.md#solve-and-hand-off-a-candidate). A mechanism finding alone establishes neither a vulnerability nor a flag or solved state. Do not manually certify host identities, hashes or statuses.

## Sources and applicability

Authoring review accessed all three sources on **2026-10-27**. During a run, use this reviewed local reference; these links do not authorize public browsing.

- [RFC 9110 §9.2.1, Safe Methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1), June 2022: read-only method semantics do not exclude implementation side effects.
- [WHATWG HTML §13.2, Parsing HTML documents](https://html.spec.whatwg.org/multipage/parsing.html#parsing), Living Standard page dated 26 October 2026; overview and character-reference states: response bytes and parsed representations are distinct; context matters. This does not establish a target's browser behavior.
- [Jinja Template Designer Documentation 3.1.x](https://jinja.palletsprojects.com/en/stable/templates/), Synopsis, Math and HTML Escaping: the example assumes default expression syntax; escaping depends on application configuration. These examples cannot identify a target engine.
