# D 证据到完成 design：历史原始证据摘存

整理日期：2026-10-28（Asia/Tokyo）。来源：[D 证据到完成](../../superpowers/specs/2026-10-26-design-v1-d-evidence-to-completion.md)。以下仅逐字迁移运行指纹、索引及离线对照过程；各块标明迁移前位置。设计决定、接口契约、限制和验证结论仍在来源文档；本次没有重新验证或改变其历史状态。

## §1 r5 run 路徑、模型与產品版本（原第 31 行）

原 run：`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261027-r5/runs/throwback-debug-20261027-r5-1/`。OpenCode 1.19.3，`volcano-coding/deepseek-v4-1-flash-261017`，产品版本 `6fa6c6621464bcdd11ac618fa930b7d1bdbe9bbd`、productDirty=false。以下路径相对此 run。

## §1 固定 version／execution／報告 ID（原第 33 行首句）

固定 version `f0a80e86-ab0f-4495-9bcf-8e17a934f1a1`；Verifier execution `6cd43d83-dd02-4eaa-a0de-1a9aed8e40ee`；报告 `0063135b-b061-419c-8000-51cff36d601a`。

## §1 证据文件与四角色消息索引（原第 43 行首句）

证据入口：`evidence/verification-results.json`、`publications.json`、`completion-results.json`；消息 session 尾部依次为 Solver `e85097228ffesBV9OZcvUuv7wA`、Engineer `e85082c3affea69is6996v3tFR`、Verifier `e85073cd1ffeU9jRvO4OdTiSeV`、Coordinator `e851e43c9ffep6sSbfl5yXfzei`（文件名 `evidence/messages-ses_<id>.json`）。

## §5.2 离线 A／B 场景与原始返回（原第 134–135 行）

- **A：本次写入有效。** 初始无页面；匹配写入返回302并把页面设为包含 `flag{offline_marker}` 的新页；随后读取200。脚本返回0，stdout 为 `FLAG: flag{offline_marker}`。
- **B：写入未更新、旧页仍在。** 初始已有包含同一非秘密标记的旧页；同一匹配写入返回302但不改变页面；随后读取200仍是旧页。脚本仍返回0，stdout 与 A 完全相同。
