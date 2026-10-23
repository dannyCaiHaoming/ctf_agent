# G 异步生命周期：联合无模型验证

日期：2026-10-23，Asia/Tokyo。专属工作区：`/Users/caihaoming/.codex/worktrees/g-joint-async-lifecycle/pentest-agent`。依据执行时主区最新 G §7、C design 与总 design；仅隔离原型、无 commit/push/合并。主区与原型来源零文件 hash 漂移，见 `source-integrity-after.json`；主 session 的独立复核尚未完成。

**结论：固定版本的原生公开路径可行，本切片联合验证通过。** 已安装 OpenCode **1.19.3** 在公开 server 环境开关 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 下实际暴露 background schema，原生 task 提供早期 child 引用和自动完成通知。采用该路径，**没有启用 SDK 备案，也没有测试侧 SDK 恢复 child 制造时序**。此前未开开关的 schema 缺口与前台阻塞失败保留，不改标为成功。

这证明产品 launcher → plugin → C → 固定 OpenCode runtime 的确定性接线可行；不证明真实模型会选择正确工具或能解题。产品代码没有合并主区，OS／网络／持久配额／D/oracle 没有在本片验证。

## 来源与候选

- 主区及指定 `g-c-rpc-slow-tools` 来源 HEAD 均为 `d83a0c3024271dbf212db319e900fcf527e68b0f` 加各自既有未提交内容。开始时主区已有 dirty 文档，未覆盖、reset、stash 或提交。原生 `create_worktree` 建立专属隔离区；复制最新 AGENTS/CLAUDE、design 和计划，未退回旧 HEAD 文档。
- 长 job 来源 `32d7` 与停止来源 `93f6` 工作区已不存在。按主区两份 parent-review 的路径，使用已保存的 `decision-long-job/prototype.patch`、`decision-coordinator-stop/candidate.patch` 与 `candidate-source/` 恢复增量。来源文件、hash、HEAD/status 与每次复制见 `sources.json`。插件两项增量重叠，初次 import 冲突保留在 `00-import-conflict.log`，仅组合各自的 terminal 与 stop 改动。
- `joint.patch` 是相对“指定 G/C 原型＋两项既有增量”的本次差异；相对 HEAD 的大 diff 包含导入基线，不能全算本次新写。`changed-files.json` 列本次增量，`candidate-hashes-before/after.json` 证明最终检查和六个 runtime 情境使用同一候选、零源码漂移。
- Node v26.3.0、npm 11.16.0、SDK/plugin 1.19.0、Vitest 2.1.8；二进制及版本 hash 见 `versions.json`。运行前完成本区 npm ci。每个 run 用独立 HOME/config、仅 enabled `stub`、loopback endpoint 与虚构 key；代理指向本地拒绝端口且 loopback 例外，未读取真实 provider 凭据。

## 选定的最小公开映射

1. Coordinator assign 后调用原生 `task(background=true)`。C 保留同父同角色一笔 pending；父下一轮不释放。异步首次绑定还查 SDK child 的 parentID/agent 和父 tool part 的 callID→metadata.sessionId，不猜测迟到 child。公开 task error 仅释放对应 starting call，unknown 保留。
2. C 为每次执行生成 ref，经公开 before hook 覆写原生 description 为固定 `[ctf:<ref>]`。原生通知的 synthetic、原父、child、宿主 ref 和 callID 均须匹配；标记是宿主生成的关联载体，不从模型自由文字授予身份或题目。恢复同 session 使用新 ref；仍运行时 extend 拒绝。它依赖固定版本保留这些公开字段，升级须重验。
3. 模型的 job.run schema 只有 argv/timeout，同次等待终态；不提供 wait_ms/completion 双模式。内部 JobManager 仍有初始 wait，由 C 等待同一 done；无模型轮询。**原型 C 仍接受旧 direct-host 回归用的显式 wait_ms/completion 参数**，保留了历史对照入口；不把该旧内部路径当作当前模型契约或已经完成最终实现清理。
4. 原生自动通知重新进入 chat.message/chat.params。C 区分 queued、经共享准入的 consumed 与预算/停止后的 suppressed；首次 running 回覆另存且不改写。重复/迟到通知留痕、拒绝再次唤醒。父 idle 加 assistant 完成只是一项条件；有 starting/running execution、pending、queued 结果或非 settled 资源时不正常收尾。
5. 父从早期 task 引用、sibling 原生完成结果取得自然控制机会，再调用产品 task.stop。先撤销，后回收 HTTP/job，再分别记录 SDK abort 与资源确认/unknown；全局收尾复用已做过的 child stop，unknown 不重发 abort。完成先到则保留原任务终态；host revoke 仍撤销会话。原生取消不承诺额外完成通知，取消由有 executionRef 的 task.stop 回覆交代，不冒称成功。

