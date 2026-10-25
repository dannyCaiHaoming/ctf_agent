# 子任务关联：聚焦无模型证据

设计结论以[详细 design §4.2／§6](../../../../superpowers/specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md#42-后台子任务冻结该次执行的来源)为准。这里不是新增运行 gate。

先读 report.md、review.md 和 minimal-evidence.json；需要核对事件时再读各 case 的 hooks.jsonl、trusted-metadata.json、metadata.json。原始重复轮询只保留每个会话相同状态的首尾样本，原始／保留 hash 与计数见 projection-manifest.json；未改变消息字段、时间或 hook。完整脱敏轮询保留在 report 所列本机目录。候选可用 `python3 candidate-prototype.py` 重放，属于离线有限反例，不是产品测试。

原生 probe 中工作区／审计目录路径需在复现环境调整，并使用相应 observer 版本；source-manifest.json 说明各批次源码对应。早批脚本是逆向重建，非执行前快照。历史 runDir 已清理，不应当作现存证据链接。没有保存模型正文、reasoning、实际凭据或私有答案。
