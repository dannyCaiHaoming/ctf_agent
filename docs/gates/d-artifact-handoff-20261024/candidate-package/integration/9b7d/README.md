# D 第二接口：9b7d 子区接入证据

日期：2026-10-24，Asia/Tokyo。工作区 `/Users/caihaoming/.codex/worktrees/9b7d/pentest-agent`，detached HEAD `c652e95fc050e1c795dd55c80e6b7d95b3c6dd5b` 加起点未提交的第一接口。子区已实现并完成无模型验收；主区未接入，主 session 独立核对待完成。未 commit/push、合并、开新 session、调用真实模型、删除 plan 或清理 worktree。

## 来源与范围

- [起点清单](starting-provenance.json)：主区产品／测试／当前设计与给定基线完全匹配，没有缺项补拷；[完整基线](main-baseline.json) 原样保存。
- [原型 hash](prototype-hashes.json) 与 ae52 的 9 个产品／测试文件逐项相符；[原型来源副本](prototype-source/) 保存这 9 项，没有拷入旧 design 或整包旧 patch，也没有修改 ae52。
- [本次增量](integration-only.patch) 以带第一接口的起点为基准；[原型差异](prototype-differences.patch) 区分复用和新增。最终 18 个变更文件及 28 个相关源码／配置／设计 hash 见 [最终来源](final-source-hashes.json)。`starting/` 保存被本次修改的起点文件，`starting.patch` 是开始时已存在的 tracked dirty diff。
- 算法沿用原型。直接变更：模型可见工具／角色说明转为产品能力；C 的 package.read 与 package.publish 一起仅允许 Engineer；补 4 个 contract 场景及 runtime 真实加载正文／工具说明／白名单断言。精确配置仍与原型一致，仅 Engineer 新增两工具。
- 文档仅更新子区当前 D §4、核心 D 索引、README 及 C/G 过期状态。主／子 plan 保留。全部主区 106 个产品／测试／依赖基线 hash 最终复核未变。

## 验收

| 检查 | 结果 |
| --- | --- |
| 最终定向：package / artifact / H7 / config | 4 档 41/41，exit 0；[日志](04-targeted-final.log) |
| typecheck | exit 0；[日志](05-typecheck.log) |
| build | exit 0；[日志](06-build.log) |
| npm test | 45 档 362/362，exit 0；[日志](07-full-tests.log) |
| 同一完整四场景 runtime | `integration-20261024-114452`，exit 0；[日志](08-runtime.log) |
| 实际加载来源 | runtime 23 个输入 hash 与最终文件全部一致；原始请求核对角色完整正文、工具说明及精确权限；[复核](runtime-audit.json) |

| 场景 | 包提交 | 来源／整理 jobs | 整包请求 | C 资源终态 | 客户端工具终态 |
| --- | --- | --- | --- | --- | --- |
| control | 1 | 2 | 1 | completed | completed |
| R1 提交后回复丢失 | 1 | 2 | 1 | completed | error / control unavailable |
| R2 提交前原生停止 | 0 | 2 | 1 | cancelled | error |
| R3 提交后原生停止 | 1 | 2 | 1 | completed | error / Tool execution aborted |

每案 5 次真实产物发布、无重发／重跑。R2/R3 使用原生 task 返回的 Engineer child ID，由 Coordinator task.stop；未 SDK resume。RPC、revoke、停止结果、迟到回复尝试及原生消息保存在各案 `wire.json`、`observations.json`、`events.json`、`evidence/`；所有资源均 settled。control 通过原生完成消息交回具体 version，非模型自述 verified。

[四场景原始目录](../../integration-20261024-114452/) 包含每案 provider 配置、versions、provider 原始请求、`loadedContext.json` 实际 system 正文／工具描述、状态、固定 manifest、候选及预期原 bytes、原生消息、workspace 和 job stdout/stderr。原候选 9 bytes 为 `e697977bc3a97d00ff`。原始 jobs 与 manifest 的来源 execution 分别核对 Solver 与 Engineer，E 材料固定内嵌，argvStatus 保持 proposed。正常案 3 次指定版本读取分别读 manifest、candidate、E file。

本轮补充的分页测试拼接超过三页的 candidate/file，以及多页 manifest，核对 offset/nextCursor/bytes/hash；800000 bytes 候选因 base64 envelope 超 1 MiB 拒绝，第 33 file 拒绝，均不新增发布文件；NFC 别名与双向父子路径拒绝。P3 并发旧版读取及接口一 H5 父目录替换／symlink／混合读原始测试保持通过。

## 命令与失败保留

全部执行命令、退出码与日志索引见 [commands.json](commands.json)，运行参数见 [runtime-command.json](runtime-command.json)。依赖在 run 外 `npm ci` 安装，[输出](npm-ci.log) 保留；未升级依赖。Node v26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0。

- `01-before-integration.log`：8 failed / 4 passed，exit 1。产品仍为第一接口起点，contract/config 使用核对过的原型版本；失败为接口分派及 Engineer 白名单缺失。来源可由 starting 与 prototype-source 复核。
- `02-prototype-boundaries.log`：1 failed / 15 passed，exit 1。原型代码加本轮边界测试；失败直接证明 C 的非 Engineer package.read 被错误允许。该版 C 与 prototype-source 一致；修正仅为将角色限制覆盖 `package.*`。
- `03-targeted-green.log`、`04-targeted-final.log`：均 41/41，exit 0。后者对应角色／工具正文修改完成后的最终源码。
- 本轮四场景最终 runtime 没有失败或重跑；已有原型缺接口 RED、P3 误拒、runtime-1 探针计数失败及原始 H1 失败仍保留在上级历史目录，没有重标通过。

最终回归的精确命令：

```bash
npx vitest run tests/contract/d-candidate-package.test.ts tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts tests/contract/opencode-config.test.ts
npm run typecheck
npm run build
npm test
npx tsx tests/manual/d-candidate-package.ts integration-20261024-114452
```

最后一条是实际已执行命令；重跑必须换唯一新标签（例如 `integration-YYYYMMDD-HHMMSS`），保留旧目录，仍一次命令跑四案。

## 边界与自审

作者已按当前 D §4 自审来源、包固定／读取、C 角色／execution 绑定、P3 修正、配置、角色说明、测试及四场景原始证据，未发现本切片剩余可操作问题。这不代替主 session 独立核对。产品／测试验收后只更新设计、索引与证据，runtime 23 项来源 hash 未漂移。

H1 原生 cwd/instructions 仍含宿主私有路径，原完整条件未通过；H5 依赖可信稳定根和写完再发，hash 不是 OS 隔离；H7 不证明恢复／跨重启、幂等或宿主 unknown 强制锁。预定替身遵守 unknown 不证明真实模型策略。真实模型调用 0，真实 usage unavailable；脚本替身报告的零 usage 仅属替身。Verifier package 工具／版本任务绑定、验证结果、可信提交、实际包重放和语义充分性均未接入或未验证，不能称 D 整体完成、模型能力已验或 solved。
