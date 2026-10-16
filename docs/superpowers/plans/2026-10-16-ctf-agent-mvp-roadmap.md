> 🟢 **当前路线图（current）** · 权威设计见 [`../specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)，文档索引见 [`../README.md`](../README.md)。

# 通用 CTF 解题 Agent — MVP 交付 Roadmap

日期：2026-10-16
状态：路线图草案。本文只定义里程碑边界与验收门槛，不是实现计划；每个里程碑在启动时单独产出一份 detailed plan。

**Spec：** [`docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)（含 [原始 brainstorm](../specs/archive/2026-10-13-ctf-solving-agent-design.md)）
**归档：** 旧的单体实施计划见 [`plans/archive/2026-10-15-general-ctf-agent-system-implementation.md`](archive/2026-10-15-general-ctf-agent-system-implementation.md)，仅作参考，不再执行。

---

## 为什么重写

旧计划把整份 spec 一次性展开成 31 个任务，并按**水平分层**组织依赖：`M0(Task 1-12) → M1 → … → M4`，要求先把 contracts / state / policy / runtime / platform / supervisor 全部"地基"建完，任何东西才允许跑起来——光 M0 就 1700 行。随后每条 review 发现（capacity 两阶段账本、protected-dispatch envelope、mutation lease、build-identity manifest 等加固性约束）又被反折回去堆进早期任务，计划越审越厚（"累加累加"），且在 M2 之前**没有任何一个能真正解一道题的产品**。既看不到进展，又容易反复推翻地基——这是死循环的根因。

## 本 Roadmap 的原则

1. **垂直切片，不是水平分层。** 每个里程碑是一条能端到端跑、可演示验收的最薄路径，后一个在前一个上加厚，而不是先造完所有零件。
2. **每个里程碑 = 一个可验收的 MVP。** 验收产物永远是"能跑的东西 + 一条通过的门槛"，不是"一批不可运行的脚手架"。
3. **确定性门槛与随机门槛分开。** 确定性的 schema/state/adapter/runtime/policy 契约测试是**常设 gate，每次改动必须全过**（永远是绿的安全网）；真实模型的解题能力天然随机，用"固定配置各跑 N 次、至少成功 M 次"的统计门槛判定，绝不用"跑通一次"冒充能力达标。
4. **加固性关注点按需后置，并给硬边界。** capacity 账本、protected dispatch、mutation lease、build identity 等不前置进地基；只有当某个里程碑出现真实的并发/安全/可复现失败场景时才引入，且遵守「每个 profile 同时只允许一个 active run」(spec §4.5) 这一简化不变式——旧计划大量 cross-incarnation/多 owner 机制因此根本不需要。
5. **结果词表从 M0 就锚定**（spec §5.3/§5.5）：`candidate`（未验证候选，不是成功）→ `locally_verified`/`candidate_only`（本地 oracle 判对，但无平台确认）→ `accepted`（平台 `correct=true` 确认）。只有 `accepted` 能进 solved；本地题缺可验证 oracle 时最高只能 `candidate_only`。
6. **plan 不累加。** 本 roadmap 稳定不动；每个里程碑**启动时**才用 write-plan 生成它自己的 detailed plan（范围仅限该里程碑）。review 的发现折回**当前里程碑的 plan**，不折回本文、也不推翻已验收的里程碑。
7. **技术栈照 spec。** OpenCode 底座 + TypeScript CLI/控制层；TSecBench 桥接用 Python 官方 SDK（固定 `tsec-benchmark 0.1.2`）；目标 `linux/arm64` / Ubuntu 24.04。dev 阶段先在 macOS/Linux 开发机跑，Docker 推到 M4。

**术语**（三者门槛独立，不互相冒充，spec §11/§12.3）：**mock 平台** = 用固定 SDK 契约喂的假平台，验生命周期语义；**本地靶机 + `local_oracle`** = 跑着的受控题目 + spec §5.5 的 oracle adapter，验真实求解；**真实 TSecBench** = 用户预登记任务的小范围实测，验真实契约与计时。

---

## 里程碑总览

