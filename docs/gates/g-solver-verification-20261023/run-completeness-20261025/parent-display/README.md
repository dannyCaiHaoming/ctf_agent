# 父上下文展示可行性证据

当前决策见详细design §5.2，原型尚未接入产品。先读report.md、review.md；verified-projections.json核对实际父请求、持久化父消息的脱敏投影及execution事实。source-hashes.json和prototype.patch固定原型；input-hashes.json固定dirty输入，不能用隔离worktree旧HEAD代替。

final-partial/empty为正常两轮，各7请求；final-unknown实际是multiple_assistants、8请求，不能据此证明未知finish展示或额外调用因果。single-*是缺Part身份导致保存失败的样本，valid-parts-*是补齐后的早批；before-fix.patch由最终版本逆向重建，非执行前快照。baseline-directed与final-directed日志分别为59/63项；原prototype-tests并非clean baseline。

verify-projections.py记录当时从原始runtime提取/对照的过程；原始runtime已清理，脚本不能直接重放已删除的runDir。复查使用保留的verified-projections.json、各case metadata和raw-source-hashes.json；不需要读取原始prompt/reasoning。native probe复现须调整绝对路径并遵守loopback-only配置，只允许确定性本地provider。报告不证明模型理解、自然竞态或完整原子停止。
