# 独立规格、代码质量与最终整体 Review

结论：**通过；无阻断项，允许主会话仅接入本次 7 文件增量及自有证据。** 本结论覆盖已定工程机制，不代表真实模型报告质量、恢复效果、Critic 调度或 solved 已验证。Review 未修改产品、design 或主区既有内容，未跑真实模型、commit/push；仅写本报告。

审查对象为 `/Users/caihaoming/.codex/worktrees/result-completeness-implementation/pentest-agent`，逐文件与本 SDD 的 `input/` 对比，未以 Git 全部 dirty 认领本次改动。依据 task-1-brief、详细 design §4–§5 与 task-1-report。

## 规格与代码

- `apps/launcher/src/control-service.ts:519`：同步记录使用 parent/call，可信 dispatch 后登记；终态 before 拒绝、改参冲突持久、同 child 活动调用拒绝。`980` 附近逐 call 冻结来源，不复用旧后台 ref 或绑定首轮 call。
- `control-service.ts:953`：原生 error 只终结对应 sync call，并只删除相同 call 的 pending；重复旧 error 不清新 pending。`180` 附近 active/reading 同步记录参与 outstanding，避免通知消费后提前收束。
- `control-service.ts:1057`：同步 after 在锁外读取 SDK、锁内二次核对当前记录、停止、有效期、角色及来源；冲突/SDK 错误保持 unknown，重放不重复读取/展示。复用现有 child-result 分类，多个 assistant（含未完成者）、同 ID 矛盾不取最新。
- `control-service.ts:233`、`apps/opencode-plugin/src/index.ts:126`：后台仅展示本次接收且最终核对的 queued notice；TextPart 有 id/sessionID/messageID。同步事实追加原输出，metadata 保留，unknown textChars 为 null，未增加新唤醒或自动补叫。
- `index.ts:130`、`control-service.ts:493`：逐 session/current user 一次性快照取出即删除；空/混合/ignored/不匹配/拒绝后不复用。host 仅在准入成功后按同 parent、queued、真实 notice ID 集合逐 ref 消费；没有 messageID 回退或 SDK 全历史替代。
- `product/opencode/agents/coordinator.md:26`：仅明确阶段交回为评估时点、无 artifact 不等于无新信息、持续交接失败需评估 Critic；未增加自动调用、恢复次数规则或权限。产品 output=8000 的文件相对输入无变更。
- 两处既有测试 fixture 只补同步 tool.after 生命周期，原断言均保留。新增测试覆盖空 prepared 原始异常、active sync 阻收束、错误释放、await 竞态与唯一身份事实。

代码风格延续现有紧凑写法，可读性一般，但未发现需要阻断本次最小范围交付的正确性或维护性问题。未提出额外抽象或重构要求。

## 证据独立核对

证据目录：`docs/gates/g-solver-verification-20261023/run-completeness-20261025/final-implementation/`。

- 读取 typecheck/build/test 原始日志及 checks.json：三项 exit 0，全套为 49 文件、481 测试。没有把更早失败或新增单测混入该全套数字。
- 读取原生 probe 与运行脚本：实际 import 本实现区 launcher，公开 runtime、OpenCode 1.19.3、本地确定性 HTTP provider；env-i、独立 HOME/XDG、OS outbound 仅 localhost；每案先断言外网 EPERM。failed 由真实本地 HTTP 400 生成。
- 独立只读重放 verify-projections 的 JSON 断言，去掉写文件语句、改为与既有 verified-projections 比较；六案全部通过。核对实际父 HTTP 请求中的事实与原包络、ref/callID、role/source、finish/completeness/textChars、每身份唯一、noticeMessageID/admitNo。combined 两通知同轮消费、700ms 同步等待不提前发父请求。
- 当前 source-hashes 的 12 文件均与磁盘一致。native-source-hashes 与当前 manifest 唯一差异为新增回归的 `tests/contract/g-async-lifecycle.test.ts`；两个 runtime 和 Coordinator 完全一致，最终六案未借旧原型结果替代。
- 初次原生配置拒绝、旧空 prepared bug、首轮全套失败分别保存在 attempt 目录；不计入最终通过。

## Review 期间补足并闭合

最初缺少“同 child 连续两次同步正常完成”的直接断言；已反馈后补在 `tests/contract/g-async-lifecycle.test.ts:136`。已审阅：两轮使用不同 user/call/assistant，分别展示 4/13 字符，第一轮审计不被覆盖，旧 after 不再读取，无新增后台 execution。定向日志为 62 条通过，补后 typecheck 通过。产品源码不变，因此不要求重复六案或全套；这项覆盖备注已经闭合，无剩余修复要求。

## 接入与结论边界

只接入报告列明的 2 runtime、Coordinator、4 tests 和本次证据；plan 的准备期状态差异与主区其他 dirty 不属于产品补丁。主会话仍负责接入冲突核对、design/README 回补及 plan 删除；本 review 不宣称这些已完成。

未独立重跑全套或原生 runtime，仅读取日志并重放安全投影断言。无真实模型、自然竞态、全部 adapter、压缩或语义效果验证；consumed 仍只是获准上下文生命周期事实，不是网络 ACK 或模型理解。host 检查到 plugin 保存不是原子操作，维持已知边界，不扩展本次范围。
