# 独立只读复核

结论：合规通过；证据足以定稿候选 A 的最小可行范围，无阻断性问题。此结论限于固定 OpenCode 1.19.3、无模型单 child 两轮展示与分层负例，不是产品接入或模型语义验收。

## 合规

按审计 baseline 和 input-hashes 核对，baseline 文件无 hash 不符；当前相对输入仅 control-service.ts、plugin index.ts、g-async-lifecycle.test.ts 三文件变化，均在授权原型范围。source-hashes 与当前三文件一致。审阅 prototype.patch，不使用 git diff HEAD；没有新增 prompt、SDK 轮询、工具、角色或自行调度。探针只投影本地 provider 请求相关文本；隔离记录外连 EPERM，配置为虚构密钥、本地确定性应答。本次 review 未运行模型、原生样例或目标，也未修改产品或主区。未独立追溯全部历史工具记录，因此未把 report 对“无 commit/push”的自述当作额外运行证明。

## 证据质量

1. provider 处理器直接从实际 body.messages 投影 host text，证据不止 audit/messageID。三组 metadata 和 verified-projections 能对照原 notice、持久化 Part 的 id/sessionID/messageID、execution source/resultFacts；同 child 两轮不同 ref/user，旧轮未覆盖。partial/empty 第一轮分别 incomplete/length/7 与 incomplete/length/0，第二轮 complete/stop/8。每通知父消息只有一份事实，后续历史携带未误算新注入。
2. host 只返回 receiveCompletion 本次接受的 ref，serial 内复核父、notice 身份、queued 和 child 有效性；普通消息复用旧 messageID 不会读取历史。unknown 显示 textChars=null，不能把底层 unknown 默认0解释成空报告。plugin 完整 typed synthetic Part 的修正是必要可行性条件；初版缺身份导致保存拒绝和 deadline 已保留，不隐去失败。
3. 正常两案各7请求/2 child调用，与既有 child-implementation/single-partial 和 single-empty 的 metadata 计数相同。实际顺序可见初发前无事实、首 notice 后一份、第二 notice 后两份。没有新调用入口的源码证据与正常计数一致；不是对所有时序“零额外调用”的证明。
4. 原生 unknown 是 other finish 触发 OpenCode 额外 child stop 后得到 multiple_assistants：8请求/3 child调用/2 execution。report 已准确区分此结果，不能写成原生 unknown_finish 或展示机制新增唤醒。该样本证明真实 unknown 投影到父请求；SDK error/missing、source conflict 仅确定性替身证据，没有声称 HTTP 故障。
5. 日志支持定向59测试、增补后45测试、最终typecheck/build通过；59测试在首版原型上运行，report 已纠正为非 clean baseline。SDK等待stop/revoke、重复通知、错parent/child等既有反例沿用拒绝；本次没有补跑自然竞争或原生负例，也不据离线测试声称它们已原生验收。

## 保留限制与最小收口

无需额外原生样例。可在 design 中定稿 host 白名单回传及 plugin 同消息追加完整 Part；保留模型理解、Critic、并发收束、同步恢复和自然 race 未验证。最终serial返回到plugin保存之间仍有既有分布式窗口，不宣称原子停止保证。before-fix源码为最终版本去除身份字段重建，report明确披露，不能称即时失败快照。正式实施仍应另按定稿design执行；本轮仅恢复隔离产品文件到输入，并保存审计证据。

## 补验复核

新增 baseline-directed.log/exit 支持真实输入 baseline 的三文件59测试通过、退出0；final-directed.log 支持最终原型的相同三文件63测试通过。原先“59不是clean baseline、最终typed Part后未重跑整组”的证据缺口已由该补验补齐，不涉及新原生运行或扩大验证范围。另按字符核对，源码字符串采用单个反斜杠+n转义，实际provider投影含LF；report“下一行”准确。
