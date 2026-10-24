# D 接口一：独立工作区无模型验证结果

日期：2026-10-24，Asia/Tokyo。结论：**有条件可行；H1 字面路径条件未通过，H5 不能无条件成立。不能称 H1–H7 全通过。** 本文是本次最小验证记录，不是产品接入批准、模型能力或 solved 证据。

工作区 `/Users/caihaoming/.codex/worktrees/1488/pentest-agent`，externally managed detached HEAD `c652e95fc050e1c795dd55c80e6b7d95b3c6dd5b`。未创建子 session/子 agent，未 commit/push/合并/归档/清理。主区仅只读取 hash；[起始来源](source-manifest.json)与[结束主区比较](main-readonly-comparison.json)的相关文件全部一致。README/core design/.handoff 是进入时已有改动，未由本次编辑。D design 与 plan 进入时已存在，hash 与主区相同；plan 原样保留，执行结果以本文和 ledger 为准。

## 实际原型与来源契约

- 候选先写子区 D §3，再实现 `artifact.publish` 和 `artifact.read`；只为 Recon/Domain Solver/Engineer 开放发布，Verifier 只读，其他角色无可见工具。C 的执行层独立检查角色、题目、会话、停止和 run。
- 发布参数只选择 file/work path、job/stream 或 HTTP opaque resource 及 start/end；不接受模型自填 hash/session/callID 作为授权。job/HTTP 原始来源从 C 的资源绑定取得；file 仅追溯内容匹配的最后 G workspace.write，未知生产者记 null 并与 selectedExecution 区分。
- 每次发布独立 UUID，磁盘临时文件 rename 后、再次 live 检查后才进入 host 内存 registry；不做跨来源去重。模型仅见虚拟 published 路径与引用。引用读、G published 读/列表/搜索都以同题 registry 为权威并核对固定 bytes/hash，不暴露 ArtifactStore 的宿主 path。
- HTTP 在 adapter 捕获原响应 bytes；可编辑的 bodyPath 不是可信来源。JobManager 保存真实流的有界内存副本，只有 settled 后可发布，截断仍 false。文件/每输出流上限 1 MiB；base64 页为 32768 bytes。
- 仅已有原生 background execution 可发布；前台 G job/HTTP 仍保持原行为，但不自造 D 来源。没有候选登记、解法包、Verifier 结果、oracle、通用网络、容器、配额恢复或新调度器。

## H1–H7 逐项结果

| 判据 | 实际观察及边界 | 结论 |
| --- | --- | --- |
| H1 | `runtime-final-2` 同一 launch/OpenCode/plugin/C/G：E 固定材料；Solver 受管写二进制和脚本；真实发布；原生 task 完成带引用，Coordinator 再由原生 task 分派独立 Engineer；Engineer 读回四份 bytes/hash，sibling work 被拒。测试没有预置 published，也没有 SDK 直接传内容。D 工具回复没有私有 run root。但全部 27 条模型请求的 OpenCode 原生系统环境含 cwd/instructions 绝对路径，见 provider.json 首条 system message。 | **部分通过：接线通过；“整个模型上下文无宿主私有路径”的字面条件失败。** 不能用工具回复不含路径替代此条件。 |
| H2 | 同一 runtime 的真实 job stdout 与 HTTP body 发布并被 Engineer 读取。来源 session/call/resource/execution 可与原执行逐项关联。HTTP 可编辑 work copy 改写后，发布仍为原 adapter bytes；外来 job/HTTP handle 拒绝。 | 同次 runtime 通过；HTTP work copy 篡改等为定向覆盖。 |
| H3 | 旧快照不随 work 改写；新内容新 ref；同 bytes 不混合来源；Engineer 同会话整理文件可再发布。job 与受管 file 在原 session 新 execution 后发布仍指原 producer。未知文件 producer=null。两份真实提交先完成再恢复 C 的 barrier，核对审计各指自己的引用。 | 在上述来源语义下通过；普通未知文件不是可信执行收据。 |
| H4 | 跨题/run、sibling、绝对路径、..、symlink、外来 job/HTTP、伪 ref/hash/session 字段、Intake/未绑定/停止/撤销会话拒绝。配置精确白名单与 C precheck/execute 分别覆盖；published 直接写拒绝。磁盘植入未登记文件不被 G 列表/搜索暴露；登记 bytes 改坏则拒绝。 | 受管 API 层通过。**不声称 OS 隔离**，同 uid 直接访问仍是已知缺口。 |
| H5 | 无随机 sleep：在 ancestry/open/read 阶段安排同长原地改写、rename、父目录和 symlink 替换；均拒绝。另一个真实 writer 在第一块读完、第二块被 barrier 暂停时改写；严格顺序为 read-1 → second-read-blocked → external-write-completed → second-read-released → read-2；混合 buffer 在发布前被拒。原子 rename 前后静止版本分别是 OLD/NEW。 | **有条件成立，不是任意恶意并发或原子 OS 快照证明。** 需稳定可信根及无不受管并发写入。已保留同 uid 可直接改 published 的反例；hash 只能检出，不能防止。 |
| H6 | 真实超限 job 和超限 HTTP 均保留截断 originalComplete=false，所选区间 rangeComplete=true，snapshotFixed=true；file originalComplete=null。越界拒绝；分页边界验证；未 settled job 拒绝；失败 HTTP 不生成来源成功记录。 | 定向通过；runtime 是正常小输出，不冒称 runtime 注入全部故障。 |
| H7 | 真实磁盘操作包装注入写失败、取消前/rename 后、deadline 后：无可见半引用。落盘登记后丢弃回复，host 本次 run 仍有一份可读记录，不重做来源。登记内容后被改坏，artifact 与 G read/search 拒绝。 | 定向组件测试通过；回复丢失/期限是组件时序注入，**不是完整 RPC 断网 runtime 验收，也没有跨重启恢复**。 |

