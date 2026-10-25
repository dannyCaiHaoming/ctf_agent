# 结果完整性与交接可见性实施报告

状态：实现与最终同源无模型验收完成，等待主会话独立 review／接入。未 commit、push 或修改主区。

工作区：`/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent`。HEAD `81cc7fc06497088d9391c9ed93cc405694f6cf2e`，detached HEAD。依据 task-1-brief 与详细 design §4–§5；不将本次接线等同有效报告、有效恢复、Critic 行为或 solved 验证。

## 实际增量与判断

仅以下 7 个文件属于本次增量，按输入快照对照，不按 Git dirty 总量认领：

- `apps/launcher/src/control-service.ts`：同步调用以 parent/callID 保存；可信 dispatch 后登记，冻结唯一 user，复用 child-result 分类。持久冲突、终态重放、同 call 改参数、同 child 重入、原生 error 的 pending 释放均按调用隔离。SDK 读取在串行锁外，返回后重查停止、有效期、来源与 child 绑定身份。新增 sync.source/result/failed 白名单审计；不新增正文、reasoning 或 error payload。后台只返回本次接收 notice 的事实；准入仅消费 prepared ID 集合中的同父 queued 记录。同步 active/reading 也阻止自然收束。
- `apps/opencode-plugin/src/index.ts`：同一原生通知追加具 id/sessionID/messageID 的 synthetic TextPart；同步沿当前 tool.after 输出追加，保留原文及 metadata。transform 按 session 保存当前 user 配对快照，params 取出立即删除；空、混合、不匹配、ignored 或拒绝后不得复用。unknown textChars 为 null。
- `product/opencode/agents/coordinator.md`：阶段交回是评估时点；无 artifact 不等于无新信息；持续交接失败或需换路时明确评估 Critic。保留 Coordinator 决策权限，不增加自动调用、恢复次数或同义补交提示。
- `tests/contract/g-async-lifecycle.test.ts`、`opencode.test.ts`：同步来源/生命周期、歧义、错误、await 停止/冲突/身份、展示、精确消费、快照拒绝重用等定向回归。
- `tests/contract/control-service.test.ts`、`launch-evidence.test.ts`：旧 SDK fixture 原先只有 before/bind，没有同步 after。补齐可信终态生命周期，保留原断言，使跨轮恢复和 Root/usage 回归适配新守护；没有将生产空快照 bug 用补测试入参遮掉。

原型仅逐 hunk 对照复用，未整文件覆盖；未带入原型 trace 或 compaction hook。额外 RED 暴露并修复了同 call 改 background 绕过、缺同步 source 审计、await 后 role 重查遗漏、同步等待遗漏、无 prepared 集合却凭 messageID 消费，以及 prepared/user 同为 undefined 时读空对象的分支。

输入准备差异由主会话确认：plan 的授权状态文字在快照后由主会话更新；`.handoff` 故意不复制。均不属于本次实现，不恢复、不删除、不纳入 `implementation.patch`。所有其他既有 dirty 输入保持。详见 `/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent/docs/gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/relative-input-files.json`。

## 验证与失败记录

