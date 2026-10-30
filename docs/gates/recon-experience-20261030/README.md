> 本目录保留初版历史证据；旧 699 项及旧原生批次不作为 R1/R2 修复版证明。修复后重新执行的结果见 [r1-r2/README.md](r1-r2/README.md)。

# Recon → episode → lesson → 下题查阅：无模型证据

基线 `b79d46bc`，当前工作区未提交。只保存本次确定性与原生接线证据，不代替权威设计。

- `npm run typecheck`、`npm run build`、`npm test` 通过；54 文件、699 项测试，完整输出见 npm-test.txt。
- `npx tsx tests/manual/experience-loop.ts`：同批次 A→题后整理/提炼→关闭服务并重开 DB→B 查询/展开/执行本地对照→B episode。A 包含 SQL 失败分支、HTTP 拒绝和 job 超时；B 包含适用与不适用观察，Recon/Solver 均实际查阅。
- 本机 macOS ARM64 Node 26.3.0，以及 Ubuntu 24.04.5 ARM64 Node 24.22.0，均用 OpenCode 1.19.3；各 59 次 localhost 脚本化生成请求，其中各题题后两次。真实模型调用为 0。
- Ubuntu 使用已存在的 Ubuntu ARM64 镜像 `68ee22004a91`，临时只读挂载现有 Linux Node/OpenCode/依赖；容器 `--network none`，仅内部 localhost。此检查证明目标 OS/架构运行时接线，不表示已构建或认证正式发布镜像。
- stored-chain.json 是只读导出的三表实际内容；trace.json 保存脚本发出的工具调用、返回和交付。assets.json 保存真实运行拷贝的产品资产 hash；source-hashes.json 与当时实现吻合性见 verification.json。
- 求解用量和题后用量分开保存；数字仅为本地脚本化返回的 usage，不是实际 provider 账单。可信 accepted/solved 为本地模拟裁判接口事实，不证明真实 CTF 解题或模型方法质量。
- 未验证：真实模型整理/提炼质量、实际跨题收益、正式发布镜像。未 commit/push；权威 design、plan、handoff 由主会话维护。