| 里程碑 | MVP 产物（能演示的东西） | 验收门槛 |
| --- | --- | --- |
| **M0 确定性地基 + 冒烟解题**（全项目最重、风险最高） | OpenCode 桥接/插件/工具运行时打通 + mock TSecBench adapter + 单个按需 Challenge Browser + state + `local_oracle` + 一个跑着的本地靶机 | ① 确定性契约测试全过（身份/scope/deadline/effect 分级/artifact 发布/secret 边界/Browser scoped 操作与转题 teardown）；② 一次冒烟 run：真实模型对本地靶机产出候选、`local_oracle` 判 `accepted`（仅证明端到端通路，**1 次即可，不作能力门槛**） |
| **M1 Solver 循环韧性** | 自适应职责（coordinator + web/misc/crypto solver + verifier）+ 按需 Skills + 本地 checkpoint 续跑 | spec §12.2 的**六条 loop 轨迹**，固定 model/参数/prompt/工具版本/预算，**各独立跑 3 次、至少成功 2 次**，全部结果保留 |
| **M2 TSecBench 单题 live** | `prepare`/`start` 两阶段 + VPN 预检 + 单题 list/start/ready/solve/submit/close + 平台感知 resume 起步 | 相对 first-List baseline，本 run 的 confirmed Submit（或 clean/exclusive 下无歧义对账）取得**至少一个新 `accepted`** |
| **M3 多题 portfolio + 韧性** | 完整列表 + 最多三活跃 instance + 多题 Scheduler + 切题/close + 预算 + fail-stop 完整恢复 | Fixture 覆盖三 instance 与错误分支；真实任务枚举全部支持题、跨题调度、至少一题 `accepted`；恢复不延长 deadline、不重复计分 |
| **M4 ARM64 镜像交付** | `ctf-agent:core-arm64` 一键构建 + 锁定依赖 + host VPN + 最小 formal egress | 原生 Ubuntu ARM64 重跑 M0–M3 契约、冷启动无下载、raw curl/socket/browser 旁路失败，用**独立 task B** 取得至少一个 `accepted` |
| **M5+ 硬化与正式验收** | 按目标 profile 实际需要的 capability tracks（容器 VPN、多 browser/noVNC、多身份网络、CTFd/rCTF…）+ M6 formal 验收 | 每个被声称支持的 profile 只需通过其依赖 track；M6 按 spec §12.5 通过率公式、零虚假成功、全部支持题留在分母 |

> **Full 工具镜像**（SageMath、重型 Crypto/隐写）：M0 只**核验 ARM64 构建可行性**与资源成本，主求解闭环不等它；实际构建在 M4。
> **doctor 增量成长**：M0 查 model/tools/browser → M2 加 platform/VPN 预检 → M4 加 container/arch。

---

## 各里程碑边界

### M0 确定性地基 + 冒烟解题 —— 立起整条脊梁（最重里程碑）

> ⚠️ 这是全项目**最重、风险最高**的里程碑，不是"轻量骨架"。第一条垂直切片必须把整条脊梁立起来，OpenCode 桥接是头号集成风险。先做完内部的确定性 gate（②之前必过），再做冒烟 solve，避免随机模型掩盖地基缺陷。

**做什么**
- **OpenCode 集成**（头号风险）：server 生命周期、session 身份绑定（`session_id → run/challenge/task/responsibility_set/lease`，未绑定 session 不可调 CTF 工具）、插件只暴露 allowlist 工具、把 `ToolContext.sessionID` 交给 Bridge、不接受模型自报身份（spec §4.4）。只用公开 plugin/SDK/server 接口，缺 hook 返回设计 blocker，不维护 fork。
- **Model Data Gateway**：所有 provider 路径经 Gateway，`control_secret` 永不外送，数据分级最小必要（spec §10.2）。**M0 必须有一个工具调用可靠的可用模型 + 凭证**（见外部输入），否则跑不起来。
- **最小工具运行时**：`exec_job`（超时/取消/进程组）、HTTP 会话、文件读写；effect 分级 `local_rebuildable`/`retryable_observation`/`protected_effect`；即时 observation 的单调 cursor 与发布 evidence。
- **mock TSecBench adapter**：用固定 SDK 契约喂假平台，验生命周期语义（先不碰真实平台）。
- **单个按需 Challenge Browser**（Playwright/Chromium）：scoped navigation/fetch/WebSocket/download，转题整个 process/profile teardown。
- **state**：SQLite 为唯一 canonical 写入源，run 目录 + artifact store；schema 可演进。
- **`local_oracle` adapter**（spec §5.5）：一个**跑着的**本地靶机（首选一道简单 Web 题）+ typed `candidate.submit`/`challenge.status`，返回权威 accepted/rejected，由 Platform Service 执行并遵守 effect ledger。
- **run 级停止条件**：墙钟 deadline + 步数/预算上限，防止 agent 无限 loop 烧 token（Agent 文字不能延长，spec §4.4）。

