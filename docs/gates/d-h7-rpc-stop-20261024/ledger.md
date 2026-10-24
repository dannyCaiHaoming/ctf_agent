# SDD ledger — plan: docs/superpowers/plans/2026-10-24-d-h7-rpc-stop-verification.md

Ruling: 按明确授权复用当前 detached worktree，不创建工作区、不提交、不派 reviewer、不删除计划；主 session 独立核对。
Pre-flight: R1–R3 共用真实 plugin/C RPC；发布提交点为 ArtifactPublisher.records.set；停止必须走 Coordinator ctf_task_stop。

Ruling: 运行目录沿用 launch 的强制 non-git 临时根；所有命令 cwd 为指定子区，原始 run 目录保留并复制 evidence/workspace/state 到子区。这是既有真实 launcher 的运行条件，不能改产品以在 git 区内运行；主区始终只读。
Ruling: 用测试侧内建 HTTP response.end/socket 与 fs.rename 定时注入，C record 包装只观测原有审计（不替代授权、提交、取消、状态判定）；避免为探针增加产品 seam。若 instrumentation 改变正常行为，独立主核对需重验。
Ruling: 本次是既有原型的验证，无产品实现更改；不制造 RED→GREEN 或故意破坏产品。初批四案通过后仅加强测试断言，以整批 final 重新验证。
Task 1: complete — startup hashes checked; new source design/plan copied; C/G stop paths read; previous prototype failures retained unmodified.
Task 2: complete — initial/control,R1,R2,R3 actual launch exit 0; final/control,R1,R2,R3 actual launch exit 0; provider SDK only observes events, no prompt/session resume injection.
Task 3: complete — directed 56/56; full suite 348/348; typecheck exit 0. No product code changed. Original RPC failure/abort responses preserved (these are expected fault cases, not failed verification batches).
Final review: self-review (user explicitly forbids subagents; main session owns independent review). Checked source hashes unchanged, actual HTTP boundaries, rename barrier after C revoke, actual native task.stop, native abort response, per-case source/publish counts and bytes. Main review pending; no merge claim.
Final: Ruling: R3 native runtime abort closes the held socket before release; report discarded-late-response case only. Component test can receive late success without native abort but cannot replace runtime evidence. Cost if misread: overclaiming a native successful late-reply delivery path.
Final: no deferred minor findings. All evidence and plan retained by explicit instruction, no cleanup/commit/push.

Task 4: complete — final typecheck/build exit 0; detailed result backfilled to child design §3; all product hashes equal startup, final manifest saved. Main independent review pending.
