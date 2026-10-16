> ⚪ **已被取代（brainstorm 前身）** · 权威设计见 [`../2026-10-14-general-ctf-agent-system-design.md`](../2026-10-14-general-ctf-agent-system-design.md)，仅作背景保留。

# CTF 解题 Agent 系统设计与交付路线

日期：2026-10-13

状态：设计草案，待用户确认；本文不代表功能已实现或评测已跑通。

## 1. 目标与成功标准

构建用于 CTF 靶场练习的解题 Agent，首批支持 Web、Misc、Crypto，复用成熟 Agent 底座。用户通过终端提供题目、靶机地址或附件，Agent 连续完成题意理解、环境侦查、候选方案、工具试验、利用或求解、结果验证。交付可在 Ubuntu ARM 环境运行的 Docker 镜像。

首版提供交互式单题入口和 TSecBench 题目生命周期对接；后续增加自动选题、排队和无人值守评测。首版的主要闭环是：选择一道题 → 检查运行环境 → 启动或连接题目 → 获得候选 flag → 平台判定 → 保存进度 → 释放题目资源。

建议的首版验收基线：

- 在目标 Ubuntu ARM64 机器原生构建、启动，完成模型工具调用、浏览器和计算工具自检。
- 本地受控样例分别验证 Web、Misc、Crypto 的求解流程和错误结果拒绝流程。
- 使用用户创建的 TSecBench 任务完成至少一道支持范围内题目的真实提交；平台 `correct=true` 才计为通过。
- 覆盖多 flag、部分完成、网络故障、预算耗尽、进程中断恢复和容器清理。
- 记录模型配置、工具版本、耗时、可观测 token 用量、平台分数和终止原因。

具体评测题目和解出率目标需在拿到真实题目列表后确认；平台示例响应不是实际题库。

## 2. 已确认需求与建议选择

### 用户已确认

- 用于 CTF 靶场刷题，首批类别为 Web、Misc、Crypto。
- 复用现有 Agent 系统，不重新开发模型对话循环等底座。
- 第一版交互式单题，后续支持自动找题和作答。
- 首版操作入口为终端 CLI。
- 运行环境为 Ubuntu ARM；具体是否 ARM64、硬件资源尚未确认。
- 题目来源包含在线地址、本地 Docker 靶场和平台对接；首个平台为 TSecBench。
- LLM 未定，考虑百炼 Coding Plan 或按量 API。
- 本地 Chrome 已接入 Playwright MCP 和扩展，当前可阅读 TSecBench 页面。

### 设计者建议，尚待整体确认

- 底座采用 OpenCode。
- 薄启动器及未来会话控制采用 TypeScript；TSecBench 工具桥接采用 Python 官方 SDK。
- 目标架构暂按 `linux/arm64`；镜像以 Ubuntu 24.04 LTS 为基线。
- 同时求解一道题，题内最多两个互不冲突的试验分支；以后再提高并发。
- 首版三类能力均提供基本工具与样例，TSecBench 实测优先选择 Web 类题。
- 提示策略默认 `ask`，并允许显式配置为 `off`；首版不自动购买提示。
- 模型先使用一个支持可靠工具调用的模型，按真实解题结果决定是否引入第二模型。
- VPN 优先在 Ubuntu 宿主机连接；求解容器在 Linux 使用 host network，并从容器内完成网络预检。

### 首版范围边界

TSecBench 旗舰集还包含二进制、多阶段渗透、云攻击等能力。首版不承诺覆盖旗舰集全部题目。调度器识别当前支持能力，显式记录 `unsupported` 或 `needs_capability`，允许用户覆写分类。Web 题中的常见多步骤利用可以支持，复杂二进制和云控制面题留给后续能力扩展。

完整 Web UI、多个平台的后台任务创建、模型训练和通用企业渗透测试报告不作为首版交付目标。

## 3. TSecBench 实际接入契约

### 3.1 已观察事实

2026-10-13 从用户现有 Chrome 标签页读取：

`https://tsecbench.zc.tencent.com/benchmark/prepare/4?mode=local&evaluation_type=agent`

当前选择的 `Tsecbench v1` 显示 63 题、23000 总积分、360 分钟、6 个能力维度和闭卷。该信息仅描述当前选中的评测集，不能当作平台所有任务的固定配置。

平台提供 Prompt、Python SDK 和 API 三种官方接入方案。创建跑分任务后下发 `BENCHMARK_TOKEN`、`BENCHMARK_BASE_URL` 和 SSLVPN 配置。首版由用户在网页创建任务，Agent 使用下发的专用接口执行题目生命周期。

