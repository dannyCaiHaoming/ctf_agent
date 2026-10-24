# Root 最终报告完整性切片实作报告

工作区：`/Users/caihaoming/.codex/worktrees/run-completeness-validation/pentest-agent`。只报告相对 `baseline/` 的本次增量；开工已有 dirty 内容未覆盖，未 commit/push、未改主区/design/README/角色/provider/控制层，未派生 agent。

## 实际修改

- `apps/launcher/src/root-result.ts`（新增）：小型纯 metadata 分类器及收束资格判断。最新 user 按可信 created 唯一选取；最新 assistant 按 created、parentID 关联。缺身份/时间、并列候选、最新输入无关联回复均 unknown。允许同毫秒唯一父子关联。length incomplete、stop 空白 incomplete、stop 有字 complete、未知 finish unknown；pending/tool-calls 不触发自然收束。只保留 text 字符数，无正文/reasoning。
- `apps/launcher/src/launch.ts`：移除历史任意 completed 收束条件，连续两次 idle 必须来源与终态事实相同；沿用 pending/executions/resources 防护。收束前冻结来源，正常清理同源 abort 不覆盖 rootResult。历史真实 error 保持 failed。预算检查已经启动清理时只使用已有停止前观测；无观测为 unknown，不读取清理后内容假冒最终报告。原始错误与审计仍保留。
- `apps/launcher/src/progress-ledger.ts`：同一 rootResult 交给 finalize，显示生命周期、报告完整性、原因、来源、观测时间、导出一致性及证据引用；可信产物数量只代表记录数，注明不代表 verified/solved。原正常 shutdown aborted 展示逻辑保留。
- `tests/contract/launch-evidence.test.ts`：已有 SDK mock 只补真实 SDK 必有的 user/parentID/created/finish；root 导出消息数量断言随真实 user 元数据由1变2。zeroed 分支同样补 user，保留原 failed 和 usage 断言。新增来源、完成语义、pending、错误、预算、导出与清理边界端到端测试。`progress-ledger.test.ts` 未改。

精确增量见 `implementation.patch`，开工/最终 hash 见 `source-hashes.json`。

## rootResult 字段

`userMessageID`, `assistantMessageID`, `userCreated`, `assistantCreated`, `assistantCompleted`, `finish`, `completed`, `textChars`, `hasError`, `completeness`, `reason`, `observedAt`, `exportedSourceMatches`, `evidence`。

无法确认引用/时间/finish 为 null。`observedAt` 是冻结来源观测时间；`exportedSourceMatches` 比较后续原始导出与冻结来源/终态事实，防止把变化后的 export 冒称原子最终快照。导出失败为 unknown/export_unavailable，路径为 null。生命周期 status/code 保留；complete 只表示报告正常结束且有文字，不能推导内容正确或 solved。

## TDD 与验证

- 基线：`baseline-tests.log`，2 文件/16 项通过。
- 首次 red：`red.log`，新增14项按预期失败（rootResult 缺失、历史消息提前收束、清理结果未冻结）。
- 边界 red：`red-boundaries.log`（同毫秒唯一父子和无completed APIError），`red-budget.log`（清理后快照误当报告），`red-history-error.log`（历史真实abort被误豁免）；均先看到预期失败再修正。
- 最终定向：`green-final-4.log`，2文件/36项通过，exit0。
- 最终 `npm run typecheck`：`typecheck-final-4.log`，exit0。
- 最终 `npm run build`：`build-final-4.log`，exit0。
- 最终 `npm test`：`full-test-final-4.log`，49文件/430项通过，exit0。
- `git diff --check` exit0。

覆盖空/partial length、正常 unsolved stop、空白stop、未知finish、partial未完、tool-calls、历史完整+最新pending、最新user无回复、错parent、同时间歧义、缺ID/created、乱序数组、idle来源变化、pending派发、APIError、deadline、export失败、无停止前快照的budget、同源清理abort和历史真实abort。展示端确认没有partial正文及测试secret，complete明示不等于solved。来源变化测试包含额外usage轮询的真实读取节奏，不以数组顺序/次数推断时间。

## 原生本地探针

