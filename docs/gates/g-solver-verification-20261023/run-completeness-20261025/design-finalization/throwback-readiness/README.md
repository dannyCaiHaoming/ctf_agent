# Throwback上游与初始准备验证

本轮修正旧readiness/R1报告的假设：固定上游自带初始DB，业务题目表为空不代表缺seed。最终结论见[报告](report.md)与[独立复核](review.md)，权威设计见[§5.1](../../../../../superpowers/specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md#51-readiness以固定上游初始状态为依据)。

26项执行者发布文件见publish-manifest.json；review与上游元数据由主会话另补，不伪装为执行时快照。主会话独立核对了七阶段hash/隔离、三组HTTP、两实例及一次restart身份和15项判据结果。两次默认部署一致不证明可解或judge，也不推定历史调试run完整状态。

`offline-check.py`仅重放元数据和指定本地材料包，不调用Docker/HTTP/模型，会重写同内容投影；材料原路径可能失效，重放时须使用source-check中同hash材料。probe和http-probe是当时观测程序，不是可直接运行的生产准备工具；不应针对旧实例重放。容器已按自有ID/label清理，工作树保留；没有产品源码改动或提交。

启动命令的证明为执行命令转录＋固定镜像配置，未保留已删除容器的Config.Cmd直接inspect。启动瞬时URLError、SQLite路径匹配修正和inspect字段查询失败均按报告保留。未运行populate、读取账户/配置/答案行值、解法或保存HTTP正文。