### 3.2 API

所有题目接口通过 HTTP 请求头 `BENCHMARK_TOKEN` 鉴权；不能用网页地址替代任务下发的 Base URL。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/openapi/v1/challenges` | 获取题目及当前作答、实例进度 |
| POST | `/openapi/v1/challenges/start?unique_code=...` | 启动实例，返回地址数组 |
| GET | `/openapi/v1/challenges/hint?unique_code=...` | 获取提示，具有扣分副作用 |
| POST | `/openapi/v1/challenges/submit` | JSON 提交 `unique_code` 与 `flag` |
| POST | `/openapi/v1/challenges/close?unique_code=...` | 关闭实例并释放名额 |

VPN 强制预检地址为 **HTTP** `http://10.0.100.58`，以成功响应中的 `status == "ok"` 判定通过。应从实际执行工具和浏览器的网络环境检测，不能只验证开发电脑或网页可访问。

### 3.3 题目及进度

- 题目主键为 `unique_code`，描述 `description` 可为空，`level` 为整数。
- `container_addr` 为 `IP:端口` 数组，可能不止一个，不能只取第一个或统一假设为 HTTP。
- 容器状态为 `pending`、`available`、`stop_pending`、`stopped`。
- 仅在 `available` 时列表中的地址有效；启动中必须等待就绪。
- `flag_count` 和 `correct_flag_count` 表示多 flag 进度；部分正确提交不等于整题完成。
- 文档列出的列表字段不含可靠的题目类别、附件清单和任务截止时间。类别依据描述与侦查推断，保留置信度；附件由用户提供或从描述、靶场中的明确下载入口取得。
- 提交返回 `correct`、`awarded`、`cumulative_score`、`correct_flag_count`、`total_flag_count`、`matched_flag_index`。
- Flag 长度约束为 1～4096，示例中的 `flag{...}` 不能作为统一正则约束。

### 3.4 平台约束

- 同时最多 3 道活跃题目，调度器默认只占用一个名额。
- Hint 请求会扣减题目得分，即使 HTTP 方法为 GET，也不能作为普通只读查询自动执行。
- 已正确提交的重复 flag 返回 `409 duplicate`，不重复计分。
- 任务有总时限；超时或停止后平台拒绝继续操作。
- 结束、放弃或异常退出时需要关闭本任务拥有的实例。清理失败单独记为 `cleanup_pending`，不覆盖已获分结论。
- 当前协议对平台题目的训练、长期记忆和复用有约束。TSecBench 评测 profile 固定知识版本，不将题目答案或题目特征自动归入长期知识库；通用练习的知识建设使用自行准备的练习题。

### 3.5 SDK 选择与核验

已检查 PyPI `tsec-benchmark` 0.1.2 的包元信息和 wheel 中相关源码：Python >= 3.9，主要依赖 httpx，wheel 为 `py3-none-any`。源码使用 `/openapi/v1/challenges`，与页面 API 文档一致。

PyPI README 中仍有 `/api/v1/challenges`、`level: str` 等旧描述。实现以固定版本源码、平台 API 文档和实际响应契约测试为准，避免照抄过时示例。包为纯 Python 不代表 VPN 客户端或整个工具镜像已验证 ARM64 可运行。

### 3.6 仍需实测

- 任务计时从哪个网页操作开始，以及能否获得准确开始时间、截止时间。
- 下发的 SSLVPN 客户端、协议、ARM64 支持和容器网络兼容性。
- 真正下发的 Base URL、题目响应及实例启动等待行为。
- 实例重新创建后，地址、flag 和已获得的题内状态是否变化。
- 提示成本是否另有可查询字段；现有五个接口未提供足够信息来预先计算具体折扣。

## 4. 系统结构

### 4.1 组成

1. **CLI 启动器**：创建或选择工作目录、加载模型与 profile、检查环境、启动 OpenCode 原生终端交互；未来通过 SDK 启动自动任务。
2. **OpenCode**：负责模型调用循环、会话、原生子 Agent 调用、上下文压缩、文件读写和交互。
3. **CTF 角色与 Skills**：理解题目、提出假设、执行试验、编写求解脚本、解释反馈。
4. **平台 MCP 服务**：封装 TSecBench SDK，保存运行状态、实施平台并发和提示策略、提交和关闭实例。
5. **工具执行服务**：提供有超时和取消能力的命令作业、浏览器、HTTP 会话与文件分析。
6. **持久化**：SQLite 维护状态和提交记录，JSONL 保存事件，文件目录保存产物。