最终源码 `root-offline-probe.ts`，最小投影 `native-minimal-evidence.json`，原输出 `native-final/runtime-summary.json`，执行日志 `native-final.log`。固定OpenCode1.19.3、Node26.3.0。`env -i` 仅传PATH/隔离HOME/TMPDIR；`isolation.sb`拒绝外连仅localhost，启动前1.1.1.1:443实测EPERM，见 `native-final/isolation.json`；provider key为虚构local-only。所有四例各一次本地HTTP请求，无真实模型或目标。

| case | max_tokens | status/code | completeness |
|---|---:|---|---|
| empty-length |64|completed/0|incomplete|
| partial-length |64|completed/0|incomplete|
| normal-stop |64|completed/0|complete|
| budget-smaller |512|completed/0|complete|

四例可信publication/verification/completion记录均0。探针明确断言版本、请求数、上限、rootResult和progress完整性。没有追加prompt/恢复。

## 保留的失败与限制

- 初次probe因临时目录缺少`type:module`在任何runtime/provider启动前失败：`native.log`；仅在临时目录加package.json后成功，未改产品。
- `typecheck.log`/`typecheck-2.log`保留新增参数化测试tuple类型失败，最终修正测试类型后通过。
- `green.log`保留zeroed mock缺user及测试读取序列时序错误；补SDK必有元数据和正确模拟每轮usage/idle读取后通过。`green-final-3.log`/`full-test-final-3.log`保留收紧同源abort豁免后旧测试cleanup消息ID不真实的失败；测试改为同一冻结assistant ID，未放宽生产判断。
- 所有旧red/green日志保留，不拼接不同批次成功冒充同批。最终full-test-final-4和native-final分别为完整同批验证。
- SDK消息快照与后续导出不是原子操作；结果明确是停止前观测，导出变化通过exportedSourceMatches呈现，不新增调度锁/框架。正常stop complete不证明解题成功。未验证真实模型、真实目标、内容正确性、readiness、子任务完整性或Critic调度。
- 既有progress先写、后续证据写入失败再改变run状态的时序契约未扩展重构；本次保留既有失败记录与最终run状态。

工作区保留，等待主会话独立review；未继续下一功能。


## 独立 review P2 修正（2026-10-25）

复核 `review.md` 与实际 seam 后确认：每轮 `checkBudget/refreshObserved` 和 idle 各读一次 root，原来的 `reads >= 4` 会漏掉错误的提前收束。修改范围仅 `tests/contract/launch-evidence.test.ts` 的既有来源变化用例，没有改输入样例或生产语义。

- 将读取阶段断言加强为 `reads === 7`，对应 first idle、second首次idle、second再次idle，以及停止后的第7次export。
- 同时断言 `evidence/messages-root.json` 确实导出同一 second ID 的 `MessageAbortedError` 和空 text，保证实际走到构造的清理阶段。
- 冻结 `rootResult` 断言补 `textChars=6` 和 `exportedSourceMatches=false`，保证仍引用停止前的完整 second 报告，明确导出已经变化。

执行前快照：`review-fix-baseline/`，hash：`review-fix-baseline-hashes.json`。本轮精确增量：`fix.patch`（相对review时快照，仅测试一处）；最终hash：`review-fix-final-hashes.json`。

实际mutation：短暂把生产文件的 `(source === idleSource ? idleSeen + 1 : 1)` 改为 `idleSeen + 1`，运行 `npm test -- tests/contract/launch-evidence.test.ts -t 'restarts idle confirmation'`。`review-fix-mutation.log` 显示该测试明确失败、exit1：期望7次，实际5次。随后立即从本轮快照恢复 `launch.ts`，`review-fix-restore.json` 核对恢复前基线与恢复后SHA256完全相同（`f75197badeae96a6980f2f955c4aab8b174124285554743ce81d1490b38264b0`）。mutation没有保留为产品增量。

恢复后验证：

- `npm test -- tests/contract/launch-evidence.test.ts tests/contract/progress-ledger.test.ts`，`review-fix-targeted.log`，2文件36/36通过，exit0。
- `npm run typecheck`，`review-fix-typecheck.log`，exit0。
- `npm test`，`review-fix-full-test.log`，49文件430/430通过，exit0。
- `git diff --check`，exit0。

生产源码未变，本轮按授权未重跑原生probe/build。仍是确定性SDK seam的回归保护，不扩称原生异步竞态或真实模型能力验证。未运行模型/目标、未commit/push、未派生agent，工作区保留，交主会话复核后停止。
