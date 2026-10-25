# Root 结果完整性无模型验证

后续状态：本文是首次接线探针，关于“历史 8000 来源未明”的检索边界已由 [Critic 报告的追加复核](../critic/report.md)更新：历史配置 hash 匹配 output=8000，原 HTTP 请求参数仍未留存。原探针结果不改写。

结论：在固定 OpenCode 1.19.3、强制仅 loopback 外连、纯本地确定性 provider 下复现原始类别：空 length 和部分文字 length 都返回 code=0/status=completed/stopReason=completed。正常 stop 的 unsolved 文字同样 completed，说明生命周期和报告完整性需要分开记录。当前观察没有证明 output 上限接线缺陷。

## 环境、隔离与版本

工作目录：`/Users/caihaoming/.codex/worktrees/run-completeness-validation/pentest-agent`。仅新增临时 probe 与测试副本；生产源码关键文件 SHA256 与主会话 snapshot 一致，见 source-hashes.json。node_modules 复用既有安装，未安装依赖。启动器实际校验和四份 run.json 都为 OpenCode 1.19.3。SDK stand-in 标记 fake-sdk-1，与真实 runtime 分开。

真实 runtime 的整个 Node 父进程与所有 OpenCode 后代均在 `sandbox-exec -f isolation.sb` 中：拒绝 network-outbound，仅允许 localhost:*。在创建 provider/启动 OpenCode 之前，实际连接 1.1.1.1:443 返回 EPERM，断言通过；之后 loopback provider 四例请求均成功。环境由 env -i 从零构造，仅显式传入 PATH、全新 HOME、TMPDIR；macOS 自动添加 __CF_USER_TEXT_ENCODING；isolation.json 保存启动环境键名。仅 stub provider 在 enabled_providers 中，apiKey 为本地虚构字符串，通过 OFFLINE_STUB_KEY 传入。managed launcher 覆盖所有 HOME/XDG 路径，禁止 project/default plugin/external skill/model fetch/autoupdate/LSP download/autocompact，离线包复用。额外 OS 拒绝读取原用户 .config、.local/share、.codex/auth.json。没有运行目标、读取 oracle、真实模型或真实凭据，没有联网搜索，没有输出 reasoning。

这是对本次受控进程的网络/配置隔离，不声称完整同 UID 文件隔离或产品 Solver 安全隔离。预先 `opencode --version` 是独立只读版本命令；真实 probe 内再次由 managed launcher 固定检查版本。

## 命令与结果

1. 基线：`node_modules/.bin/vitest run tests/contract/launch-evidence.test.ts tests/contract/opencode.test.ts tests/contract/opencode-config.test.ts`：3 文件、24 tests passed，exit 0。未重跑全仓。
2. 版本：`/Users/caihaoming/.opencode/bin/opencode --version` → 1.19.3。
3. 隔离预检最初使用 `(remote ip "127.0.0.1:*")`，sandbox-exec 拒绝：`host must be * or localhost in network address`。更正为 `(remote ip "localhost:*")` 后 true 命令 exit 0。这是 profile 语法失败，发生在任何 runtime/provider 启动前。
4. 真实探针：

```sh
/usr/bin/env -i PATH=/opt/homebrew/bin:/usr/bin:/bin HOME=/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-readiness-validation-5wp4ld7h/root/clean-home TMPDIR=/tmp /usr/bin/sandbox-exec -f /var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-readiness-validation-5wp4ld7h/root/isolation.sb /opt/homebrew/Cellar/node/26.3.0/bin/node --import tsx root-offline-probe.ts
```

exit 0，stdout/stderr 分别保留 runtime-stdout.json/runtime-stderr.txt；摘要 runtime-summary.json。每例最长 15 秒，最多3次准入；实际每例仅1次本地请求，无追加 prompt，无模型恢复。

| case | model output limit | admission maxOutputTokens | 捕获的请求 max_tokens | finish/text | 实际 code/status |
|---|---:|---:|---:|---|---|
| empty-length |64|1000|64|length / 无 text|0 / completed|
| partial-length |64|1000|64|length / PARTIAL REPORT|0 / completed|
| normal-stop |64|1000|64|stop / UNSOLVED; no candidate found|0 / completed|
| budget-smaller |2048|512|512|stop / UNSOLVED|0 / completed|

四例 stopReason=completed；publications/verification-results/completion-results 全部 []。真实请求没有 max_completion_tokens 字段，而是 max_tokens；stream=true。此为实际 HTTP body 捕获，不是静态配置推断。当前适配器/版本/首次调用中请求上限=min(model limit, admission)。未验证其他 provider adapter、模型 options 覆盖、后续调用预算变化或原真实 provider 的实际参数；不能推断历史 run 的8000是哪层事实。