## 最终同入口 runtime 原始证据

权威最终批：[runtime-final-2](runtime-final-2/summary.json)。Node 26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0。唯一 enabled provider 是 loopback stub；启动前地址与 enabled_providers 均有断言，[配置](runtime-final-2/provider-config.json)、[版本](runtime-final-2/versions.json)。27 次替身请求，真实模型/provider 调用 0；替身报告 token 0，不作为真实 provider usage。没有 oracle，solved=false。

- [原始 provider 请求和预定响应](runtime-final-2/provider.json)、[原生事件](runtime-final-2/events.json)。onStarted 只订阅事件，没有 SDK prompt/子会话内容注入。
- [bindings](runtime-final-2/evidence/bindings.json)、[原生 task executions](runtime-final-2/evidence/task-executions.json)、[控制审计](runtime-final-2/evidence/control-audit.json)、[工具资源](runtime-final-2/evidence/tool-resources.json)、[host 发布记录](runtime-final-2/evidence/publications.json)。
- `runtime-final-2/workspace/X/published/*.bin` 是真实发布 bytes；来源 work 与 `state/jobs/<session>/<job>/stdout.bin`/stderr 同批保留；E 材料固定记录在 evidence/challenges.json。
- [作者逐字节和来源交叉核对](byte-and-provenance-crosscheck.json)：四份发布分别为 binary 4 bytes、script 41 bytes、job stdout 16 bytes、HTTP 14 bytes，分别与原资源 bytes 相同；source.callID 指向真实 workspace.write/job.run/http.request，resource.execution 指同一次 Solver execution。
- [批次开始时源码 hashes](runtime-final-2/source-hashes.json)与最终代码逐项一致；D 文档结果是在批次后回填，最终文档 hash 另见 final-manifest。最终原型 patch 见 prototype.patch；既有 README/core/.handoff 不混入补丁。

H1 完整路径条件在最终脚本里作为明确限制输出，因此脚本 exit 0 仅表示其已声明的接线断言成立，不表示 H1 完整验收通过。早期 runtime-2/runtime-final 的 summary 将 H1 简写为 passed，未检查原生 system 环境路径，现由原始请求复查及 runtime-final-2 明确纠正；旧批没有改写。

## 命令、退出码及失败保留

全部精确命令、退出码与日志映射在 [commands.json](commands.json)。以下没有用后来通过结果覆盖先前失败：