没有新增 provider 循环、监工角色、通用调度器或独立完成通知器。SDK 只用于既有可信查询、root 启动与 C 内停止；探针的 onStarted 只订阅公开事件，不恢复或代父控制 child。

## 最终同候选 runtime 批次

`31-runtime-final.log` 退出 0。下表每行是独立、完整 launch；不拼成一次 run，也不借用探索批次的成功填补最终结果。原始 provider、events、messages、C audit、bindings、admissions、resources、execution 及保留输出都在 `runtime/final/<scenario>/`。

| 情境 | 结果与关键观察 | 替身请求/执行数 |
| --- | --- | --- |
| success | completed；job 6564ms 超过旧 5000ms 初始等待；父先取得可信引用并 idle，child 等待中无模型请求；原生完成自动唤醒父，初始 running 回覆未改写，结果 consumed | 7 / 1 |
| stop-job | completed；sibling 自然完成唤醒父，父 stop 尚在 job 等待的 child；取消资源985ms。孙进程在 stop 工具完成事件时已消失，早于全局收尾；stdout 保留 early；同一 sibling 随后再执行真实 job | 14 / 3 |
| stop-http | completed；父由 sibling 结果唤醒并 stop 在途 HTTP；socket 在撤销后关闭、资源 cancelled，随后 sibling 再执行真实 job | 14 / 3 |
| resume | completed；同 child session 两次执行，ref 不同，分别自动交回且各消费一次；原始 task 回覆各自不变 | 10 / 2 |
| active | completed；父第三次模型调用故意缓慢响应，child 通知在其活动期间到达；原生继续处理，下一轮收到 A_DONE，没有丢失唤醒 | 7 / 1 |
| budget | **预期 budget_exceeded**；child 结果保留，完成喚醒的第七次准入被共享账本拒绝；只有六次 provider 请求，没有父第四轮；结果 suppressed | 6 / 1 |

`verify-evidence.py` 独立核对上述原始文件，不依赖探针自报 pass：run/parent/child/role/challenge/call/ref 关联、首次输出相等、模型 job schema 不含双模式、通知消费、共享准入与请求数一致、等待中无 child 请求、idle 区间、先撤销再回收、SDK 不重复 abort、停止后 sibling 活动及源码稳定性。结果见 `verification.json`、`metrics.json` 和 `35-evidence-with-schema-check.log`（退出0）。

usage：替身报告 input/output/reasoning=0，原始 run 文件的 availability/lowerBound 原样保留；取消或预算停止可能不完整。这里的0仅是替身回报，不是实测真实模型消耗或模型能力。

## 定向边界与检查

| 判据 | 覆盖与结果 |
| --- | --- |
| 父先准入、延迟首绑、已知早期引用的首 hook 前 stop | 新 g-async-lifecycle 确定性；错误 child 拒绝且无模型活动。实际常规启动另有 runtime |
| 启动 error、unknown 保留、失败后迟到 child 不配到同角色新任务 | 新确定性事件/SDK stand-in；没有冒称 runtime 故障注入 |
| 重复/迟到通知、恢复世代、初始回覆不可改写、已完成 stop/host revoke | 新确定性；普通同 session 恢复有 runtime，重复原生通知没有强行注入 runtime |
| 结果 queued→准入、预算拒绝、stop 后通知不重启 | 新确定性及最终 budget runtime；结果/usage 保留 |
| 完成/stop 交错、重复 stop、外来/其他角色/到期拒绝 | 既有 g-coordinator-stop 与新增回归；正常自然 stop 有 runtime |
| HTTP/job/孙进程归属、sibling 继续、unknown 保额 | 最终 runtime 正常取消；unknown/DNS/落盘/探测故障主要为 slow-tools/http/job 的确定性注入，未全做 runtime 注入 |
| 最终定向 | 5文件 **86/86**，`27-directed-final.log`，退出0 |
| 类型/构建 | `28-typecheck-final.log`、`29-build-final.log`，均退出0 |
| 全套 | **41文件319/319**，`30-full-final.log`，退出0 |

