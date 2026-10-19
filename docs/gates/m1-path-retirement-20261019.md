# M0/M1 偏移实现清理复核

基线：`main` / `baed7fa17f21de83eefb27a9d85f956402dec7ad`。初轮仅清理；用户随后明确授权复核通过后，仅提交并 push 本轮清理、归档和验证记录。不调用外部模型。原有 M0 plan 编辑、AGENTS.md、`.m1-verification-replay/` 均保留并排除出提交。

## 处置

| 范围 | 决定与理由 |
| --- | --- |
| M0 自建循环、OpenAI/Anthropic 直连适配器 | 已在 `baed7fa` 删除，不重复实现；历史可从 `3fa7d3e` 恢复 |
| M1 `tests/legacy` loop/driver、8 份旧循环测试及装配、provider 契约测试 | 移至仓库 `archive/pre-opencode-20261019/`，退出默认 build/typecheck/test；保留故障场景供未来迁移，不再维护 JSON 动作协议 |
| 早期 `.opencode/agents` 四个定义 | 原样归档。其 Web 渗透测试流水线及缺失 harness/tools 不是当前 CTF 产品路径；去掉自动发现入口 |
| profile loader/schema、doctor | 删除直连模型配置与凭证存在即判可用的旧分支。CLI 默认切到现有 OpenCode 示例；旧配置明确拒绝 |
| 历史配置和全部验收证据 | 保持原路径、原字节；配置分类见 `config/README.md`。不倒改旧 manifest、失败、停止计数或正式 3/3 |
| 当前 OpenCode/Bridge/plugin、thin host、local replay/oracle | 保留。未改模型/工具循环、判分器或正式运行配置 |
| Runtime/PTY/TCP、watch、hypothesis 数据、快照/本地恢复、验证与多 flag、Reference、领域方法、度量 | 保留组件与测试；35 份 `packages/` 源文件和 33 份 fixture 全部原字节不变。它们对应 spec/roadmap 的职责，不因当前轨迹未接入就删除 |
| `dist` 旧编译产物 | 找到 loop/driver/probe 的 JS/声明共 6 份陈旧文件；干净构建后消失。构建前清理仅限已确认的生成目录 `dist`，避免删除源码后旧产物继续存在 |

归档 19 份原件（含两份混合测试的迁移前版本），逐文件哈希与清理前一致；映射见 [`manifest`](../../archive/pre-opencode-20261019/manifest.json)。归档保留原 import，因此历史重放应使用完整基线 checkout，而不是在当前归档目录直接执行。不是一套仍受支持的备用框架。

## 测试覆盖变化

- 当前 OpenCode 黄金路径、候选拒绝、受管工具、usage、预算、raw stderr/局部 patch/独立 replay/权威 oracle 判分测试保持原样。
- 65 项旧框架专属测试（provider 10、旧循环 55）退出默认套件，全部原样归档；不宣称已迁移为 OpenCode 的六轨迹能力。M1b 的路线切换、长作业恢复、compaction、多 flag 模型集成仍需后续真实路径验收。
- `metrics.test.ts` 从运行旧循环改为测试 canonical event 投影；原两类断言保留，并保留两候选 lifecycle 覆盖、增加精确时长与缺失来源断言。它是冻结事件契约的组件测试，不是当前 OpenCode 度量集成证明。
- `verified-multiflag-candidate.test.ts` 保留三个组件场景，直接执行真实本地 Node job → immutable 输出 → 独立验证 → oracle；验证 partial 持久化、每候选独立 task/session、阶段顺序、拒绝诊断及后续候选。测试不再声称模型会自行续跑。
- 边界测试扩至活动源码/测试不能导入归档或恢复旧框架，且旧 Agent 定义不再自动加载。新守卫清理前 3 项失败，清理后通过。
- 迁移期间修正了测试对 oracle fixture 的误解：再次提交同一个错误值返回 duplicate，并保留既有 partial；拒绝后保持 accepted slot 的检查使用另一错误值。没有修改或放宽生产 oracle/验证逻辑。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| `npm run gate:m0` | 27 files / 163 tests 通过 |
| `npm run gate:m1` | 1 file / 3 tests 通过 |
| `npm test` | 45 files / 236 tests 通过（299 − 65 + 2） |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；114 份当前生成文件，旧 loop/driver/probe 为零 |
| `git diff --check` | 通过 |
| 归档原件哈希 | 19/19 一致 |
| 可复用组件、fixture、旧 gate 文件 | 35 + 33 + 68 份全部不变 |

完整 gate 使用本机实际 OpenCode + 本机确定性 provider，另有 TCP/PTY 测试；外部模型调用 **0**，新增正式 attempt **0**。原 b2 3/3 仍仅证明当时冻结源码；本轮改动是确定性清理回归，不冒充一次新的真模型验收。

## 提交前复核

2026-10-19 再次核对归档与基线 Git blob：19/19 哈希一致；全部 `packages/`、fixture 和既有 `docs/gates/` 共 136 份文件与基线逐字一致。当前黄金路径、拒绝测试、停止规则及 gate 收集配置未改，未发现可复用组件误删或当前产品断言放宽。旧框架的 65 项测试归档与组件测试迁移边界已在上文明确，不用测试总数证明能力等价。

提交前重新执行 M0 163/163、M1 3/3、完整测试 236/236、typecheck、干净 build、diff-check，全部通过。提交采用 52 个路径的显式白名单（包含归档源/目标两侧），排除既有 M0 plan 编辑及未跟踪的用户文件。M1 plan 的清理复核与交付授权状态随同一提交保存。