不引入另一套 LLM 工作流框架。确定性的名额管理、作业取消、提交去重等由普通程序处理；解题策略和试验选择由 OpenCode Agent 处理。

### 4.2 首版与后续入口

拟提供以下产品命令，名称可由实现者细化；目前尚不存在这些命令：

- `ctf doctor`：模型、工具、架构、浏览器和平台网络检查。
- `ctf challenges --platform tsecbench`：显示题目、分类建议及进度。
- `ctf solve --platform tsecbench --challenge <unique_code>`：交互求解一题。
- `ctf solve --target <address> --description <text>`：连接用户指定靶场。
- `ctf solve --input <directory>`：附件或本地题目 profile。
- `ctf resume <run-id>`：恢复相同题目和原评测上下文。
- 后续 `ctf benchmark`：按队列逐题运行，使用 OpenCode SDK 与允许自动化场景的模型 API。

手动模式和自动模式使用相同的题目输入、求解角色、工具和结果协议，入口只负责交互与调度差异。

### 4.3 平台工具

向 Agent 暴露结构化工具：`challenge_list`、`challenge_start`、`challenge_status`、`challenge_submit`、`challenge_close`、`challenge_hint`、`run_checkpoint`。

`challenge_status` 从列表接口筛选，属于本地封装，平台没有独立状态接口。Hint 工具依据 profile 决定是否可调用。任务凭证由平台服务读取，工具结果不返回凭证明文。

## 5. 解题编排

### 5.1 角色

| 角色 | 输入与职责 | 必须返回 |
| --- | --- | --- |
| `ctf-coordinator` | 题意、已确认事实、预算、分类和调度 | 阶段、任务分配、决策依据摘要、下一步 |
| `web-solver` | 服务地址、源码或 HTTP/浏览器证据 | 已验证线索、利用脚本、候选 flag、失败结论 |
| `misc-solver` | 附件、编码或流量、媒体数据 | 提取链路、产物、候选 flag、验证依据 |
| `crypto-solver` | 参数、密文、交互协议、已有样本 | 数学关系、算法、求解脚本、约束验证 |
| `ctf-verifier` | 候选结果及对应证据和脚本 | `valid`、`invalid` 或 `inconclusive` 及简短依据 |

首版不增加独立的“每阶段一个 Agent”。领域求解角色承担连续的侦查、假设和试验，减少交接。Verifier 按需调用；简单结果用便宜、确定性的检查，复杂结果再独立复核。平台接受结果是 TSecBench 的最终判据，不要求在提交前重复高成本、会重置环境的完整利用。

每题建立独立主会话；同题分支使用原生子会话及独立产物目录。修改相同靶场状态、登录会话或共享文件的试验串行处理。

### 5.2 状态与循环

主要阶段：`intake` → `preflight` → `recon` → `hypothesize` → `experiment` → `solve` → `verify` → `submit` → `cleanup`。

`experiment`、`solve`、`verify` 可回到 `recon` 或 `hypothesize`。预算耗尽、信息缺失和环境阻塞产生 checkpoint，而不是声称解题成功。多 flag 题在每次获得可靠候选后立即验证和提交，再继续寻找剩余 flag。

每个假设记录：

- 假设 ID、简短内容与证据引用。
- 最小验证动作、预期观察、实际观察。
- 状态：`untested`、`supported`、`rejected`、`inconclusive`。
- 已用时间、试验次数、失败类别和下一动作。

连续两次相同试验没有新证据，必须改变输入、方法或假设。记录可检查的依据与结论，不要求导出模型内部思维链。

### 5.3 最终结果

- `accepted`：平台确认全部 flag 正确。
- `partial`：平台确认部分 flag，仍有剩余目标。
- `locally_verified`：本地规则验证通过，但没有平台确认。
- `budget_exhausted`、`blocked`、`unsupported`、`cancelled`、`failed`：保留原因和恢复建议。

`candidate` 是未验证候选状态，不是成功终态。完成状态与清理状态独立保存。

### 5.4 预算与选题

首版手动选题，单题时间和工具作业预算可配置。墙钟时间和命令超时由运行器执行，角色 `steps` 仅作额外限制。模型用量来自 OpenCode 可观测的 usage/events；具体接口在底座兼容性验证时确定，不把模型自报用量当作事实。

