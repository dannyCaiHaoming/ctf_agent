# 后台 execution 来源关联实施结果

2026-10-25；按 `2026-10-25-child-background-correlation-implementation.md` §0 和详细 design §9 执行。结果：本切片已实现并通过确定性检查，以及固定 OpenCode 1.19.3 的产品原生单 child 两轮 partial/empty 验证。没有执行真实模型或目标；complete 只表示报告完整性，不表示正确或 solved。

## 输入与边界

- 独占工作区：`/Users/caihaoming/.codex/worktrees/child-result-validation/pentest-agent`。工作区 HEAD `cfa950fd7129203f21baceeab399ed9cf675a1c7`；实际输入是主会话复制并验证的最新 dirty 快照，以 `baseline/`、`input-hashes.json` 为准，不能用 HEAD 代替输入。
- 全部产品编辑只在该工作区。没有编辑主区、design、plan、角色、plugin、Skill、Root 或 progress 展示，也没有 commit/push、增加子 agent。
- 仅交付 `fix.patch`：相对 baseline 的两个已有文件和一个新文件。`change-manifest.json` 记录原/最终 SHA256；逐个核对所有输入 hash，仅 control-service 与 g-async-lifecycle 测试不同，新增 child-result。补丁已在 baseline 目录 `git apply --check` 退出 0。

## 精确改动及判断

1. `apps/launcher/src/control-service.ts`
   - Execution 独立保存 `source`（status/userMessageID/observedAt/reason）与 `resultFacts`（user/assistant ID、原始 finish、completed、textChars、hasError、completeness/reason/observedAt）。初始无事实为 null；unknown 的身份用 null。原始 state、delivered、notice 包络和现有交付语义保留。
   - 子 `chat.message` 先完成可信 binding，再在既有串行边界选唯一未 delivered 的 starting/running child execution，核 parent/role，冻结 user ID。resume 不读取旧 binding.dispatchCallID。相同 hook 幂等；多活动候选、不同 user、身份矛盾持久 conflict。同步恢复没有活动后台 execution，不新增记录或借旧 ref。
   - notice 仍先按既有 ref/parent/child 接收一次包络。随后锁外仅调用该 child 的公开 SDK messages 一次，按冻结 user ID 及 assistant.parentID 分类；提交时重新核关联、停止/撤销/过期。SDK 等待不挡 stop；停止或撤销后拒绝父 hook 放行，交付 suppressed。自然完成后的普通 task.stop 仍返回原 terminal，不被改成撤销。
   - 重复 notice 在读取前即拒绝，不二次读 SDK。SDK 缺失/失败保留 unknown，不轮询、重试或补叫。已有 snapshot 改为深拷贝，避免外部改写新增嵌套事实；`task.source` / `task.result` 审计也只保存独立元数据。
2. `apps/launcher/src/child-result.ts`
   - 小型元数据分类函数，不保存正文、reasoning 或 error payload。冻结 user 必须存在，唯一 assistant 按 parentID 关联；同 ID 先确定相关 ID，再在整个 SDK 结果中核对该 ID 的字段投影，防止另一条记录改变 parent/role/session 后被筛掉。完全相同重复幂等，矛盾重复 unknown。
   - error 不能 complete；未完成 unknown；已完成 length 为 incomplete；已完成 stop 且非空白 text、无 error 才 complete；空白 stop incomplete；未知 finish 或多候选 unknown。旧轮从不读取最新消息来补成 complete。
3. `tests/contract/g-async-lifecycle.test.ts`
   - 在原文件新增 28 项断言，覆盖 partial/empty、stop/error/未完成/未知 finish、同 child 两轮旧 callID、持续 source conflict、多活动候选/错身份、同 prompt 不同 child、SDK 缺失/错误、同 ID 相同及跨 parent/role/session 矛盾重复、缺 ID、同步不认领、snapshot 防改写、错 notice parent/child、重复 notice（含读取尚未结束）、stop/revoke 不被 SDK 锁阻塞且不放行父 hook。

## Red / green 与失败记录