完整命令、退出码、耗时见 `commands.jsonl`。本次没有从零重写既有边界测试；原 pending 清理的三项旧预期已更新为当前设计要求，保留并加强拒绝，不删除失败样例。

## 保存的失败与纠正

- `03-runtime-initial.log`：初始产品未传背景开关，实际 schema 无 background；该原始失败保留。`02-native-probe.log` 与 native/flag-{false,true}.json 证明实际公开开关可用，再接入产品原型。
- `04-red.log`：父下轮/after 提前释放 pending 的三个原始失败。`11-generation-red.log`、`15-early-stop-red.log`、`18-final-boundary-red.log`、`19-complete-stop-red.log`、`22-correlation-red.log`、`25-host-revoke-red.log` 保存后续具体边界的修正前失败；相应 green 与最终 suite 保留。
- `runtime/native-fixed/` 的 stop 失败是探针把 XML 引用误按旧 task_id 文本解析，未发出 stop；只修探针格式解析。`09-directed.log` 的新 SDK fixture 缺少 message.info 导致 usage unavailable，按真实公开形状补齐，没有降低准入要求。
- `20-directed-final.log`（历史命名，不是最终结果）：3项 launch 证据测试因把任意 SDK child busy 快照当作活动异步任务而等到 deadline。已改为可信 execution/pending/queued/resource 收束，原输入不改；`21-launch-regression.log` 12/12，以及最终全套通过。
- `32/33` 离线核对首次断言错误也保留：父在 job 登记前7ms已 idle，正确核对为区间开始前最新状态与区间内无 busy；active provider 记录时间是响应发出时间，实际请求开始以 C admission 核对。`34/35` 按原事件时间线通过，35另核对模型 job schema，不改原始证据。
- native-fixed/native-checked/tagged/prefinal 是探索/调试批次，不作最终同版本承诺；最终只采信 candidate hash 冻结后的 final。所有旧长 job、前台阻塞和 SDK时序限制仍在来源报告，未覆盖。

## 复现与交付

在本工作区执行；运行前已有依赖，不调用真实模型。**runtime label 使用新的唯一名称，避免覆盖原始证据。**

```sh
npx --no-install tsx tests/manual/g-joint-native-probe.ts
npx --no-install tsx tests/manual/g-joint-lifecycle.ts review-unique-label
npx --no-install vitest run tests/contract/g-async-lifecycle.test.ts tests/contract/control-service.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/slow-tools.test.ts tests/contract/launch-evidence.test.ts
npm run typecheck
npm run build
npm test
python3 docs/gates/g-solver-verification-20261023/joint-async-lifecycle/verify-evidence.py
```

第一条会重写 native 探测导出；独立复核可另存旧文件或先指定新的输出目录，避免覆盖。最后一条只重新派生 final 的离线核对，不启动模型/进程。

本次相对导入基线的增量：C、launcher、plugin、bridge server、control-service 原有预期、g-async-lifecycle 测试、两份 manual 探针，以及 G/C/总 design 和本证据目录。产品/测试精确列表与 patch 在 changed-files.json/joint.patch；导入的其它大 diff 属前置原型。

未验证/未交付：主区产品集成、真实模型选择/解题、OS与网络隔离、跨重启恢复、持久配额、D/oracle、10分钟实际等待、全部故障的 runtime 注入。此切片没有精确成本预留的新承诺，也没有把未知清理写成已清空。主 session 还需独立重跑必要判据、选择性同步文档与最小证据并处理计划归档；本 session 没有删除计划、归档自己或发其他 chat 消息。
