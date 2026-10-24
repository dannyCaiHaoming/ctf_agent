# Source Version and Behavior Comparison

Use this reference when supplied source code, version information, or history may help explain an observed application behavior. It does not supply missing challenge source or establish that a historical issue applies to the current target.

## 1. What version evidence establishes

- A commit identifies a repository revision; it does not prove that the target runs that revision.
- A tag or release label names a version. Prefer its recorded revision when available, since labels alone do not establish exact contents.
- A dependency lockfile records intended resolved dependencies, not necessarily the dependencies installed on the target.
- Page labels, response headers, and static resources can provide version clues. They may be stale, modified, or shared across releases.
- A source snapshot supports inspection of that snapshot. Without another revision or supplied history, it does not support claims about what changed.

Keep the source revision, dependency information, and observed target behavior distinct. If their relationship is unknown, state that limitation.

## 2. How a request reaches a handler

A request may pass through route selection, method restrictions, middleware or decorators, session handling, parameter parsing, object lookup, authorization, business operations, and exception handling. Their order and responsibilities depend on the implementation.

Inspect the available path around a handler, not only its function body:

- Authentication establishes who the requester is.
- Function-level authorization determines whether that identity may perform the action.
- Object-level authorization determines whether the action is permitted on the selected object.
- CSRF checks address a different condition and do not establish business authorization.
- Finding an object does not establish permission to act on it.
- A rejected page request does not establish how a related action endpoint is protected.

Record unavailable routing or middleware code as a gap. Do not infer missing checks solely because they are absent from one excerpt.

## 3. What a source difference means

Compare the conditions and effects before and after a change:

- Which inputs, identities, or object states reach the operation?
- Where do checks occur relative to the operation?
- Does object selection or its permitted scope change?
- What happens on rejection, exception, or partial failure?
- Which response or state change would distinguish the two behaviors?

For example, a permission check after an operation may reject the response without preventing the operation; transaction rollback or other surrounding behavior must also be inspected before concluding that an effect persists.

Commit messages describe intent. Actual control flow and relevant dependencies determine behavior. A changed check does not by itself prove exploitability, and an unchanged excerpt does not prove the absence of a vulnerability.

Express a useful comparison as a conditional hypothesis: under stated preconditions, the implementations predict different observable results. If the available material cannot establish those preconditions, keep the hypothesis unresolved.

## 4. How source relates to the running target

Use existing normal responses, available resource contents, and permitted non-destructive observations to compare the target with source-derived expectations.

Distinguish these claims:

- **Present in source:** the inspected revision contains the behavior.
- **Consistent with the target:** observations match that behavior, but may also have other explanations.
- **Supported by an experiment:** an observed result supports the stated hypothesis under the tested conditions.

Matching one response or resource does not establish the entire deployed revision. A mismatch may reflect another revision, configuration, middleware, dependencies, or runtime state; do not select one explanation without evidence.

An HTTP status alone may not distinguish success, rejection, or a handled error. Compare relevant response content and safely observable state. When no permitted observation can distinguish the alternatives, record the uncertainty rather than claim confirmation.

## Evidence limits

Without handler source, handler-level comparison remains incomplete. Without comparable revisions, historical comparison remains unavailable. Without a supported link to the deployed target, conclusions remain conditional.

For any framework-specific or version-sensitive additions, include an authoritative source, the applicable version or revision, and known limits. Do not generalize behavior from an unversioned example.
