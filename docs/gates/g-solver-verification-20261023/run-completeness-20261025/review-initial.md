# 独立只读复核

范围：三份 2026-10-25 plan、对应详细 design、授权白名单报告/摘要/临时脚本，以及 launch、progressDigest、Coordinator 资产、managed runtime 环境配置的必要源码。未重跑探针或测试，未读取原始运行消息、完整配置、私有 oracle 或 reasoning；未评审尚在执行的 native 关联探针。

## Verdict 1：计划合规

通过，附执行证明范围限制。材料显示只做无模型验证、保存轨迹分析与最小范围建议，没有产品修复、真实目标启动或模型续跑。Root 探针四例有界、使用本地确定性 provider；isolation.sb 在进程继承边界拒绝非 localhost 外连，探针在启动 provider/runtime 前断言外连返回 EPERM，managed runtime 覆盖 HOME/XDG、禁用更新与外部配置加载。隔离只能支持该受控进程网络/配置边界，报告没有扩大为完整文件或 Solver 安全隔离。

readiness 报告明确披露读取 README 时见到 Solution 外链标题的范围偏差；未访问正文或答案的声明在本次白名单复核下无法再独立证明，应保留披露。报告没有用该材料支持 ready 或攻击不可行的结论。

## Verdict 2：证据质量

通过，无阻断性问题。

- Root runtime-summary 与探针一致：空 length、部分 text length 在固定 1.19.3 中均为 code=0/completed，正常 unsolved stop 也 completed；四例可信结果均为空。这复现状态判定的原始失败类别，不是历史运行逐字重放。实际请求分别为 max_tokens=64/64/64/512，足以支持这一个 adapter/版本/首次调用中的限额关系，不能确定原 provider 的历史 8000 来源。
- 五个 SDK 替身分支与 runtime 结果明确分层；尤其 pending 是未绑定派发，没有冒充所有真实活跃子任务时序覆盖。最新未完但历史完成导致收束与 launch.ts 当前 some(completed) 条件一致。
- readiness 的离线结果仅证明当前 TCP/严格字段契约。所谓 instance-change 用同样输入重调，没有实际改变实例，报告对此明确；有效绑定没有现成真实凭据，仍列 unknown。没有将候选 required/evidence 字段的拒绝误写为 readiness 已实现。A/B 暂不选择及最小影响范围适当。
- Critic 证据区分权限、曾读取、信息存在与模型遵循；通知存在仅支持父上下文可见，不支持已消费。没有 progress.read 或 Critic dispatch 的保存记录摘要，不能证明接口故障。将 B 限于交接完整性事实、暂不增加调度或提示词，符合现有证据。

## 已修正的文字

Critic 报告原先对 digest 规则与触发阈值的描述已由主会话修正，本复核再次只读确认：按 digest 分组规则检验 Coordinator 的 >=3 触发阈值，未发现满足者；digest 本身从 count>=2 开始返回，不能据脚本输出断言 repeated 列表为空。现有报告已准确区分两者，无待修正项。

## 复核限制

白名单摘要不是完整独立执行证据：测试 exit、源快照 hash 一致性、执行环境键、进程清理和 Docker 当前状态在本次以报告声明为依据，没有重算或重跑。未验证产品修复、真实模型行为、报告语义正确性、readiness 新契约、native 交接关联或 solved。建议回写设计时保留这些边界，并等待 native 子任务的单独结论后才定相关机制。