TSecBench 任务截止时间必须来自网页或任务配置；如果接口不提供，由用户输入可靠的剩余时间或截止时间。不能把恢复或启动本地 CLI 的时刻当作 360 分钟重新计时的起点。

未来选题依据支持能力、未完成 flag、预计可得分、预计成本和剩余时间排序。默认低难度且已具备工具的题优先；未知类别先轻量侦查再分类。提示策略不依据未知折扣伪造收益计算。

## 6. 工具能力与可控执行

### 6.1 工具层

- 文件工具：读取、搜索、编辑求解脚本，原始输入保留独立副本。
- 命令作业：`exec_job`、`job_status`、`job_cancel`，参数包含命令、工作目录、超时和输出路径。
- HTTP：会话持久化、请求响应保存、可配置代理、原始响应引用。
- 浏览器：Playwright MCP，页面结构读取、点击、下载、请求响应和截图。
- 数学计算：Python；重型 Crypto 在可用时使用 SageMath。
- 结果工具：候选 flag 登记、格式与长度检查、证据引用、平台提交。

作业返回 `status`、`exit_code`、`duration_ms`、输出摘要和文件引用。长输出完整存盘，向模型返回有限摘要及检索入口。长任务可以持续获取局部输出，取消时终止进程组。

工具时间和作业数量限制必须通过执行服务实现。若角色仍有不受控的直接 bash 通道，这些限制只能是软约束；需要硬约束的 profile 关闭该通道并统一走作业工具。资源限制由部署参数和实际进程运行环境实施，不声称提示词即可限制任意脚本。

### 6.2 首批工具与扩展镜像

| 类别 | Core 工具 | Full 扩展 |
| --- | --- | --- |
| Web | curl、httpx/requests、Playwright/Chromium、nmap、ffuf、sqlmap | 按代表题需要添加，不预装整套发行版 |
| Misc | file、strings、xxd、7-Zip、ExifTool、tshark、Pillow、FFmpeg、zbar | binwalk 及其提取依赖、特定隐写工具 |
| Crypto | PyCryptodome、SymPy、gmpy2、Z3、OpenSSL | SageMath、格相关依赖 |
| 通用 | Python、Node.js、Git、编译工具、ripgrep、jq | 大型字典和特定工具包 |

每个工具有 manifest：版本、安装方式、架构、健康检查、输出格式和典型耗时。按功能验证工具，而非仅检查 `--version`。第一阶段确认 Full 的 ARM64 构建路线和资源成本，无法满足时明确保留 Core 支持边界与重型计算替代环境。

### 6.3 Skills

按需加载 Web 会话与源码分析、接口与输入试验、流量分析、媒体隐写、编码链、RSA/对称密码/数学约束等技能。每份技能定义适用线索、最小试验、失败分支和验证方法。主提示词保留通用闭环，TSecBench 细节只出现在平台 profile 和工具桥接层。

## 7. 状态、产物与恢复

### 7.1 目录

`runs/<evaluation-id>/<unique-code>/<run-id>/` 下保存：

- `challenge.json`：标准化输入、原始平台快照、全部目标地址和分类置信度。
- `state.json`：SQLite 状态的可读导出，包含阶段、预算、会话引用、阻塞原因。
- `events.jsonl`：事件日志，引用工具调用和产物。
- `input/`、`artifacts/`、`branches/`、`scripts/`：输入、证据、分支和脚本。
- `result.json`：候选、验证结论、平台反馈、得分及清理状态。
- 本地通用练习可输出 `writeup.md`；TSecBench 的持久化和导出按该任务规则配置，不产生跨轮题目答案知识库。

SQLite 是运行状态、实例所有权、候选去重、已确认 flag 索引和提交记录的唯一写入源；JSON 文件用于查看与导出。子 Agent 通过工具提交状态变更，避免并发写同一个状态文件。

### 7.2 恢复顺序

1. 读取评测上下文、原截止时间和本地 checkpoint。
2. 从当前实际容器执行 VPN 预检。
3. 拉取平台题目及进度，优先接受平台已经完成或已经提交的事实。
4. 对比实例状态和地址；运行环境改变时使旧 HTTP/浏览器会话和缓存假设失效。
5. 恢复原 OpenCode 会话或基于已确认事实创建新会话。
6. 继续剩余 flag；已过期任务结束，待清理事项明确记账。

