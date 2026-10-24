# 子任务结果关联无模型验证

## 结论

公开 SDK 能读取同一个 child 的两轮 user/assistant 消息、assistant.parentID、finish、time 和 text 长度，因此能够保留和区分先前 length 与后来 stop 的事实；但本轮**没有证明 execution(callID/ref) → child user message ID 的公开、无歧义直接关联**。现有完成包络和 task metadata 不含 source message ID。仅凭 child 最新消息不可定稿实现，缺少冻结关联时应为 unknown。

生产代码未改；未调用真实模型、真实目标、部署或提交。固定 OpenCode 1.19.3；SDK 包声明 1.19.0。探针为临时脚本，不是产品 fixture/gate。

## 隔离与版本

- 显式工作区 `/Users/caihaoming/.codex/worktrees/child-result-validation/pentest-agent`。HEAD `cfa950fd7129203f21baceeab399ed9cf675a1c7`，继承了主区未提交快照，不能只凭 HEAD 复原。
- OpenCode binary SHA256 `6d3e6458fce4b649edf974c19959d5dbfe1e7f255a503dcfc01215b24ad3ea5b`。
- control-service.ts SHA256 `53518b3addf816488444e2577abbe303b1ba20c2127d850caa98e1a54dd3dc99`；plugin index.ts `616f9dbcd1848b42e73f31ae9aaff1e80189d9588b82b6454f7c7c70c123097f`。
- 最终使用同批 root 验证的 isolation.sb 复制为 network.sb：deny network-outbound，仅 remote localhost:* 例外；同时拒绝用户 config、local/share 和 Codex auth 文件读取。启动前独立测试 `net.connect(1.1.1.1:443)` 得 `EPERM` / exit 0。
- OpenCode 通过 spawn 显式 env allowlist，未继承 process.env，HOME/XDG 指向每次新建的空目录，唯一 provider 为 localhost 随机端口的确定性 HTTP 服务，apiKey 是固定无权限 `local-only`。环境键名保存在证据，未读取真实凭据。
- 初始自写 profile deny network* 导致 localhost listen 不工作；增加 local network* 后外联检查没有证明拒绝，立即停止该尝试并核对无遗留进程。该尝试不计隔离或 runtime 通过。之后使用上述已经复核的 profile 才计正式覆盖。

## 可复现命令

在报告目录执行（路径保持当前机器）：

```sh
/usr/bin/sandbox-exec -f "$PWD/network.sb" /opt/homebrew/bin/node "$PWD/probe.mjs"
/usr/bin/sandbox-exec -f "$PWD/network.sb" /opt/homebrew/bin/node "$PWD/probe.mjs" empty
```

第一条给 child 部分 text + length，第二条给 child 空 text + length。provider 只返回固定文本/原生 task 调用；root 接收到原生完成通知后通过 task_id 恢复同 child 一次并得到 stop。每次创建独立 clean-时间目录；结束终止 OpenCode 和本地 provider。runtime.json 会覆盖，正式两组分别保存为 partial-sdk-runtime.json、empty-sdk-runtime.json。探针仅持久化消息元数据、text 长度、固定 synthetic notice 和 task tool 状态，不保存 reasoning。

## 原生 runtime / 公开 SDK 证据

