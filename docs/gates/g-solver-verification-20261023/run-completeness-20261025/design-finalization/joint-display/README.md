# R4联合验证证据

结论见[报告](report.md)与[独立复核](review.md)。六个最终运行源码样本的最小投影可用 `python3 verify-projections.py` 重放核对，无需HTTP或模型；该脚本会重写同内容的verified-projections.json。

publish-hashes.json覆盖执行者收口文件，独立复核及本入口由主会话后补。native-probe与运行脚本保存当时输入，不保证原临时绝对路径仍存在；复现需独立副本、同版本依赖及loopback-only策略，不可对原调试目录运行。raw runs与自有HOME已删除；日志路径是历史定位，不是可用证据链接。原型patch未接入产品。compaction仅保留一次入口失败，不证明压缩内部兼容。