5. SDK stand-in：`node_modules/.bin/vitest run tests/contract/root-offline-standin.test.ts`：5 tests passed，exit 0，见 standin-output.txt。

| case | 实际结果 | 证明层次 |
|---|---|---|
| 更早完成、最新 assistant 未完成 |0/completed|旧 any-completed 条件会过早收束；仅 SDK 替身|
| pending 原生 task 尚无绑定交付 |1/deadline_exceeded|未完成派发阻止 completed；仅 SDK 替身|
| assistant 没有 completed 时间 |1/deadline_exceeded|缺元数据不被视为 done；仅 SDK 替身|
| root info.error=APIError |1/failed，stopReason仍completed|最终导出时 error 改生命周期；仅 SDK 替身|
| 已完成但缺 finish |0/completed|未知 finish 当前未区别；仅 SDK 替身|

stand-in 每例记录1次假准入，没有任何 provider 请求；此数不等于真实模型调用。pending case 是未绑定派发，不代表所有活跃 native background task 的完整时序覆盖。现有 hasOutstandingWork 忽略传入 status，依赖 executions/pending/resources；真实活跃子任务时序仍 unknown。

## 消费者与最小契约建议

已追踪 apps/launcher/src/launch.ts：CLI入口输出 {code,status,runDir}，process.exitCode=result.code；只有 completed 映射0。state/run.json 保存生命周期、rootSessionId、sessions、预算、stopReason、timeline，但未保存报告完整性。消息 export 是独立 evidence/messages-ID.json。apps/cli/src/main.ts 目前仅 resume，不消费此 launcher run.json；resume 的 code 契约来自另一个 checkpoint 流程，不能联动修改。源码 apps 范围搜索未发现其他 run.json 读取消费者；外部脚本、用户集成未证明不存在。

ProgressLedger.finalize 在清理后以 status 生成 progress.md，事件另存 progress.jsonl；progress.md 的 Run摘要只展示 Status/Model/预算usage，正常 completed 时仅将 shutdown abort 归类展示。此修复应保留。当前调用在 run.json 之前，建议同一 host 计算结果传给这两个消费者，避免各自推断。

最小设计决策建议（未实施）：

- state/run.json 增加 rootResult 元数据对象，并将相同对象传给 progress 最终摘要；包含 messageID、finish、hasText/textChars、error 是否存在、completeness=complete/incomplete/unknown 与 reason。消息正文继续放现有 evidence 文件，避免重复。
- 绑定本次 root prompt 的消息范围；按可信消息时间及身份取最新对应 assistant（不按历史任意 completed，也不按完成时间回退到旧消息）。若 SDK 顺序/关联不足，记 unknown；最新未完成不能回退旧完整结果。pending/resources/executions 继续阻止生命周期 completed。
- finish=length 一律 incomplete，部分 text 只说明存在部分报告；stop+completed+非空 text 且无error说明报告存在，不说明其正确或 solved。缺finish/缺消息/不可关联为unknown；error保留原生命周期失败路径。host 摘要只列事实、可信产物状态和证据引用，不代写解题判断。
- 保持原退出码生命周期契约：completed 仍0，真实错误/预算/deadline仍1，通过显式完整性字段区分交付。当前未找到必须破坏CLI契约的消费者依据；若产品要求完整报告作为CLI成功标准，另需明确对外契约，不能暗改。
- 不自动补叫模型、不续跑、不提升 output limit。本次没有生产修改建议必须涉及 provider/SDK：两种限额关系均按预期。

## 复现、证据与限制

root-offline-probe.ts、root-offline-standin.test.ts 的精确副本在本报告目录。前者放回隔离 worktree 根，后者放 tests/contract/ 下可用上述命令复现；输出目录必须换新路径，因为 launcher 拒绝覆写现有 run。四个 case 子目录保留本地确定性 run 数据以供主会话核对；provider仅记录非敏感请求参数，摘要仅导出 assistant text 与元数据。源码从未访问原始run或oracle。

固定 runtime 四例是接线/状态判定验证；5例替身仅证明launcher分支。未实现修复；未验证模型能力、最终报告语义质量、真实子任务时序、历史 provider 8000具体来源、Critic、题目readiness或solved。未commit/push，未删除worktree，未创建产品fixture/gate/framework。基线与五例替身各运行一次；所有启动的server使用finally关闭，OpenCode由launcher管理关闭，未留下本探针进程。
