# 2026-10-25 无模型验证最小证据

结论及实施边界以 [详细 design §4–§6](../../../superpowers/specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) 为准。本目录是既有 G 验证资料的追加证据，不是新增产品 gate。当前范围已收窄为结果关联、事实展示与通知消费；下列 readiness／压缩探索保留为历史证据，不是新增待办，也不表示原调试的报告质量与恢复决策已修复。

- root：固定 1.19.3 四例本地 provider 请求/finish 元数据，五例 SDK 替身与执行报告。
- readiness：当前 prepareRun 五种输入的实际接口行为、部署只读核对及来源hash。未证明 seed 就绪。
- child：纯 OpenCode 两轮 task + SDK 读取的最小投影，未加载产品 plugin／ControlService；无可靠 call/ref→child user 关联证明，不与替身测试拼接为产品联合验收。
- design-finalization/readiness-source：整体定稿前的准备来源核对及独立复核；用户确认尚无认可来源，不证明真实ready。
- design-finalization/throwback-readiness：后续固定上游及两次默认镜像准备核对，反证“空表即缺seed”；含独立复核、实际实例／重启观测及15项分层判据。当前结论以此及详细design§5.1为准。
- design-finalization/concurrent-delivery、synchronous-source：并发消费与同步归属的隔离候选、失败、源码hash及独立复核；不代表产品实作或联合验收。
- design-finalization/joint-display：六个最终运行源码样本、65项定向检查与独立复核；同步／后台事实到达实际父请求。compaction入口500未进入hook，仍未验证压缩内部边界。
- critic：原始R的只读工具/通知元数据统计，没有 prompt/body/reasoning 内容。
- source-snapshot-sha256.json：主区当前快照137文件的hash；不能只凭HEAD复原源码。
- manifest.json：证据文件hash；报告中的临时绝对路径是当次来源，不要求以后仍存在。

临时探针只是本轮观测程序，未接入产品或测试入口。复现时先按报告建立干净隔离工作区、同版本依赖及loopback-only策略，并把源码导入与输出根路径指向新的隔离位置；不可复用原始run目录。root需将probe放工作区根、stand-in放tests/contract；readiness的check导入指向当次worktree，重放需改为自己的副本；child probe依赖当次SDK路径，亦需替换为同版本安装。保存原始源码便于审计，不保证直接从本目录执行。

不保留完整配置、真实原始消息、reasoning或判官答案。失败尝试及未覆盖项见各report；较大的临时失败输出留本机审计目录。无真实模型调用；本地替身返回的usage不作为真实模型消耗，真实usage为not applicable。

## 原始调试 R 的定位

以下索引从详细 design 的原 §2 移入，仅调整保存位置，未重新运行或重判原始证据。

来源对话：`01a16d38-6063-7532-aeab-a9521de9d066`。原始run：`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261024-r2/runs/throwback-debug-20261024-r2-1`。OpenCode1.19.3，`volcano-coding/deepseek-v4-1-flash-261017`，基线`cfa950fd7129203f21baceeab399ed9cf675a1c7`且productDirty=true；104次准入，reported input/output/reasoning合计561088 tokens，历史预算5000000 observable tokens／30分钟。此处不构成新运行授权。

用于复核的消息对应：

| 角色 | child session | 完成通知前最后完成 assistant |
| --- | --- | --- |
| Recon | ses_e91976ffdffeBxuzwPMt40YQJk | msg_16e6af0d7001cdApelKFduOA3M |
| Solver | ses_e91937473ffe9rvyclpW6c0S7U | msg_16e6ebe03001u5Dl5BSjQTyfQu |
| Reference | ses_e918ecdcdffeaCUstMjllEBWkf | msg_16e71776d001oiO0SPQcW8tBeu |
| Strategy | ses_e918eb7b2ffelD8zc2YP0820Rn | msg_16e714866001XGNbhBwF5CakLd |

Root 最后消息：`msg_16e73fd29001eDvFWx4cx2qUKN`。只核对元数据和 text 是否存在，不读取或转存 reasoning 正文。

关键文件 SHA-256：

- `state/run.json`：`568713dc614183b4f3443abaf46e1757f765316c8155f794e2c52482a0ac4ba5`
- `evidence/task-executions.json`：`6a79713ab5517b8eed7ad75375de1b2747071a06ececf7752b974741af7dd2e9`
- `evidence/publications.json`、`verification-results.json`、`completion-results.json` 均为 `[]`，各为 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。

原始 run 留在仓库外，没有复制敏感运行材料。后续验证若需长期可移植证据，只保留脱敏的最小元数据到既有 docs/gates 位置，不复制凭据、私有答案或 reasoning。

追加只读复核见 [Critic 报告追加章节](critic/report.md)与 [元数据投影](critic/recheck.json)：确认 8000 配置来源，区分七次恢复的目的／结果，纠正只按重复参数阈值判断 Critic 的结论；没有新增验证 plan。

正式实施见 [final-implementation](final-implementation/README.md)：7 文件增量经独立 review 接入，六案确定性原生路径验收通过；同步来源、事实展示、通知消费与 Critic 条件澄清已落地，真实模型效果仍未验证。
