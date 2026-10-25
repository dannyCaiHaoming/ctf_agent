# 子任务后台关联独立复核

审查对象：隔离工作区 `child-result-validation/pentest-agent`，仅以本审计目录 `fix.patch` 相对实际 dirty 输入 baseline 的增量为范围；未用 git diff HEAD 归入旧工作。读取 AGENTS.md、CLAUDE.md、实施 plan §0 和详细 design §9。未修改产品、主区或测试，未运行真实模型、目标或原生 probe，未 commit/push。

## 规格 verdict：通过

没有发现本切片的阻断缺陷。核对了：

- control-service.ts:921–938 在验证 binding 后的串行边界选择未 delivered 的活动 child execution；parent/role 矛盾、多个候选、不同 user ID 进入持久 conflict，相同 ID 幂等。同步恢复没有活动记录时不认领旧 ref；不依赖旧 binding.dispatchCallID。
- control-service.ts:940–980 先依 ref/parent/child 校验包络，先标记 delivered 再读取 SDK，重复通知不能再次读取；SDK 等待在 serial 外，返回重新核对 execution、source 与 child 停止状态。stop/revoke 路径不会让本次待处理 hook 唤醒父会话。原包络、天然终态和 delivered 意义未改作完整性。
- child-result.ts 按冻结 user ID 和 assistant.parentID 分类；对所选 ID 扩查全部同 ID 记录，跨 parent/role/session 矛盾不能隐藏在过滤外；完全重复可幂等，多个 assistant 或矛盾记录保持 unknown。仅保存 finish、ID、时间、字符数及布尔事实，不复制 SDK text/reasoning/error payload。既有原通知包络保留属于明确契约，不应误称全 execution 导出没有正文。
- length、空白 stop、error、未完成、未知 finish、缺来源及 SDK 缺失/错误具有独立分类；正常 completed stop 且非空 text 无 error 才 complete，未改 solved 标准。

## 质量 verdict：通过

改动限制在三个允许文件，新辅助文件是小型纯元数据分类器；没有引入框架、轮询、补叫模型、同步记录、父展示或 Root 修改。snapshot 深拷贝避免新增嵌套元数据被调用者修改。现有测试增量涵盖原始 partial/empty length、同 child 两轮、持久来源冲突、同 ID 跨身份冲突、SDK 缺失/故障、重复与旧通知、同步不认领、stop/revoke 与延迟 SDK 竞争。未发现需要阻断接入的质量问题。

本次独立审查未重跑全套测试；核对 test-final.log 为 49 文件 / 456 项通过，并核对已有 typecheck/build 完成记录。运行证据由执行方产生，不将读取日志表述为独立重跑。

## 原生接线证据核对

审查时 native.log 与两组 metadata.json 已生成，执行方总 report.md 尚未出现。核对了脱敏元数据而未读取原始 reasoning：

| 组别 | 首轮 | 第二轮 | 共同事实 |
| --- | --- | --- | --- |
| partial | length、completed=true、textChars=7、incomplete | stop、completed=true、textChars=8、complete | code0/status completed；同 child，两个不同 ref/callID/userID/assistantID，均 delivered/consumed |
| empty | length、completed=true、textChars=0、incomplete | stop、completed=true、textChars=8、complete | code0/status completed；同 child，两个不同 ref/callID/userID/assistantID，均 delivered/consumed |

两组 task.source → task.completion → task.result 审计链均存在，resume 后首轮 source/resultFacts 保留，第二轮未覆盖首轮。native-probe.ts 的投影直接读取产品 evidence/task-executions.json，并移除既有 result/initialOutput/lateResult 后导出事实；不是外部候选替代生产分类器。

限制：此处原生证据只证明本地确定性 provider 的两轮产品接线；不证明真实模型能力、自然 SDK 故障、自然通知竞争或父上下文展示。停止/revoke/冲突分支仍属可控离线测试证据。隔离配置、输入 hash 与执行方总报告由主会话收口时继续核对，本审查不扩展其证明层级。

补充核对：已读取 native-verification.json，逐项核对其 execution 与 metadata.json 相同、assistant.parentID/sessionID 对应冻结 source/child，finish/completed/textChars/hasError 一致。独立计算 manifest 内六个产品源码 SHA256、probe SHA256 与输入清单 SHA256，均与当前审查代码及文件一致。manifest 标记 observer=false，runtimeVersion=1.19.3；未独立重启运行或重验二进制。

## 后续两项测试补充复核

只读查看隔离 g-async-lifecycle.test.ts 相对主区的差异，聚焦新增最后两条测试，未扩大生产 review 或运行原生。规格与质量 verdict 继续通过，无新增阻断。

- pending SDK 重复通知测试用可控 promise 确保首个通知停在 SDK 等待中，再发送不同 notice messageID 的同 ref 通知；断言 duplicate completion、SDK reads=1，释放后 task.result 审计仅一条，直接覆盖“未完成读取期间重复通知”的真实竞争窗口。
- 错 parent/child 测试分别使用不匹配 caller parent 与篡改包络 child，断言 completion correlation、SDK reads=0、execution 仍 running，覆盖拒绝发生在读取及生命周期修改之前。

核对时 test-final.log 仍显示 10:56:36 的 49 文件 / 456 项；新增两项后的 458 全套结果尚不能从该文件确认，已回报主会话。此差异只影响最新测试结果证据，不改变两条测试代码的审查结论。

最终证据更新：已读取主区 main-test.log 尾部，确认新鲜全套为 49 文件 / 458 项通过；主会话另确认执行退出码为 0。本复核读取执行日志而未独立重跑。此前 456 项为旧 test-final.log，现以 main-test.log 的 458 项作为集成测试证据；新增两条测试的审查结论继续通过。