**明确后置**
- 三 solver 角色、verifier 独立复核、六条韧性轨迹 → M1。
- 真实 TSecBench、VPN、prepare/start 计时、平台感知 resume → M2。
- 多题调度、≤3 instance、mutation lease/capacity 记账 → M3（且有硬边界）。
- Docker、build identity → M4。

**验收**：① 确定性契约测试套件全过（常设，之后每里程碑都必过）；② 一次冒烟 run：真实模型对本地靶机端到端跑完，产出候选并由 `local_oracle` 判 `accepted`。②只跑 1 次、只证明通路，不作能力门槛。

---

### M1 Solver 循环韧性 —— 证明 agent 会"解题"，不只是"跑一次"

**做什么**
- 引入 spec §6 的自适应职责：`ctf-coordinator` + `web-solver`/`misc-solver`/`crypto-solver` + `ctf-verifier`；session 在有界 `responsibility_set` 内带标签提交，不切 challenge、不冒充 verifier；candidate 验证一律用不同 task + 新 session。
- 按需加载 Skills（Web 会话/源码、编码链、RSA/对称/数学约束、流量/隐写…），各含适用线索、最小试验、失败分支、验证方法。
- 补齐工具：数学计算（Python，SageMath 可选）、结果登记工具（候选 flag 登记/格式检查/证据引用）。
- 假设记录结构（假设 ID/证据/验证动作/预期与实际观察/状态/失败类别/下一步）。
- **仅本地 checkpoint 续跑**：杀进程后能从本地 checkpoint 接上。平台感知的恢复（deadline/进度对账）不在此，属 M2/M3。

**验收**（spec §12.2，`2/3` 规则，不以同一 conversation 的重试冒充独立 run）——六条 loop 轨迹各独立跑 3 次、至少 2 次成功，三次结果全保留：
1. 脚本语法/参数/解析错误 → 同一 solver 读 raw error 局部修正并成功执行。
2. 某机制前提被有效反证 → 保存反证后切换 route，不因沉没成本原样重试。
3. 长作业在 Worker 释放后完成 → 用保存的 handle/cursor 恢复后续步骤。
4. 强制 compaction/新 session 后 → 取回必要原始输出、执行正确下一步，不重跑已否定 fingerprint。
5. Verifier 通过但平台（此处用 `local_oracle`）明确 rejected → 检查提取/编码/slot/假设后继续，而非标 solved 或终止。
6. 多 flag 题得到 partial → 保存 accepted slot 与权威得分，继续求解剩余 slot。

---

### M2 TSecBench 单题 live —— 第一次真正解一道平台题（时钟不可逆）

> 核心约束：TSecBench 任务**限时**，首次 List 调用会**启动平台计时且不可重置**（spec §5.2）。因此命令分两阶段，没准备好绝不起时钟。

