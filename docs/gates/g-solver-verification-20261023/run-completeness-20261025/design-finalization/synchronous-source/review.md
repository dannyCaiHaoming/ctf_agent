# R3 证据收口核对

这是执行者对已保存材料的离线证据核对，不是独立 reviewer 签字；未重跑任何验证。

- report 的五个成功同步 exact-read 均在 minimal-evidence.json 中逐案保存，包含父/child metadata 一致、冻结 user、唯一 assistant.parentID、finish/字符数。
- native-summary.json 保留六案最终身份/状态/计数投影；没有消息正文、reasoning、秘密、oracle 或 solution。
- native-hooks-projection.json 仅保留成功返回的相关 hook 和 exact-read；每案附原 hooks 文件 hash，排除重复 entry、model.call 和轮询历史。
- 首批 native.log 是初始观察参考；其 metadata 后被目录复用拒绝结果覆盖，不用作主要完整证据。candidate-native.log 保留该失败。
- final-typecheck.log / final-build.log 保留首次类型失败，fixed-* 与 final-tests.log 是修正后成功检查。四个主候选案与两个追加案的源码 hash 分批记录；前批 hash 为从最终源码反向去掉纯类型 guard 重建，未伪装成执行前快照。
- 临时 Map 只支持可行性观测，离线注册/冲突断言不等于产品实现或自然 race 通过。没有同步父展示验收、通知收束修复或模型能力结论。

未发现需要改变报告结论的证据不一致；上述限制保留，仍需主会话独立 review。