最终冻结源码后的检查：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm test` | exit 0，49 文件、481 测试通过，无 skip |
| `npx vitest run tests/contract/control-service.test.ts tests/contract/launch-evidence.test.ts tests/contract/g-async-lifecycle.test.ts tests/contract/opencode.test.ts` | 4 文件、137 测试通过 |
| `zsh .../final-implementation/run-native.sh` | 最终同源六案均 completed/code 0 |
| `python3 .../final-implementation/verify-projections.py` | 六案实际 provider 请求投影与 source hashes 均通过 |

日志与 exit 状态在 `checks.json`、`typecheck.log`、`build.log`、`test.log`、`directed-final.log`。Root 最终报告与已实现后台关联的既有回归保留通过。

保留的失败不并入成功数量：初始 RED 15 条；额外边界 RED、同步等待 RED、无快照消费 RED、空 prepared RED 分别保留日志。首轮全套 15 失败（14 条来自空 prepared 分支，1 条旧跨轮 fixture 未结束同步调用）保存在 `attempt-2-before-empty-snapshot-fix/test.log`；修复后重新跑最终全套。一次 typecheck 因新增测试漏 args 失败，已补真实 hook 输入并重验。首次原生六案运行因 runsRoot 在仓库内全部被 blocked_configuration 拒绝，证据在 `attempt-1-run-root-rejected/`；改为自有隔离 HOME 下 run 目录。第二批六案早于最后空快照修复，保留为 attempt-2，不能作为最终验收。投影脚本首次误要求 failed 包络含 task_result，修正为原生 task_error；该断言失败日志保留，未改变产品或替换失败样例。

## 原生验收

固定 OpenCode **1.19.3**，Node **v26.3.0**；实际本工作区 launcher/control/plugin，实际公开 runtime 与本地确定性 HTTP provider。`env -i`，自有 HOME/XDG，OS loopback-only；每案开始先断言外连 **EPERM**，无真实 provider 凭据。仅使用本地虚构 key；没有真实模型或靶场。探针配置 output=128 是确定性样本，产品 output=8000 未改。

| 最终样本 | 已核对 |
| --- | --- |
| resume-partial / resume-empty | 后台 partial/empty length，随后同 child 同步 stop；旧 ref 不改写，user 来源不同 |
| pure-empty / pure-partial | 纯同步 empty/partial length 均 incomplete；没有后台 execution/ref |
| combined | 两条后台 notice 与同步调用共存；两条分别 consumed 且 admitNo 相同，700ms 同步等待期间无父请求提前继续 |
| failed | 确定性 HTTP 400 产生真实 failed notice；原 task_error 包络与 error 完整性事实均进入父请求并被消费 |

投影检查直接核对父 provider HTTP 请求中的事实与原包络、ref/callID、role、source、finish/completeness/textChars、每身份唯一、消费 noticeMessageID/admitNo；不是仅凭 hook 返回或审计宣称送达。同步工具原包络保持前缀，metadata 的保留另由 plugin 实际 hook 测试核对。SDK 错误／冲突／停止竞态是定向替身分支，与真实 HTTP failed 样本分开。

原生证据：`/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent/docs/gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation`。每案 `closed-projection-*/metadata.json` 保存白名单 provider 请求投影、execution 事实与审计；`verified-projections.json` 保存断言结果。没有保存新增原始 reasoning；原生临时 raw run 与自有 HOME 在提取投影后删除，metadata 中 runDir 只是历史路径。固定版本与环境见 `version.json`、`isolation.json`、`isolation.sb`。

## 源码冻结与交接

完整同源 manifest 为 `/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent/docs/gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/source-hashes.json`（同时涵盖 Root、child-result、launch、progress 底座与未修改产品配置）；增量补丁为 `implementation.patch`，只含上述 7 文件。最终投影脚本再次核对 manifest 与当前文件相同。

| 文件 | SHA-256 |
| --- | --- |
| `apps/launcher/src/control-service.ts` | `a3d105b7889ff59b24009b0438dfd3f2f74d01d55b35328dc2e7f948c753c3e4` |
| `apps/opencode-plugin/src/index.ts` | `7520ebb897012ced73918a98b856dcb22f6a1a99228f0ac6954bf218bd0c2d03` |
| `product/opencode/agents/coordinator.md` | `73d2a6840ea475b0156394693415ce8a4387791082030b6ad4cf113d4abdb8ef` |
| `tests/contract/g-async-lifecycle.test.ts` | `c06705de5b2748bf0be4b9c60dca0cccee22164cf0e89a850baf77a3fb3277b5` |
| `tests/contract/opencode.test.ts` | `ad1bc6e0ef444f7ac2ef78ca91d12ad1298ddb32c890adb778640294a91674c0` |
| `tests/contract/control-service.test.ts` | `32bf1094b2805022637fc62a57e2f6879516f3b3eff16ebf146a9d2f5b0d874d` |
| `tests/contract/launch-evidence.test.ts` | `7ed01cf996d0bb52631a039fcd17e6b89c94b55d1dab6a924b86d8d769b62a26` |

限制：无真实模型调用，不证明生成内容正确、有效交接、避免无效恢复、Root 报告质量、Critic 理解或实际调度；不证明 solved。自然竞态、全部 adapter、压缩兼容未验收；压缩保持禁用。未读私有答案/原始 reasoning、未触真实靶场、未调整 8000、未增角色/Skill/工具/自动补叫或框架。host 检查到 plugin 保存仍非原子。独立 review 与主区接入、design/README 回补、plan 删除由主会话负责，本报告不认领这些结果。

## 独立 review 后定向补充

按主会话复核意见，仅在既有 g-async-lifecycle 增加同 child 连续两次同步正常完成测试：分别冻结 sync-user/sync-user-2，两个 call 产生 4/13 字符结果；第二轮不覆盖第一轮，旧 after 重放不再读取 SDK。`npx vitest run tests/contract/g-async-lifecycle.test.ts`：62 条通过；`npm run typecheck` 再验 exit 0，日志为 directed-two-sync-rounds.log、typecheck-after-review.log。原全套 481 条结果来自补此单项测试前，未将其虚报为 482 条全套。

运行时代码、Coordinator、原生探针均未改，故按主会话要求不重跑六案。native-source-hashes.json 保留原生运行时的 manifest；source-hashes.json 更新唯一测试文件 hash，二者除该测试外完全一致。implementation.patch 已更新覆盖补充测试。