**做什么**
- **Python TSecBench SDK 桥接**，固定 `0.1.2`，以源码 + API 文档 + 契约测试为准（不照抄过时 README）：list/start/hint/submit/close，wire contract 按 spec §5.3（多 `container_addr`、nullable description、整数 level、容器状态等待 `available`、`invalid_state` 按操作+列表状态+message 分流、Hint 即使 GET 也按计分副作用）。
- **`ctf-agent prepare`（pre-start admission，不调 Challenges API）**：验本地 state/模型/工具/adapter fixture；验用户已连 VPN；**从实际 Tool Runtime 网络**做 VPN 预检（`GET http://10.0.100.58`，200 且 `status=="ok"`）；验 Token/Base URL 已配为 secret reference 并建不含 secret 的 `task_ref`；冻结 model/scope/预算/介入政策；显示会触发真实计时的 start 预览。
- **`ctf-agent start`（启动计时，一次性 effect）**：发出任何 API bytes 前先持久提交不可改写的 `run_start_intent` + 单调钟 `first_list_started_at` + deadline 计算输入；首次调 List 即视为计时起点；只有本地 anchor 时用保守 deadline 并把 run 限为 dev/live（不产正式计时声明）；dispatch/response/commit 各窗口崩溃都不重写 anchor、不延后 deadline、admission 前不派 solver。
- **权限边界**（结构性、便宜，早定早省）：Platform Service 是平台凭证与副作用唯一持有者；Coordinator 是唯一 submit 发起者；solver/verifier 不能直接提交。
- **平台感知 resume 起步**（spec §9.4 核心）：恢复不延长原 deadline、不重置 Token/instance/Hint 消耗；按平台 List 对账可见进度；旧 job/会话标 lost；`dispatching` protected effect 转 unknown。
- **多 flag 提交编排**：每得到一个可靠候选立即提交并处理结果，再继续找剩余 slot。

**验收**：用户网页创建任务下发 token/base-url/VPN 后，相对 first-List baseline，本 run 的 confirmed Submit（或 clean/exclusive 下无歧义对账）取得**至少一个新 `accepted`**；进度、提交记录、工具证据完整保存。mock 平台契约测试覆盖 spec §12.3（错误码、重复提交、response loss 对账、first-List 各窗口 crash）是 M2 的主体，单题真实 `accepted` 是 capstone。
> ⚠️ 外部依赖风险：VPN 客户端的 macOS/ARM64 可用性尚未验证（spec §15）。若开发机连不上 VPN，M2 的真实提交可能要在能连 VPN 的机器上跑，或 Gate 记 `blocked_external_input` 直到 M4 真机验证网络路径。

---

### M3 多题 portfolio + 韧性 —— 稳定地连续刷题

**做什么**
- **Scheduler**：识别支持能力，标 `unsupported`/`needs_capability`（允许用户覆写）；默认只占一个名额，平台上限 3 活跃 instance；按未完成 flag/预计得分/成本/剩余时间排序。
- **名额/实例守恒**：start/close 对账，切题释放 slot，`cleanup_pending`/`cleanup_failed` 单独记账、不覆盖已获分结论，只清理本 run 拥有的实例。
- **预算**：单题墙钟 + 作业超时 + 可观测 token 用量（来自 OpenCode events，不信模型自报）；硬 deadline 后不再求解/提交，只允许授权 cleanup。
- **fail-stop 完整恢复**（spec §9.4/§12.4）：Supervisor crash 后证明旧 process 树已停才续跑；job response loss 查既有 job；durable watch 只让一个 canonical continuation 续跑（重复 outbox 不重复续）；恢复按 `(evaluation-id, unique-code, matched_flag_index)` 去重，不重复累加 `cumulative_score`。
- **此里程碑才按真实并发需求引入加固，并守硬边界**：因「一个 profile 同时只一个 active run」，**不需要** cross-incarnation/多 owner 机制；mutation 串行**只针对"改同一远端题目状态"的 mutator**（可访问 challenge 网络的 job/channel/http/listener/browser 默认视为 mutation-capable，除非 server 侧证明只读）；capacity/预算**只记 TSecBench 实际需要的维度**（worker/browser/instance slot + submissions/hints），不建通用两阶段账本。

**验收**：多题串行完成；名额不泄漏；预算耗尽/网络故障/进程中断各落正确终态（`budget_exhausted`/`blocked`/`cancelled`/`failed` + 恢复建议）并正确清理；恢复不重复计分、不延长平台时限；真实任务跨题调度、至少一题 `accepted`。

---

### M4 ARM64 镜像交付 —— 在目标机器原生跑