| 批次/确切命令 | 退出码/结果 |
| --- | --- |
| `npm ci` | 0；run 外准备依赖，package-lock 未修改；完整输出仅在工具记录，未伪造本地原始日志。 |
| `npx --no-install vitest run tests/contract/d-artifact-handoff.test.ts`，contract-initial | 1，5 项均因无受管工具入口失败。 |
| 同命令，contract-prototype-1 | 1，5 项因前台 fixture 缺 background execution 失败。 |
| 同命令，contract-prototype-2 / contract-races-1 | 0，5/5、17/17；H5–H7 后加项是可行性刻画，不声称它们都有独立 RED。 |
| 同命令，contract-search-red / contract-search-green | 1（17 pass/1 fail），0（18/18）。原始 G list 暴露未登记文件；改为 registry 后通过。 |
| 同命令，contract-file-provenance-red / green | 1（20 pass/1 fail），0（21/21）。跨 execution 文件归属原先错误，修正后通过。 |
| 同命令，contract-concurrent-audit-red | 1，21 pass/1 fail；并发审计误取 last record。 |
| `npx --no-install vitest run tests/contract/d-artifact-handoff.test.ts tests/contract/workspace-tools.test.ts tests/contract/job-tools.test.ts tests/contract/http-tools.test.ts tests/contract/opencode-config.test.ts tests/contract/control-service.test.ts`，regression-1 | 1，78 pass/1 fail；精确配置白名单原先只列 G，不容纳本次已授权两个 D-one 工具。 |
| 同回归命令，regression-2 / verification-final/targeted | 0，81/81、**83/83**（最终含 22 项 D）。保持精确白名单，未取消权限断言。 |
| `npm run typecheck`，exploratory / checks-1 / checks-final / verification-final / manual-summary-typecheck | 2（3 条 unknown-number 诊断，仅工具记录），后四次均 0。 |
| `npm run build`，checks-final / verification-final | 均 0。 |
| `npm test`，checks-final / verification-final | 均 0，43 文件 344/344、最终 **345/345**。后者包含并发审计 RED→GREEN。 |
| `npx --no-install tsx tests/manual/d-artifact-handoff.ts runtime-1` | 1；交接已执行，但错误地期待 E 发 HTTP（期望 2、实际 1）。保留原批，修正测试预期为一次真实 G HTTP。 |
| 同 runtime 命令，批标签 `runtime-2` / `runtime-final` / `runtime-final-2` | 均 0；最终批包括真实源文件/stream 核对及 H1 路径限制，不拼接不同 run 冒充一次通过。 |
| `npx --no-install tsx tests/manual/d-artifact-handoff.ts runtime-final-2` 再次运行 | 1，EEXIST；启动服务器/新 run 前拒绝复用批次；见 duplicate-batch-refusal.log。 |

最终产品原型经过 83 项定向、345 项全套、typecheck/build 后不再修改；之后只改 manual fixture 的结果标签/路径观察并再跑最终 runtime、typecheck，以及设计/报告回填。早期探索批没有逐批源码快照，不冒充可精确重建其全部未提交代码；它们保存失败输出、runtime 版本/配置/原始数据，权威候选为有启动源码 hash 的最终批。源码/文档起始与最终 hash、最小补丁供主 session 独立核对。

## Rulings I made（按 ledger 顺序）

1. 用户明确的“不提交、不清理、不另开 agent”优先于 executing-plans 的 commit/清理/独立 reviewer 步骤；由作者自查并留给主 session 独立核对。代价：自查弱于独立评审。
2. Plan H1–H7 是验证判据，不是 task-start parser 的编号任务；直接用 ledger 跟踪，不改造 plan。代价：步骤对应需人工核对。
3. 发布候选限 G 已有原生 background execution，保留前台失败。代价：前台来源发布不可用。
4. runtime-1 目标请求预期从 2 修为 1：E 是 socket 检查，只有 G 发 HTTP；不换目标/样例、不删失败。代价：不声称 E 有 HTTP 请求证据。
5. 保持前台 G job/HTTP 原行为，不为建立 D 来源在 spawn 的 onRegistered 中抛错。代价：没有 background 来源的输出不能用于此发布入口。
6. 未追溯普通文件 producer=null，与发布选择 execution 分开。代价：job 写出的 work 文件不能仅凭文件名/内容升级成可信工具收据。
7. H5 受控 interleaving 不推出 OS 隔离或任意并发保证；保留同 uid 直接写反例。代价：结果是条件性可行，不是安全部署证明。
8. 不扩展为 G/OpenCode 系统提示去路径工程；如实保留 H1 路径条件失败。代价：本次不能通过完整 H1，也不能将本次结论写成 H1–H7 全通过。

Deferred minors：本原型保留每流有界 host-memory 副本，但没有 run 总字节保留配额；正式产品的保留策略未设计。手工 fixture 使用本机绝对 executable 路径，未做可移植封装。这两项未作为本次验证前置，也没有追加工程。

## 决策建议及尚未验证

可保留同题 UUID registry、不可覆写版本、host 捕获 job/HTTP bytes 与独立 Engineer 读回，作为接口一的候选事实；不能整份照搬为已批准正式契约。H1 全模型上下文无路径、H5 任意并发/OS 边界、前台 execution、未知文件原始生产者仍需决策；本次没有扩大范围解决它们。后四个 D 接口、真实模型协作/解题、可信完成、跨重启恢复均未验证。

主 session 应按最终原始 bytes、source/final hashes、runtime 公共路径和必要定向复跑独立核对，再选择性回写主区 D §3/§9。不要整份覆盖主区；未合并、未提交，保留原 plan、工作区和全部批次。账本在 `.superpowers/sdd/2026-10-24-d-artifact-handoff-verification/progress.md`；其副本随本证据包保存，避免依赖 ignored 临时目录。