- `baseline-tests.log`：原有三个文件 26/26 通过。
- `red.log`：第一批新增 20 项在原生产代码上失败，主要是没有 source/resultFacts；13 原有项通过。其中锁外 SDK 测试因旧实现根本未进入 SDK 读取而超时，并触发测试承诺预期的附带未处理错误。保留原始日志，不作为产品运行异常或真实 race 证据。
- `green-1.log`：接入后 3 文件 46/46 通过。
- `red-cross-identity.log`：3 个同 ID 跨 parent/role/session 反例失败，暴露先 filter 再去重的缺口。修为全 SDK 同 ID 回查；`green.log` 3 文件 51/51 通过。
- `red-revoke.log`：SDK 读取期间 revoke 子会话，原返回路径仍成功放行父 hook，新增测试正确失败。修为 suppressed 且拒绝放行；不改已完成执行状态。
- `typecheck.log`：初版 ChildMessage.time 只有 completed，与 SDK user time.created 弱类型不兼容。局部补充 created 可选类型；`typecheck-final.log` 退出 0。
- `targeted-final.log`：3 文件 52/52 通过（随后仅追加两条 notice 防护测试）。
- `build-final.log`：`npm run build` 退出 0。
- `test-final.log`：49 文件 456/456 通过；补两条 pending duplicate/错误 notice 身份断言后，`test-final-2.log` 最新全套 49 文件 **458/458 通过**。生产源码在这两次全套及原生批次间未变。
- `git diff --check` 退出 0。最后的全套也包含新增两项，不拼接不同测试批次冒充最终通过。
- 一次审计辅助 hash 检查误用 baseline 作为 cwd，断言“应有两项变化”失败，在任何写入/清理前停止；改为显式 worktree 绝对路径后核对通过。没有因此修改 baseline 或产品。

## 最终产品原生验证

`native-probe.ts` 复用前次已验证的单 child 本地脚本，但本次**无 observer、无 monkey patch、无额外 SDK 轮询**，直接运行最终产品 launcher/plugin/ControlService。只使用本机确定性 provider；固定 OpenCode 1.19.3，binary SHA256 `6d3e6458fce4b649edf974c19959d5dbfe1e7f255a503dcfc01215b24ad3ea5b`。执行前源码、probe、binary hash 记录在 `native-source-manifest.json`。

运行命令（工作目录为隔离 worktree）：

```bash
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin HOME=<审计目录>/home \
  /usr/bin/sandbox-exec -f <审计目录>/isolation.sb \
  /opt/homebrew/bin/node --import <隔离worktree>/node_modules/tsx/dist/loader.mjs \
  <审计目录>/native-probe.ts
```

空环境、隔离 HOME/XDG（产品 runtime）、OS loopback-only 策略；启动前外连检测为 EPERM，见 `isolation.json`。只传本地 fictional `OFFLINE_STUB_KEY`，无真实 provider 凭据。每组本地请求 7 次，child 调用 2 次；脚本 usage 响应为固定演示数字，不宣称为真实模型消耗。未调用真实模型，真实模型 usage 不适用。

| 样本 | 实际产品状态 | 首轮实际导出 | 第二轮实际导出 |
| --- | --- | --- | --- |
| single-partial | completed / code 0 | length / completed true / textChars 7 / incomplete | stop / completed true / textChars 8 / complete |
| single-empty | completed / code 0 | length / completed true / textChars 0 / incomplete | stop / completed true / textChars 8 / complete |

两组均为同一 child 恢复一次，各轮 ref/callID/userID 不同，assistant ID 不同；source associated，assistant.parentID 匹配对应冻结 user；原执行 state 均 completed、delivery 均 consumed。第一轮 task.result 审计与最终 snapshot 逐字段相同，未被第二轮 stop 覆盖。

这次直接读取的是产品导出的 `task-executions.json` source/resultFacts 与 `control-audit.json` task.source/task.result，而不是旧 Python 候选。另由程序只选取最终导出 child 消息的 ID、sessionID、parentID、finish、completed、textChars、hasError，与产品事实逐字段交叉核对，不向模型展示或保留正文/reasoning。结果在 `native-verification.json`，各组 `metadata.json` 保留执行与审计投影；导出消息原文件 hash 也保留。所有断言通过，`native.log` 记录正常退出。

## 清理、限制与交付

launcher 已关闭自己启动的 OpenCode 与本地 provider；随后核对无本 probe/provider/OpenCode 残留。主区另一个 npm test 进程的 cwd 已识别为主区，不触碰。只清理本审计目录下两个 `single-*/runs` 原始运行目录及自有 HOME，保留脱敏投影、输入/源码 hash、日志、probe 和工作区，精确列表见 `cleanup.json`。原始 runDir 历史路径因此不可再打开；审查依据是保留的投影和 hash。

本次证明的是后台来源关联与可审计完整性事实接线。SDK 延迟/失败、自然重复/停止 race 的确定性替身测试，不升级为真实 HTTP 故障或自然 race 证据；原生样本仅单 child 两轮。未扩展同步统一 execution、并发通知收束、父上下文展示、readiness 或真实解题能力。没有新 fixture/gate 程序、工具/result-ref、框架、provider 循环或 OpenCode fork。

交付：`fix.patch`、`change-manifest.json`、本报告、各 red/green/全套日志、`native-source-manifest.json`、`native-verification.json`、两组 `metadata.json`、隔离与清理记录。主会话负责独立复核、接入及文档收口；本执行会话不修改主区。