收到 start 请求超时先同步列表，区分已经启动、启动中和未启动；不盲目重复启动。Submit 响应丢失可重试相同候选并处理 `duplicate`，再同步计数。具体重复 start/close 行为在契约测试中确认。

### 7.3 得分与计数

按 `(evaluation-id, unique-code, matched_flag_index)` 保存已确认结果；累计分数作为快照更新，不把每次 `cumulative_score` 相加。`awarded` 只对新确认的提交计入增量。

题目列表能同步 flag 计数，但没有已获累计分数字段。如果本地提交历史缺失，历史得分标为未知，不能用正确 flag 数乘满分推断提示扣分后的真实成绩。

### 7.4 失败处置

| 情况 | 处理 |
| --- | --- |
| VPN 预检失败 | `blocked_network`，不启动题目；修复网络后继续 |
| `task_not_found` | 停止该评测，检查任务凭证 |
| `challenge_not_found` | 标记题目配置错误并重新同步列表 |
| `invalid_state` | 结合操作和 message/detail 区分超时、满名额、已通关取提示；不能统一当作超时 |
| `duplicate` | 同步本题进度，不重复计分 |
| `resource_unavailable` | 有限退避重试；持续失败留存资源阻塞并换题或暂停 |
| 500 或传输错误 | 有限重试；涉及副作用先对账 |
| 422 | 修正参数；不对相同错误请求循环重试 |
| 工具超时或脚本错误 | 记录环境/代码故障，不直接否定漏洞或数学假设 |
| 候选 flag 不正确 | 记录平台判定并回到求解，避免重复提交相同错误候选 |

清理只作用于本运行器明确拥有的实例。发现其他交互会话占用名额时报告，不任意关闭其题目。

## 8. Docker 与网络

### 8.1 打包

- `ctf-agent:core-arm64`：OpenCode、CLI、平台桥接、常用工具、Chromium。
- `ctf-agent:full-arm64`：增加经过 ARM64 实测的重型 Crypto/Misc 工具。
- 锁定 OpenCode、SDK、插件、Playwright 和工具版本，验证相互兼容。生产镜像不依赖启动时下载 latest。
- 持久化工作目录和 OpenCode 会话目录；模型凭证、平台凭证在运行时注入，不写入镜像或事件输出。
- `--init` 处理子进程回收；浏览器配置足够共享内存；普通工具以非 root 运行。
- Python 环境和 SageMath 环境分别锁定，避免数学栈影响平台 SDK 和常用脚本依赖。

### 8.2 网络方案

首选 Ubuntu 宿主机连接下发的 SSLVPN，Agent 容器用 host network 访问路由。该方案需要在目标机器实测，不以“宿主机能打开网页”作为通过标准。

如果官方 VPN 不能在 ARM64 宿主机运行，备选为独立 VPN 网关或经过验证的 VPN 服务容器；客户端选择取决于实际下发配置，不能直接假设可用 OpenVPN 或 WireGuard。

同一运行环境需要同时访问模型 API、平台 API和 VPN 内靶机。代理配置对模型公网请求和靶机直连分别处理；VPN 健康地址与靶机地址不得误走外部代理。检查 VPN 私网与 Docker 网络地址冲突。

本地 Docker 靶场由宿主机或 Compose 启动，按发布端口或专用网络地址连接。题目镜像本身的架构单独验证；Agent 为 ARM64 不保证任意第三方 amd64 靶场能原生运行。

### 8.3 浏览器接入

开发阶段使用本地 Chrome 扩展阅读平台配置和文档。Ubuntu 容器默认使用容器内独立 Chromium 访问靶机，该浏览器与命令工具共享已经验证的网络。浏览器初次接入不自动复用开发电脑的 Chrome 登录状态。

后续确有远程人工接管需求时增加宿主机浏览器桥接；首版平台题目接口使用专用 Token，不依赖常驻平台登录标签页。

## 9. 模型与知识策略

先验证一个模型的工具调用、结构化结果、脚本修改、多轮失败恢复和上下文压缩。`solver`、`reasoner`、`vision` 是配置角色，可以映射到同一个实际模型。

交互式 OpenCode 接入可根据百炼当前支持范围使用 Coding Plan；后续自定义后台和无人值守批量评测采用允许自动化使用的按量 API。两类接入配置显式分开，不混用 Base URL 或凭证。

模型评估使用自建或允许练习的固定题组，统计每类解出率、误报成功率、耗时和成本。正式评测记录模型精确 ID、温度/推理配置、工具和知识版本；不跨轮注入 TSecBench 答案或题目经验。闭卷标签的具体外部检索规则尚需核实，正式评测 profile 默认不启用答案检索。

