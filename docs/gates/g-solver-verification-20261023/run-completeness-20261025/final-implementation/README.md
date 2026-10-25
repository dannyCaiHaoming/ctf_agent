# 结果完整性与交接可见性：正式实施证据

2026-10-25。依据[详细 design §5–§6](../../../../superpowers/specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md)。GPT 6.1 Sol 在独立 worktree 实施，独立 review 无阻断，主会话按输入 hash 核对后仅应用 7 文件增量至主区；没有 commit 或 push。

- [实施报告](report.md)、[独立 review](review.md)：同步来源／错误生命周期、父事实展示、多通知消费及 Coordinator 条件澄清；失败与修复记录保留。
- [增量补丁](implementation.patch)、[接入记录](integration.json)：相对本轮 dirty 输入，不包含其他未提交工作。8000 配置未改。
- [主区检查](main-checks.json)：typecheck、build、全套 **49 文件／482 测试**通过，日志为 main-typecheck.log、main-build.log、main-test.log。独立区先前全套 481 项及后补双同步轮次 62 项的记录分别保留，不混算。
- [原生投影](verified-projections.json)：OpenCode 1.19.3，实际 launcher/plugin/control 与本地确定性 HTTP provider；后台 partial/empty 后同步 stop、纯同步 empty/partial、双通知加同步等待、HTTP400 failed 共六案。核对实际父请求、来源、每身份一次、原包络、消费及等待；完整六案没有在主区重跑，主区运行时代码与验收 hash 相同，主会话重放投影通过。
- [当前源码清单](source-hashes.json)与 [原生批次清单](native-source-hashes.json)：只差 review 后增加的测试文件；产品运行时代码与 Coordinator 未变。[隔离记录](isolation.json)含外连 EPERM；不使用真实模型或真实目标。

已有投影可运行 `python3 verify-projections.py` 核对（仅读本地 JSON 与源码，并重写相同摘要）。native-probe.ts/run-native.sh 是当次隔离执行材料，含历史路径；重跑需先准备独立 HOME、输出目录、相同版本及 OS loopback-only，不能直接对原始调试目录运行。临时 raw run 已清理，metadata 的 runDir 仅作历史定位。

结论仅覆盖工程链路和规则澄清。consumed 不是模型理解或网络 ACK；报告质量、恢复效果、Critic 实际调用、自然竞态、其他 adapter 与压缩均未宣称通过。已完成实作 plan 的结论转入 design/本目录后删除，不新增验证计划。
