# R2 独立只读评审

结论：候选A在固定 OpenCode 1.19.3、当前本地替身 adapter 的正常请求路径上可行，足以支持继续 R4 组合验证；不构成整份 design 定稿、产品实现完成或父展示验收。没有发现应阻断这项有限原型结论的新增缺陷。下列未决契约必须先在 design 说明，再决定最终实现与验收。

## 核对证据

已读 report.md、prototype.patch、source-hashes.json、minimal-evidence.json、hooks.jsonl、binary-hook-boundaries.json 和最终检查日志，核对工作区四个文件 hash 全部匹配；只读检查实际 admit 与 hasOutstandingWork。未运行模型、目标、HTTP 或额外集成样本，未读取敏感 raw。现有日志记录定向 52 测试、typecheck、build 通过，未以此替代全仓或父展示验收。

baseline/observed 父请求投影含两 notice 但只释放最后 messageID；剩余 queued 最终受 deadline 停止压为 suppressed。最终 batched 样本同一 admitNo=5 释放两个确切 notice/ref，实际父请求 notice 数为 2，completed/0。active 样本两个 admitNo=5/6 且父请求先1后2，支持第一 notice 消费后仍等待活跃 child；其源码早于最终防护，只可作为机制样本，不能声称最终源码同批 active 已验证。

## 信任与消费正确性

transform 输入身份来自宿主消息 info.sessionID；synthetic、文本匹配仅筛候选，不是授权事实。可信消费仍要求认证 control 通道、当前绑定/agent 准入、同 parent、host registry 的 noticeMessageID 和 queued 状态。普通、伪造文本、错父或不存在 ID 本身不能制造 host 接受 notice 的事实。此边界依赖 plugin/hook 为可信宿主链；不得把 requestMessageIDs 暴露为模型自行申报的可消费凭据。

每 session 快照、最后 userID 与 params.message.id 匹配、取出先删除，比全局最后 transform 安全。新快照覆盖旧快照；空输入清空；混合 session 清除其涉及 session；ignored Part 不列候选；重复消费在 host 因 queued 判定幂等。准入前预算/stop/live 检查保留，active/pending/resource 检查未被移除，因此正常 batched 释放未引入已证实的活跃任务早退。

快照丢弃或参数不匹配会保留 queued，而非直接丢掉 notice；这是保守阻止收束，但如后续不再带该消息，仍可能残留直到 deadline。当前匹配只识别 session 与最后 userID，不能证明与某次 transform 一一关联；同 session 同 user 的重复/compaction transform 可覆盖，另一插件或 adapter 后置裁剪也可使已消费 ID 不再实际可见。不能把分支测试描述为这些自然交错都已排除。

## 阻断与非阻断

- 非阻断：有限原型可行性；同批两 notice 和 active 机制已有有用实测，正常路径修复有直接证据，不需追加通用调度、网络 ACK 或模型重叫循环。
- 整份设计定稿前阻断：先明确 consumed 的契约。当前实现只证明“可信 hook 观察到该 notice，且对应父/当前 user 的调用获 host 准入”。它不是 wire ACK，也不保证 provider 成功收到、模型理解或最终展示。admit 后 provider/传输失败同样可留下 consumed；若最终需求要求实际可见或展示成功，不能以本生命周期重命名消除差距。
- R4/设计范围未决：未实际触发 compaction。binary 证据显示 compaction 使用 head 子集经同名 hook 后转摘要，而普通路径也有后置 toModelMessagesEffect。compaction agent 现有准入拒绝是有意义的防护，但不等于已验证完整自然交错。必须验证一个临界样本或明确窄化支持范围，并保留 wire 保证不足的限制。
- 产品接入前非阻断清理：固定审计路径 appendFileSync 是原型观测且可能改变时序，最终产品不应保留；无需本轮接入。

## R4 最小组合范围

1. 使用同一最终源码集合组合父展示与 R2：父的同一次实际本地 provider 请求包含两条 notice，各自唯一 host 事实与 ref/角色/完整性导出一致；两个 queued 在同一 admitNo 消费，正常收束。只计数 notice 不足以证明父展示事实。
2. 同源码运行一个 child 尚 active 的样本：第一结果可见后保留 outstanding，第二结果到达后才收束。若组合 R3，仅额外核对同步结果不串旧后台 ref。
3. 实际触发一次 compaction 临界场景，保存最小白名单投影核对 snapshot 替换/拒绝及 notice 的去向。只要 hook 仍非最终 wire 集合，设计应分开生命周期契约与已测 adapter 可见性，不作普适保证。
4. 复用现有重复、stop、预算证据；若组合改变这些路径，仅针对改变部分回归。无需真实模型理解证明，不新增通用队列或 ACK 框架。

本轮仅评审；应先完成整份 design 的验证与结论回写定稿，再生成全实现 plan。未接入产品、未修改主区、未 commit/push。
