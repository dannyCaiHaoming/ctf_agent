# R3 最小可保存证据

先读 report.md、review.md、minimal-evidence.json、native-summary.json；事件关联看 native-hooks-projection.json。

此目录从既有审计材料整理，没有新运行。report 的原始 candidate-*/hooks.jsonl / metadata.json 路径指向原审计目录，长期副本用以上最小投影替代；raw run、完整 baseline、HOME/XDG、重复轮询均未纳入。保留初次参考/失败与最终成功日志，不能拼接为同一批验收。

observer-candidate.patch 是相对主会话提供 baseline 的隔离观察原型；input-hashes.json 给出实际输入 hash。source-hashes.json 与 batch-source-hashes.json 给出最终及分批来源。没有还原 worktree，没有主区写入。

probe 是本地确定性 provider 的固定脚本，只可配合原 OS loopback-only 策略与 env -i 独立 HOME/XDG；脚本中的本机路径需按复现位置调整。package.json 提供 ESM 声明。不含真实 provider 凭据或目标地址。

manifest.json 列出每个保存文件的字节数与 SHA-256；manifest.sha256 记录 manifest 自身 hash。
