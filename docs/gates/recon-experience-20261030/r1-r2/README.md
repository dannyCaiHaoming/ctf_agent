# R1 / R2 修复后的无模型证据

基线 `b79d46bc`，当前工作区未提交。本目录是 R1 / R2 修复后的新批次。父目录旧版 699 项及旧原生批次保留为历史，不作为修复版证明。

- `npm run typecheck`、`npm run build`、`npm test` 通过；54 文件、705 项测试，完整输出见 npm-test.txt。
- `npx tsx tests/manual/experience-loop.ts`：同批次 A→题后整理/提炼→关闭服务并重开 DB→B 查询/展开/执行本地对照→B episode。A 包含 SQL 失败分支、HTTP 拒绝和 job 超时；B 包含适用与不适用观察，Recon/Solver 均实际查阅。
- 本机 macOS ARM64 Node 26.3.0，以及 Ubuntu 24.04.5 ARM64 Node 24.22.0，均用 OpenCode 1.19.3；各 59 次 localhost 脚本化生成请求，其中各题题后两次。真实模型调用为 0。
- Ubuntu 使用已存在的 Ubuntu ARM64 镜像 `68ee22004a91`，临时只读挂载现有 Linux Node/OpenCode/依赖；容器 `--network none`，仅内部 localhost。此检查证明目标 OS/架构运行时接线，不表示已构建或认证正式发布镜像。
- stored-chain.json 是只读导出的三表实际内容；trace.json 保存脚本发出的工具调用、返回和交付。assets.json 保存真实运行拷贝的产品资产 hash；source-hashes.json 与当前实现吻合性见 verification.json。
- 求解用量和题后用量分开保存；数字仅为本地脚本化返回的 usage，不是实际 provider 账单。可信 accepted/solved 为本地模拟裁判接口事实，不证明真实 CTF 解题或模型方法质量。
- R1 新回归：localhost HTTP 实际动作已发生，BEFORE UPDATE OF result_json 触发失败后，同题后续 HTTP、新 Recon session 及 Solver 不能继续新探索；已有材料读取、取消、固定发布及交回仍可用，其他题正常。异步 job 在 running 回执交付后发生终态保存失败，也会暂停后续新 job，原 job 清理仍落到 settled。
- R2 新 launcher 回归：循环内 capture 抛错仍继续调度到正常完成，可信 solved 原样保留；收尾 capture 或 episode-inputs.json / learning.json 保存失败仅记录学习 pending / error，不更改求解 run status / stopReason。原有求解失败断言不变。
- 本次代码修复文件：control-service.ts、launch.ts；新断言在 experience-tools.test.ts、launch-evidence.test.ts。正常 A→B 脚本未改，已在两平台实际重跑，各 59 请求。新的 root、源 hash、时间和三表导出均独立保存。
- 未验证：真实模型整理/提炼质量、实际跨题收益、正式发布镜像。未 commit/push；权威 design、plan、handoff 由主会话维护。

故障注入回归在 macOS 本机执行；Ubuntu ARM64 本次重跑的是正常 A→B 原生接线，未将本机故障结果表述为目标容器故障验收。
