---
name: recon-investigation
description: Use when Recon needs to distinguish competing explanations in supplied materials or authorized observations, assess remaining baseline investigation value, or resume a recorded question before handing an evidenced route to Domain Solver.
---

# Recon Investigation

Version: 2
Source: repository design `docs/superpowers/specs/2026-10-29-design-v1-recon-redesign.md`, sections 2–3 and 11 (2026-10-30). This asset contains the runtime method; that repository document is provenance, not a required runtime read.

Use when an assigned baseline question about a service, attachment, protocol or mathematical structure needs evidence, or when experiments keep changing outputs without resolving the same uncertainty. Load on demand. Apply only the relevant investigation; this is not a scan pipeline.

Do not use this method to pursue exact transcription, character segmentation or comparison, or a deep solve-loop. Those belong to Domain Solver. Recon may render or inspect structure when needed to establish a route; successful image viewing does not establish reliable pixel reading or exact transcription. This method grants no tools, delegation, scope or budget.

## Start from what the materials can establish

Read the assigned question, required baseline and supplied concrete leads with their source references. Read the existing `work/recon-investigation.md` through `ctf_workspace_read` before choosing another experiment, including on continuation of the same run and task. Reuse conclusions whose conditions still hold. Missing notes, sources or a lead list are gaps, not evidence that nothing was tried or that no leads exist.

Identify what each relevant material can prove and its limits: supplied source can establish local logic, not deployment equivalence; an observed response establishes behavior under its observed state, not all states; a rendering can expose structure without resolving exact symbols. Separate observed facts from interpretations and check whether missing or truncated evidence affects the decision. Follow an existing concrete reference with a feasible low-cost check before broad enumeration; retain unavailable leads and their reasons.

## Ask one distinguishing question

Choose one unresolved question that could change the baseline or route. State the competing explanations, the necessary precondition, and the observation that would distinguish them. Before continuing, be able to briefly explain what remains uncertain and how the next experiment's different outcomes would change a route or handoff decision. If both explanations predict the same result, or no decision would change, the proposed experiment does not justify continuing.

Pick the smallest authorized controlled experiment with that distinction: use a known baseline or comparison when available, change a relevant variable, and identify the observable outcome before acting. If a required precondition cannot be established, record the gap rather than interpret failure as a refutation. For state-changing actions, require an authorized action and a clear recovery boundary; unknown side effects call for a non-mutating alternative or a blocked result.

A new filename, image, crop or parameter is not new information by itself. Explain which competing explanation the change can distinguish. If source already establishes coordinate direction, merely changing colors or presentation is insufficient reason to continue. If it only repeats the same unresolved transcription bottleneck, preserve the structural evidence and hand the route to Solver. Repeating a URL or tool can be necessary: a GET after a state-changing POST observes a different state; rereading the same URL after login state changes can test a changed premise. Revalidation needs a relevant change in state, premise or evidence and a decision the different outcomes could change, not a blanket duplicate prohibition. Record the reason when experiments or routes change, not after every tool call.

## Interpret and update the same problem record

After a meaningful experiment, compare its actual observation with the predicted distinction. Keep tool success, valid execution, established preconditions and evidence for a conclusion separate. An invocation error, missing prerequisite, incomplete output, no match or unreadable image is not automatically evidence against the route. A valid negative result refutes only the explanation under the tested conditions and observed coverage; **tested does not mean refuted**.

Use `ctf_workspace_write` to maintain one Markdown master, `work/recon-investigation.md`, owned by this Recon session. Under each stable question, retain:

- The question, known premises and required baseline; keep question identity separate from evidence versions.
- Distinguishing experiments tried, their relevant controls or changes, and what they were meant to distinguish.
- Actual observations and sources, with inference, truncation and unknown results explicit.
- Refuted explanations and their supported scope; unresolved or incomplete tests remain unresolved or untested.
- Routes remaining, the decision each experiment's different outcomes could change, and whether it belongs to Recon or Solver; distinguish experiments that cannot effectively distinguish current explanations from blocked and unknown routes.
- Untested items, why they remain untested, and the input, state or evidence changes needed for a worthwhile retry.

Update after meaningful experiments, supported refutations or route changes, and before handoff; not after every tool call or only retrospectively. Record concise facts and judgments, not private reasoning. Use actual work/job/HTTP sources locally and fix necessary sources as real artifact refs for handoff. Never invent identities or hashes. Keep secrets, control credentials, private oracle answers, flag or candidate bytes, cookies, full prompts, chain-of-thought and job argv out of notes and summaries. Leave large raw evidence in its existing carrier with a source reference.

If a write fails or work is interrupted before recording, retain that gap. On same-task continuation, compare the master with the new assignment and existing sources; do not restart because a file or parameter changed. Missing evidence or unknown execution is not permission to repeat an action with unknown side effects. This convention does not guarantee automatic recovery, exactly-once execution or cross-run memory.

## Hand back for an evidenced reason, ready for downstream work

Use the updated record to decide whether the assigned uncertainty is resolved, what decision another feasible in-scope experiment could change, and who owns the next action. Investigation order concerns this assignment, not team planning or task scheduling.

Stop experimenting and identify the applicable handoff reason:

- The current question is answered: evidence supports the assigned baseline conclusion. Return the conclusion, evidence refs and scope.
- The next action mainly belongs to solving: the entry, materials and key premises are established; exploitation, derivation or exact recovery remains. Return an executable route, necessary materials and what is not yet proved.
- Investigation is blocked or further investigation has low value: a necessary premise is missing or remaining experiments cannot effectively distinguish current explanations. Return a partial baseline, unresolved questions and conditions needed to resume investigation.
- The allowance requires closure: rely on the host's closure rejection message. Return current findings, unfinished items and the stop reason; do not claim the baseline is complete. This reason may accompany any of the first three, which are evidence-based judgments by Recon.

Do not require all challenge solutions to be exhausted. An early route does not excuse an unfinished baseline check whose different outcomes would change a decision; a route does not require Recon to finish the solve. Handoff should let Solver start: explain what is established and on what evidence; which explanations are refuted and within what scope; the next experiment and its premises; and which materials are directly usable or still missing. “It may be some encoding” is usually insufficient; “source establishes the transformation, input and parameters are extracted, inversion remains, and the relevant materials are published” approaches an executable handoff. Exact transcription is not a handoff prerequisite.

Finish the master and necessary files, then use existing `ctf_artifact_publish` to fix required evidence and a sanitized record snapshot. The master remains the only editable source; snapshots and task summaries are handoff material. Return through the native task with baseline facts, route, important experiments and scoped refutations, remaining or untested items and retry conditions, handoff reason, actual tool-returned refs and necessary extraction instructions. A private work path cannot transfer evidence to another role. The recipient must read the required artifacts; publication alone does not establish consumption.

Preserve `snapshotFixed`, `rangeComplete` and `originalComplete` separately, including truncation and unknown source completeness. If execution or a publication receipt is unknown, pause the affected handoff without rerunning the experiment or blindly publishing again. Publication, candidate registration, independent verification and solved remain distinct; Recon does not package, verify or submit.