**做什么**
- `ctf-agent:core-arm64` 一键构建（`scripts/build-core-image.sh`）：只用 repository lockfile + 固定 base image digest + 版本化 Reference manifest，打包 OpenCode/plugin/Supervisor/services/Chromium 和通过 ARM64 实测的工具；生成 SBOM/capability manifest；凭证不写 image layer；构建后跑同一套 fixture 契约。
- **网络真机实测**：Ubuntu 宿主 SSLVPN + 容器 host network，doctor 从 Core 实际 Tool Runtime 验 VPN/平台/target 可达（不以"宿主机能开网页"为准）。
- **最小 formal egress**（spec §11.2）：Model Gateway 才连 provider、Platform Service 才连平台控制 API、tool job 只连当前 challenge grants、Challenge Browser 只连自己 grants；公共搜索/registry/其他题/未批准地址对任意 raw curl/socket 不可达。`--init` 回收子进程、浏览器共享内存、非 root 运行、冷启动不下载。
- **此里程碑才按可复现需求引入** build identity / 镜像 digest 记录——只做封装与冷启动冒烟所必需的最小形态。
- Full 镜像的 ARM64 实际构建在此确认；不满足则明确 Core 边界与重型计算替代。

**验收**：原生 Ubuntu ARM64 重跑 M0–M3 契约通过；raw curl/socket/browser 的公共/跨题/平台控制旁路失败；用**独立预登记 task B**（不复用 host 已接受状态）取得至少一个 `accepted`；冷启动无下载；资源需求明确。

---

### M5+ 硬化与正式验收 —— 条件式，按需实施

**做什么**（spec §11.3/§12.1，M5 非全有或全无，不阻塞不依赖它的 run）
- 按目标 formal profile 实际使用的 capability tracks 逐项实施：容器内 VPN/TUN、多 Challenge Browser（独立 UID/profile/slot 预算）、Platform Browser + noVNC handoff、management/data 网络分离与 callback/listener、CTFd/rCTF/未知平台 adapter。每个 track 有独立正向/拒绝测试。
- 自动评测（spec §4.2 后续）：OpenCode SDK + API 模型接入 + 队列 + 总截止 + 收益优先调度。
- **M6 formal 验收**：用户靶场一次性登记 run，pre-start/post-start 两阶段 admission（spec §12.5），按通过率公式判定：有可信难度时 `ceil(easy*60%)` 且 `ceil(medium*30%)`，unknown 子集 `ceil(unknown*45%)`，无可信难度时全部支持题 `ceil(in_scope*45%)`；`candidate_only`/`partial`/未被平台接受不进 numerator；零虚假成功、全部支持题留在分母。

**验收**：每个 selected track 通过其门槛；M6 在可信 identity/计时下产出结果，`candidate_only` 不冒充 `solved`。后续硬化不得改变 Platform Service 唯一凭证/submit、模型数据、硬限额 fail-closed 等产品边界。

---

## 怎么用这份 Roadmap

- **一次只启动一个里程碑。** 启动时用 write-plan 为该里程碑生成 detailed plan（范围仅限它），实现 → 验收 → 合并，再开下一个。确定性契约测试是每个里程碑都必须保持全绿的常设 gate。
- **review 折回当前里程碑的 plan，不折回本文、不动已验收里程碑。** 这样避免旧计划那种"累加累加"。
- 旧单体计划里那些加固细节不是错的，是**错位**——它们是 M3/M4/M5 的内容，需要时去 [archive](archive/2026-10-15-general-ctf-agent-system-implementation.md) 取对应片段。
- **外部输入**（spec §13）缺失时可完成对应代码与 fixture，但 Gate 状态记 `blocked_external_input`，不写成通过：M0 需可用 model/provider 凭证 + host 工具清单；M2/M3 需用户预登记 **task A**（不中断的 host 轨迹）+ Token/Base URL/VPN + 时间基线证据；M4 需**独立 task B** + 原生 ARM64 host；M6 需一次性正式靶场 + 干净账号 + 正式 deadline/budget。缺真实任务不能声称 M2/M3/M4 通过，mock 不能替代正式验收。