- 两组都真实启动 OpenCode 1.19.3 原生 background task；通过 SDK `createOpencodeClient(...).session.messages({path:{id}})` 读取消息，未用 SDK 替身伪造它们。
- partial 组：第一轮 child assistant finish=length，text 长度13；同 child 第二轮 finish=stop，text 长度15。原生第一条 notice 的 task_result 是 PARTIAL_FIRST，第二条是 SECOND_COMPLETE。没有完整结果丢失证据。
- empty 组：第一轮 child assistant finish=length，无 text part；原生 notice state=completed，task_result 为空。恢复同 child 后第二轮 finish=stop，text 长度15。说明 native completed 不等于报告完整。
- child 两条 assistant.parentID 各自对应不同 child user message。原生 task tool call 有不同 callID；metadata 仅 parentSessionId/sessionId/model/background/jobId/truncated，其中 jobId 等于 childID。notice 文本含 childID、description 和 result，未提供 source message ID、callID 或 execution ref；产品通过 description 中 [ctf:ref] 关联自己保存的 execution，但这不增加 source message ID。
- SDK 可以按具体消息 ID 补取（公开 session.message 声明存在）；目前产品并未固化该消息 ID，不能把“可读取”当作“已经知道应读取谁”。
- 此脚本使用 200ms 观察间隔，第一轮 notice、后续恢复可能发生于一次观察间隔内。它证明最终可见的消息保留两轮事实，**不证明通知到达瞬间 SDK 已可见或原子一致**。没有实时插件 hook 快照，本轮不得宣称 notice→SDK 先后顺序已覆盖。

## 既有 ControlService + SDK 替身层

命令：`node_modules/.bin/vitest run tests/contract/g-team-integration.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/g-async-lifecycle.test.ts`。

结果：3 files / 26 tests passed，5.89s。该层覆盖既有 dispatch/resume、重复 notice 拒绝、停止后的通知抑制、并发停止幂等、停止失败 unknown 等。它使用伪造事件或 SDK 替身，**不证明 OpenCode 自然产生重复通知、停止竞争、暂缺消息或延迟读可见性**。未为了这些情况修改产品、增加新 gate 或伪造 runtime 证据。

## 实现边界与最小候选

1. 现有 registerDispatch / toolAfter 可信绑定 parent/call/ref/child；receiveCompletion 保留 noticeMessageID、原包络且拒绝重复，但缺 child source message ID/执行消息范围。
2. 若未来在派发前后冻结 child 消息游标，并在唯一活动 execution、可信 child user 绑定和有界范围内冻结对应 assistant ID，可以作为最小候选；本轮没有实现或证明该策略在缺消息、并发写入/恢复、通知延迟下无歧义。不能仅用时间接近、顺序或正文相同就认定可靠。
3. 对缺失/多个候选/未知 finish 保持 unknown；length 即使有 text 也不能为完整。不能拿后续 stop 覆盖前一轮 length。补齐只读取已存在消息，不主动恢复、唤醒或调用模型；停止后继续遵守现有抑制与幂等边界。
4. 当前案例是原始未产出/部分产出，不满足新增 result-ref 工具的前提。

## 失败与未覆盖

早期 probe 将无 tools 的标题生成请求计入 root 步骤，导致未派发；修正临时脚本分类后完成正式两组。保留 attempt-title-classification.json，仅作探针失败记录。SDK 版前还做过 REST 版探索，两者分文件，结论优先引用 SDK 版。

没有证明模型会利用完整性信息；没有真实解题/solved 验收；没有覆盖自然 runtime 的重复通知、停止并发、SDK 暂缺消息/延迟；没有证明 call/ref 到 child user 的确定性关联；没有运行全仓 typecheck/build/test（未改产品）。工作区保留。

最终证据 SHA256：

- probe.mjs `4f5fa8c1f5e8b7a2bdfc65967cf077533a9fdf74e5e543b5119ba0d3e1d38937`
- network.sb `31284bc9c62abebd7586676ab8436734d1ca777466d9f5209f596ba9ed80ed74`
- partial-sdk-runtime.json `8fd0d5a46bc303ee1921636ab9c243b9f342b47b726e5283f3c2021f5737959f`
- empty-sdk-runtime.json `81984a6eb1730c2ea0fa83940c39c54aba6166dc73914b3a32acea5e68c2f7c8`
- minimal-evidence.json `04a318d37a77a48cdc65344c49f42e03dbb29bc39b1ae35f6cf57550514da12e`

最终进程核对：`pgrep -fl 'child/probe.mjs|opencode serve'` 无匹配（exit 1）。empty 组在第二条完成 notice 可见后结束观察；此时 root 新一轮 assistant 可能尚未完成，因此不评价 root 收束。