## 10. 交付里程碑

以下是设计层路线；用户确认整体设计后，再拆成具体文件、任务和实现验证命令。

| 阶段 | 交付物 | 验收门槛 |
| --- | --- | --- |
| M0 底座与网络可行性 | 固定版 OpenCode、模型工具调用、ARM64 工具清单、VPN 路线 | 真机容器内 VPN 预检、浏览器和 Python/数学能力通过；明确 Full 构建路线 |
| M1 平台契约 | TSecBench SDK 桥接、题目规范化、模拟平台测试、doctor | 五个接口参数/返回正确，多 flag/错误码/提示策略通过 |
| M2 单题编排 | 角色、Skills、假设试验、作业取消、checkpoint | 本地三类代表题求解；错误候选不标成功；中断可恢复 |
| M3 实际平台闭环 | 用户下发任务的一题运行、候选提交、清理记录 | 至少一题平台确认成功，完整保存进度和工具证据 |
| M4 镜像交付 | core/full 构建目标、锁定依赖、运行与网络说明 | Ubuntu ARM64 从干净环境启动并通过冒烟检查；明确资源需求 |
| M5 自动评测 | API 模型接入、队列、总截止时间、收益优先调度 | 多题串行完成；名额守恒；恢复不重计分；超时结束并清理 |

Full 镜像可行性在 M0 提前核验；主要求解闭环不等待所有可选工具安装完成。真实任务的计时启动安排在环境准备完成后，具体动作以平台实测为准。

## 11. 验证重点

平台桥接和恢复逻辑需要有意义的契约测试，覆盖：

- nullable 描述、整数 level、多地址、启动中与停止中。
- VPN 预检失败时不继续平台作业。
- 两个及以上 flag，重复提交，响应丢失后的对账。
- 同一种 `invalid_state` 错误码的不同场景。
- 提示策略和扣分状态，避免误调用有副作用的 GET。
- 启动/提交/关闭超时，进程退出，恢复不重复计分。
- 取消命令进程组、模型会话中止和清理失败记录。
- 原截止时间保留；恢复不延长平台任务时限。
- 子任务写入、实例所有权和并发名额。

自建代表题验证真实求解能力；Mock 平台验证生命周期语义；TSecBench 小范围实测验证真实契约。三者分别有独立通过标准，避免把 Mock 成功当作解题成功。

## 12. 实施前需要补齐的信息

1. **首版成功目标**：按本设计的“三类基本能力 + TSecBench Web 优先 + 单题闭环”交付，还是希望优先冲旗舰集得分；后者会影响能力扩展和交付顺序。
2. **目标机器**：ARM64/ARM32、Ubuntu 版本、CPU、RAM、磁盘，决定 Full 和工具并发配置。
3. **VPN 实际配置**：客户端名称、架构支持、配置方式，决定宿主机连接或网关方案。
4. **模型接入**：当前已有凭证和首个候选模型；M0 可使用用户允许的临时模型，最终由固定题组结果选择。
5. **评测配置**：任务创建与计时、实际题目字段、平台更具体的闭卷规则；取得配置后以小范围实测确认。

其中机器、VPN、模型配置可作为 M0 的输入收集；当前最需要确认的是首版能力范围和成功标准。

## 13. 证据与参考

- TSecBench 页面和页面内 Prompt、SDK、API 文档、用户协议：2026-10-13 通过用户 Chrome 已登录标签页阅读。
- TSecBench PyPI 元信息：<https://pypi.org/pypi/tsec-benchmark/json>。
- SDK 0.1.2 wheel 中的 `tsec_benchmark/client.py` 与 `models.py`：仅在内存中读取核验，未安装依赖。
- OpenCode Agents：<https://opencode.ai/docs/agents/>。
- OpenCode SDK：<https://opencode.ai/docs/sdk/>。
- OpenCode MCP：<https://opencode.ai/docs/mcp-servers/>。
- Playwright 扩展：<https://github.com/microsoft/playwright/tree/main/packages/extension>。
- 百炼 OpenCode 接入：<https://help.aliyun.com/zh/model-studio/opencode>。
- Coding Plan：<https://help.aliyun.com/zh/model-studio/coding-plan>。

目前尚未创建新评测任务、连接任务 VPN、调用题目生命周期接口或验证真实题库解出率；这些验证属于上述后续里程碑。
