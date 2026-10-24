# 2026-10-25 无模型验证最小证据

结论及实施边界以 [详细 design §7](../../../superpowers/specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) 为准。本目录是既有 G 验证资料的追加证据，不是新增产品 gate。

- root：固定 1.19.3 四例本地 provider 请求/finish 元数据，五例 SDK 替身与执行报告。
- readiness：当前 prepareRun 五种输入的实际接口行为、部署只读核对及来源hash。未证明 seed 就绪。
- child：纯 OpenCode 两轮 task + SDK 读取的最小投影，未加载产品 plugin／ControlService；无可靠 call/ref→child user 关联证明，不与替身测试拼接为产品联合验收。
- critic：原始R的只读工具/通知元数据统计，没有 prompt/body/reasoning 内容。
- source-snapshot-sha256.json：主区当前快照137文件的hash；不能只凭HEAD复原源码。
- manifest.json：证据文件hash；报告中的临时绝对路径是当次来源，不要求以后仍存在。

临时探针只是本轮观测程序，未接入产品或测试入口。复现时先按报告建立干净隔离工作区、同版本依赖及loopback-only策略，并把源码导入与输出根路径指向新的隔离位置；不可复用原始run目录。root需将probe放工作区根、stand-in放tests/contract；readiness的check导入指向当次worktree，重放需改为自己的副本；child probe依赖当次SDK路径，亦需替换为同版本安装。保存原始源码便于审计，不保证直接从本目录执行。

不保留完整配置、真实原始消息、reasoning或判官答案。失败尝试及未覆盖项见各report；较大的临时失败输出留本机审计目录。无真实模型调用；本地替身返回的usage不作为真实模型消耗，真实usage为not applicable。
