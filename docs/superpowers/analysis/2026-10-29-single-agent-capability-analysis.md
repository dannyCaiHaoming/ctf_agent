# 单个解题 Agent 的能力缺口分析

日期：2026-10-29（Asia/Tokyo）。状态：**研究输入，不是设计决策或实施计划。** 范围为 Recon／Domain Solver 自己能观察、操作、计算和读取结果的能力；不增加角色，不重做编排。本文仅依据当前工作树源码、角色定义和指定设计文档作静态分析，未读仓库外 run-data，未运行 git、构建、测试、模型或靶场。历史运行数字为设计文档转述，未重新统计。

## 1. 判断起点：已有执行能力，缺少更省往返的操作面

当前单个 Agent 已能读材料、写脚本、执行本地程序、维护 HTTP 登录会话、取得并发布固定证据。r7 已取得 admin、SSTI 和 RCE；它的失败不能归为“没有攻击工具”。优先研究的问题是：**怎样让一次工具交互提供更多与当前假设有关的有效观察，同时让已有线索更容易转为具体实验。** 更快的盲目枚举可能更快耗尽预算，不等于解题改善。

### 1.1 运行证据与口径

| 证据 | 本文可据此判断 | 不能据此判断 |
| --- | --- | --- |
| r4 约 22.5 分钟、317 次调用、reported observable tokens 1217922，最终 candidate_only；首包约 14.12 分钟，第二包 19.57 分钟，最终报告 21.98 分钟。[方法论 §1](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#1-问题背景与证据) | 工具／模型交互和候选后处理有可观成本 | 317 不是纯 HTTP 数；后处理耗时不是单个 Solver 的全部浪费；candidate_only 不是 solved |
| r6 约 24.8 分钟才首次发布，30 分钟 deadline；同步 execution 缺失导致 11 次发布拒绝，已另行修复。[迁移记录 §0.2](../specs/2026-10-22-ctf-agent-current-state-and-migration.md#02-真實運行的已知結果r6-修復與-r7-未解分開記錄) | 除同步发布缺陷外，首次有效交付仍存在效率问题 | 不把已修复的发布阻塞列作新的单 Agent 工具需求；文档未给出 r6 可比的完整工具往返细分 |
| r7 全 run 108 次 HTTP，Domain Solver 其中 78 次，另有几十次搜索；Domain Solver 109 次模型准入，30 分钟 deadline。[方法论 §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序20261028r7-驱动参考外部-ctf-agent-设计)、[路线优先级 §1](../specs/2026-10-28-design-v1-b-evidence-to-action-route-priority.md#1-唯一目标与原始问题) | 往返成本值得优先调查；108 是全 run，不能写成单个 Solver 的 HTTP 数 | 调用数不直接等于浪费或可节省量；109 次准入不是 109 次 HTTP |
| r7 已有 Recon 路线线索和 RCE，却未请求 `/admin/chal/delete`，末段约 20 分钟搜索文件／env／DB；无 Engineer／Verifier／裁判链。[路线优先级 §1](../specs/2026-10-28-design-v1-b-evidence-to-action-route-priority.md#1-唯一目标与原始问题) | 主失败是证据到行动的缺口，不是 Recon 完全没发现，也不是尚缺 RCE | 不证明新增路由工具就能纠正模型选择 |
| 同一设计记录 r6 已观察到“登录→建 challenge→删 challenge，响应 26 bytes 即 flag”；flag 由动作产生，不是静态文件。[同上](../specs/2026-10-28-design-v1-b-evidence-to-action-route-priority.md#1-唯一目标与原始问题) | 观察能力必须覆盖业务动作响应及状态变化，不能只优化找文件 | 动作得到候选不代表 r6 完成可信提交；不能把这条已知解法注入以后自主运行 |

r4 的细查是重要反例：同参数 GET 有时是在不同写入后观察结果，有时页面壳相同而业务列表 POST 才有新事实。不能按相同 fingerprint 自动去重，更不能直接删除状态检查。见[方法论 §1.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#12-2026-10-27-有界观察链与归因结果已复核)。

### 1.2 A+D 已处理什么，尚未证明什么

[线索帐本 §7](../specs/2026-10-28-design-v1-b-lead-ledger-convergence.md#7-实现结果20261028候选-a-已落地)的 A 已落地：Coordinator 在原生 task 分派／恢复文字中带入未测线索、来源 ref、低成本测法，Solver 回报 tested／untested／refuted。[路线复核 §5.7](../specs/2026-10-25-design-v1-negative-evidence-and-route-review.md#57-实现结果2026-10-28候选-d-已落地)的 D 已落地：按问题与停止条件有界交回，在原交回边界评估停滞。

这里 A、D 是收敛候选编号。两者均为 **prompt 改动**；没有结构化宿主线索库，没有每步自动注入或强制执行，也没有执行中唤醒父会话的机制。“自动注入”仍依赖 Coordinator 按提示生成 task 内容。当前四份角色文件与实现结果相符，文档开头的旧“待实施”状态不能覆盖后面的 §7／§5.7。

因此，证据到行动问题已有针对性改动，**行为修复尚待 r8**。本分析不再把“加线索帐本”“多叫 Critic”“强制每步读计划”列为待新增单 Agent 能力。背景 task 不会在子任务执行中自动唤醒父会话；不得把背景分派当作监控能力，见[路线复核 §5.6](../specs/2026-10-25-design-v1-negative-evidence-and-route-review.md#56-只读可行性结论2026-10-28未改产品未运行模型)。

## 2. 当前单个 Agent 能做什么

下表是静态接口事实，不代表本次执行验证。源码链接指向实现，函数名用于定位；补读插件 schema 是为了区分内部能力和真正暴露给模型的参数。

| 能力面 | 当前可用能力与边界 | 依据 |
| --- | --- | --- |
| 文件与脚本 | `workspace.list/read/search/write`；materials、会话私有 work、同题 published 三根；仅 work 可写，单次写入上限 1 MiB，支持 UTF-8／base64。文本按 32 KiB 续读。搜索是单 needle 的逐行字面匹配，跳过大于 1 MiB 和非文本文件，最多 200 项／32 KiB，每项仅行首 200 字符。目录 listing 最多 500 项。没有搜索续页、上下文窗口或多 needle 参数 | [workspace-tools.ts](../../../apps/launcher/src/workspace-tools.ts)：`readWorkspace`、`searchWorkspace`、`writeWorkspace` |
| 二进制 | 能写 base64、用 job 处理二进制、发布及 base64 读取固定 artifact；但普通 workspace.read 遇二进制只返回前 8 bytes 签名，不能直接按页查看任意二进制内容。不能说“完全没有二进制能力” | [file-page.ts](../../../apps/launcher/src/file-page.ts)：`filePage`；[artifact-tools.ts](../../../apps/launcher/src/artifact-tools.ts)：`read` |
| HTTP 与会话 | GET／HEAD／POST／PUT／PATCH／DELETE／OPTIONS，headers、文本或 base64 body，同题共享、按 origin 存储的简化 CookieJar；受控同 origin 重定向、DNS 地址绑定、超时／取消。请求 body 上限 64 KiB；保存响应 body 最多 1 MiB，首 2 KiB preview，返回保存路径、状态、headers、redirectChain 和截断标志。绑定 execution 时还返回可发布的 resource | [http-tools.ts](../../../apps/launcher/src/http-tools.ts)：`CookieJar`、`request`、`finish`；[control-service.ts](../../../apps/launcher/src/control-service.ts)：`prepareSolver` |
| HTTP 局限 | 每次一个请求；没有批量对照、结构化表单／JSON 提取、响应差异视图或可选择的多身份会话句柄。CookieJar 不是完整浏览器会话实现；共享 jar 使重复请求的前提未必相同 | 同上；[插件 schema](../../../apps/opencode-plugin/src/index.ts)：`http.request` |
| 本地计算与作业 | `job.run/read/cancel` 执行 argv，能运行已有解释器／程序、处理附件、试验脚本并修错。固定 cwd 和环境白名单；进程组取消、真实终态、stdout／stderr 分离；每流保留最多 1 MiB，32 KiB base64 续读。每 session 最多 2 个活动 job、每题 8 个，timeout 最长 600 秒且受生命周期约束 | [job-tools.ts](../../../apps/launcher/src/job-tools.ts)：`JobManager`；[control-service.ts](../../../apps/launcher/src/control-service.ts)：`waitLimit`、`prepareSolver` |
| 作业局限 | stdin 为 ignore，无 PTY、持续输入或受管 TCP 连接。底层有 `wait_ms`，但公开 `job.run` schema 不暴露它，正常模型调用在同一次 RPC 等终态；不应把内部异步代码写成已交付的交互终端。argv 直接 spawn 不自动经 shell，也不等于命令白名单或全面 OS／网络隔离 | [job-tools.ts](../../../apps/launcher/src/job-tools.ts)：`run`、`checkArgv`；[插件 schema](../../../apps/opencode-plugin/src/index.ts)：`job.run` |
| 固定证据 | 自己的文件、已收束 job 流、HTTP resource 可发布；host 填身份、hash、byte 区间及完整性；同题 artifact 可读。不可把私有 work 路径当跨角色证据。HTTP 来源事实含 method/status/origin/content-type，但 path 特意省略，不为业务成功背书 | [artifact-tools.ts](../../../apps/launcher/src/artifact-tools.ts)：`ArtifactPublisher`、`HttpResponseFacts`；[control-service.ts](../../../apps/launcher/src/control-service.ts)：`artifact.publish` 分支 |
| 方法和角色权限 | 原生 skill 可按需加载，原生 read 限固定 Skill 根；单个 Solver 没有原生 task 分派权，不能调用 progress.read/note，不可固定候选包、签署验证或提交。Recon 交基线，Domain Solver 做实验与候选，均能用上述 workspace／HTTP／job／artifact | [control-service.ts](../../../apps/launcher/src/control-service.ts)：`NATIVE_TOOL_ROLES`、`checkReadPath`、`checkProgress`、`checkSolver`；[Recon](../../../product/opencode/agents/recon.md)、[Domain Solver](../../../product/opencode/agents/domain-solver.md) |
| 控制与交接 | host 绑定 run／session／challenge／execution，核对角色、预算、deadline、停止和资源终态；Coordinator 组织与决定，Critic 只建议。模型自述不修改 solved | [control-service.ts](../../../apps/launcher/src/control-service.ts)：`admit`、`prepareSolver`；[Coordinator](../../../product/opencode/agents/coordinator.md)、[Recovery Critic](../../../product/opencode/agents/recovery-critic.md) |

**环境能力不能从 argv 推定。** 本次未探测预装软件，不能宣称 Python 数学库、解包器、调试器、浏览器或特定 ARM64 工具已可用。脚本可表达某项操作，也不意味着其出口已受 HTTP 工具同等控制；现有限制见[迁移记录 §0.3](../specs/2026-10-22-ctf-agent-current-state-and-migration.md#03-仍未驗證保留的缺口)。

## 3. 外部方法启发：训练知识，未经本次来源核实

**本节按用户要求使用训练知识，可能存在版本、术语或细节偏差，后续引用或设计采用前需查原论文／官方实现。** 本次未浏览外部来源，不提供未经核实的数字或性能比较。这些启发不是本项目缺陷的运行证据，也不表示某系统整体优于当前项目。

| 系统 | 训练知识中的相关思路 | 对单个 Agent 可借鉴的操作能力；不可直接推出什么 |
| --- | --- | --- |
| EnIGMA | 强调面向 Agent 的交互接口（ACI）、交互式工具，以及长输出的 summarizer | 研究能保留进程／连接状态的交互入口，以及有原文可追溯的紧凑输出。这里优先考虑确定性提取和差异视图，不照搬独立模型摘要循环；不能断言这些组件单独提高本项目成功率 |
| PentestGPT | Pentesting Task Tree（PTT）外显任务与推进状态，缓解长程遗忘 | 对本项目最直接的启发已由 A 的未测线索交接承接；不再建另一棵树或 planner。尚可研究“线索旁边直接给可操作的请求事实”，而不是只保存描述 |
| Cybench | 子任务分解／中间目标可用于研究 Agent 在复杂 CTF 链条上的能力 | 可借鉴单 Agent 的可检验中间问题与有界实验。基准提供的子任务或提示不等于 Agent 自主发现了分解；不能把带提示结果当作无提示全题能力，也不据此新建子 Agent |
| D-CIPHER | 训练记忆中的重点偏向分解复杂 CTF 工作、探索与执行协作；具体组件与收益归因待原文核实 | 仅借鉴将局部问题交给可执行脚本、携带输入／输出／状态的操作方式；本项目已有 job 和 artifact。没有足够把握把某种专用工具或“交接损耗”认定为其论文结论，不用它论证更多角色 |

外部启发可以帮助提出候选；排名仍以本仓库实际暴露面、r4／r6／r7 的已记录问题及新增复杂度为主。

## 4. 能力缺口排名

成本是相对工程量，不是工期承诺：低＝现有参数／返回的局部扩展或少量固定辅助程序；中＝跨插件与 host 的工具增量；高＝新增持续资源生命周期及隔离集成。每项均为可讨论候选，不意味着现在实施。

### 1）有界 HTTP 批量对照：减少已知实验的串行模型往返

- **缺口与证据：** 当前只能单请求调用。r7 全 run 108 次、Solver 78 次 HTTP，[方法论 §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序20261028r7-驱动参考外部-ctf-agent-设计)已指出强原语的研究价值。r4 的状态实验说明应保留必要的“写入→观察”，而不是一律删除重复 GET。尚不能从总数确定可批处理比例。
- **候选新增能力：** 在现有 HTTP 面支持一个小规模、模型明确列出的请求组，返回按项关联的状态、耗时、响应 resource、截断与错误；对无依赖的对照请求有界并行，对同一会话的写入／观察明确顺序。初版不跨越需要模型理解新响应才能决定的边界：例如先读回新对象标识，再决定下一组，避免自建变量语言或通用工作流 DSL。遇到异常或副作用结果未知保留部分完成，不整组盲重试。
- **约束适配：** 每项复用现有 origin／DNS／redirect／CookieJar、执行身份、审计、配额、取消和 deadline 检查；批次不是一次调用额度下的无限网络循环。模型仍在 OpenCode 内选择实验、解释结果。不能用 Python 直连绕过 host HTTP 的 scope 与证据记录来代替。
- **成本：** host 工具＋插件 schema，中；不是再写一句“批量实验”即可。首片可只比较明确独立请求，不预建扫描器或 payload／wordlist 库。
- **r8 依赖：** 接口缺口不依赖 r8；实施优先级部分依赖。若 A+D 已让同题快速取得候选，则重新估算可节省的实际往返，可能下调；若正确路线仍需大量微小请求交互，优先级提高。若仍在错误路线发散，批量化不能作为根因修复。

### 2）可追溯的输出提取与差异视图：降低读回和比较成本

- **缺口与证据：** HTTP 已保存正文、给 preview 和完整性信息，job 已区分 stdout／stderr，不能再提“补完整输出保存”。真正缺的是从已有内容中低成本取关键部分：HTTP preview 仅 2 KiB，job.run 主要返回终态，搜索只有单 needle、200 字符行首摘录；命中发生在长行后部时摘录甚至可能不含命中词。r4 有 9643 B 的相同页面壳和额外业务列表请求，见[方法论 §1.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#12-2026-10-27-有界观察链与归因结果已复核)。
- **候选新增能力：** 优先扩现有 read/search 返回面：多字面词一次搜索、命中邻近上下文、可续读定位；对两个已保存响应／artifact 做 bounded diff，给状态／长度／内容差异及原 byte 区间；按需对 JSON 字段、HTML 表单和 job stdout／stderr 提供确定性提取。job 终态可附有界双流摘录，减少“结束后再分别读两次”。搜索同时交代跳过的大文件／二进制和覆盖范围，不能让空结果暗示全面不存在。
- **约束适配：** 以现有 bodyPath／job／ref 为输入，不重发目标请求；原始内容和截断／unknown 保留。差异是观察，不自动判漏洞、业务成功或路线已否定。摘要不代替发布原 bytes，不扩大 Coordinator／Critic 的原文权限；不引入独立 summarizer Agent 或模型压缩循环。与 EnIGMA 的输出处理仅作启发对照。
- **成本：** 局部 host 返回／读取扩展，低至中；先选最常见的一种读回负担，不必一次实现所有解析格式。一次性复杂解析已可用 job，不需要单独工具包装每一种格式。
- **r8 依赖：** 当前易用性缺口不依赖 r8；收益大小和先做哪项需结合 r8 的读回负担。若调用已很少且模型能直接处理结果，可降级；不得把旧 r4 页面壳问题假定为 r8 仍在发生。

### 3）源码／页面到请求动作的定位辅助：让线索更容易执行

- **缺口与证据：** workspace.search 是文本匹配，没有 action、method、参数、handler 和来源位置的关联视图。r7 未测 Recon 已发现的路由，且 flag 是动作响应产生，见[路线优先级 §1](../specs/2026-10-28-design-v1-b-evidence-to-action-route-priority.md#1-唯一目标与原始问题)。**r7 的路由发现本身已成功；本项是减少消费线索的成本，不是认定当时缺少路由发现工具。**
- **候选新增能力：** 对本题已取得的 HTML／脚本／源码做一次有界提取，列出可见表单 action、请求 method、字段名、调用位置和附近 handler 候选；每项附来源路径／ref／行或 byte 范围，动态构造或缺字段标 unknown。可将已观察的请求与源码引用并排展示，供 Solver 选择最低成本实验；动作返回的短响应和业务后置条件应成为可读取对象，不只生成“待找 flag 文件”清单。
- **约束适配：** 仅处理已有授权材料，不联网取框架源码，不猜路由字典、不自动执行动作。初片可复用 job 跑已审核的静态提取器；host 只返回机械匹配及来源，模型判断语义。结果进入 A 已有线索交接，不另建图数据库、知识库、planner 或强制行动 gate。发布 HTTP 事实当前省略 path，辅助视图不能冒充 host 已认证的 endpoint 身份。
- **成本：** 固定辅助程序＋现有 job 可先覆盖，低至中；若重复使用价值足够，再考虑轻量 host 工具，中。复杂多框架静态分析成本高，不在候选最小范围。
- **r8 依赖：** 强依赖。若 A+D 已让现有线索被及时测试，本项主要价值转为跨题 Recon 效率，排序可下降；若线索存在但实际组请求仍反复读源码、漏参数，价值提高。若参数齐全仍选择不测，属于行为问题，不能用新提取器冒充解决。

### 4）交互式进程／连接：补上现有 job 无法自然表达的操作

- **缺口与证据：** `JobManager.run` 的 stdin 为 ignore，公开 schema 同次等终态；没有 PTY 或受管 TCP 的持续读写。设计明确将 PTY／TCP 区分为不同能力，见[核心设计 §1.5／G](../specs/2026-10-22-ctf-agent-design-v1.md)。因此对需要逐步输入、观察提示、继续会话的程序／协议存在真实接口缺口；**没有证据表明 r4／r6／r7 被此阻塞**。
- **候选新增能力：** 按出现的题型先选一种：受管本地交互进程的 start／send／read／close，或绑定授权 endpoint 的 TCP connect／send／read／close；增量输出带游标、超时、EOF 和取消状态。已有 job 足以运行的批量计算不改用 PTY。持久 Python／调试器会话只是可用场景，不是当前已验证需求。
- **约束适配：** 由 host 绑定句柄、session／challenge／实例，保留共享预算、停止、输出限额与来源证据；模型交互仍走 OpenCode 工具循环。TCP 需真实出口限制，PTY 不能以“本地终端”为由放开网络；不通过共享宿主 shell 或新 provider 循环补洞。
- **成本：** host 工具，高；新增长期资源、取消和隔离行为。EnIGMA 的交互 ACI 是训练知识启发，不是本项目成功证据。
- **r8 依赖：** 不依赖 r8 来证明接口缺口，也不因 Web r8 成功而关闭；优先级由下一批授权题是否需要交互决定。仅为当前 Throwback 改善时排在前三项之后。

### 5）二进制／归档检查与预装计算工具的可发现性

- **缺口与证据：** 普通 workspace.read 对二进制只给签名，搜索跳过二进制／大文件；job 可补偿，但模型需自己写检查脚本并假定依赖。首批 Domain Solver 范围含 Misc／Crypto，核心设计 §1.5 要求二进制／归档与按需预装工具。缺口有接口依据，**当前三次 Web run 不提供它导致失败的证据**。
- **候选新增能力：** 有界 hex／strings／byte-range 读取、归档目录检查和解包至 work；提供本轮固定工具版本与可用性的短清单，使 Agent 知道哪些解释器、数学／符号求解和文件分析程序真实存在。已有 job 能完成的确定性计算优先继续使用 job；具体依赖由题类需求选择，不能一口气装全套工具箱。
- **约束适配：** 复用 workspace 路径和 job 管理；归档条目不越界、不进入 OpenCode 配置根，并限制展开量。依赖在 run 外固定准备，清单由程序探测生成，不让模型编造；不建工具发现平台或运行中下载安装器。
- **成本：** byte-range／清单低至中，安全解包及具体 ARM64 依赖验证中；不是 prompt 就能提供缺失程序。
- **r8 依赖：** 不依赖同题 Web r8；依据后续 Misc／Crypto 附件任务决定排序。r8 通过不能证明附件处理能力。

### 6）必要时的浏览器观察与动作

- **缺口与证据：** 当前 HTTP 不执行 JS，不观察 DOM／画面，没有浏览器事件、动态请求捕获和 profile；[迁移记录 §0.3](../specs/2026-10-22-ctf-agent-current-state-and-migration.md#03-仍未驗證保留的缺口)仍列浏览器为按题需要的缺口。r7 已能通过 HTTP 取得操作能力，未证明必须有浏览器。
- **候选新增能力：** 对确需 JS 的题，提供最小导航、DOM／画面观察、输入／点击和本题网络记录，导出决定性响应或下载文件到现有证据通道。优先复用预装 Playwright／Chromium，不自建浏览器引擎。
- **约束适配：** 每题隔离 profile；导航、子请求、WebSocket 和下载均受实际 scope 限制，不能只检查顶层 URL。工具仍通过 OpenCode 调用；不得携带控制凭据，不将浏览器访问公共资料当作题目请求。
- **成本：** host 适配、依赖和隔离，高。浏览器能减少手工还原前端交互，但也带来状态复杂度，不默认替换简单 HTTP。
- **r8 依赖：** 当前 Web r8 不能单独决定此项；只有实际 JS／交互阻塞时上调。不能用“有浏览器可能看见按钮”解释 r7 已有路由却不测的根因。

### 7）精准的方法入口：小幅改善可发现性，不扩知识量

- **缺口与证据：** r4 Solver／Critic 曾成功加载 Skill，r7 全 run 0 次；已有方法中也已有可证伪实验和业务后置条件。见[路线优先级 §2](../specs/2026-10-28-design-v1-b-evidence-to-action-route-priority.md#2-分层缺口与一个硬张力关键未知先判层再修)。这是“何时使用”的候选缺口，不证明缺知识，也不能说多写 Skill 必然有用。
- **候选新增能力：** 仅在确认现有 description 无法表达适用情境时，补短触发描述或指向现有 Reference 的入口，例如需要解释输入到业务效果时。保留按需读取；不把 Throwback 路由、字段、payload 或答案变成产品提示，不再重复 A+D 已加入的先测线索／有界交回。
- **约束适配：** 沿用原生 skill/read 和固定离线资产，不增角色、检索服务、漏洞百科或默认全文预载；知识正确性在 run 外核实。
- **成本：** prompt／metadata，低；若 r8 没有相关缺口，新增成本应为零。
- **r8 依赖：** 强依赖。区分没找到方法、找到却没读、读了但没改变行动；不以加载率为收益指标。未定位前排末位。

## 5. 排除的重复建设与实现边界

本次排名服从 [AGENTS.md](../../../AGENTS.md)、[CLAUDE.md](../../../CLAUDE.md) 与[核心设计 §1.5](../specs/2026-10-22-ctf-agent-design-v1.md#15-工具知識資料與隔離)：OpenCode 负责模型、会话、工具内循环；host 保持可信身份、资源、scope、预算与证据职责。薄控制层可以提供有界操作原语，不能在工具内再运行一个自主规划／模型循环。

以下不列入新增项：

- 第二套线索库／任务树／调度器／看门狗，以及更多 Recon／Solver／Critic；A+D 已是当前行为基线。
- 把已有脚本执行、Cookie、响应保存、artifact 发布、续读和取消重述为全新能力；先改善已存在的使用成本。
- 将 r6 同步发布身份修复、Verifier 策略或裁判链返工包装成单 Agent 解题能力；它们有各自的既有设计和验证范围。
- 漏洞百科、通用知识平台、批量 wordlist／payload 仓库、联网 writeup 检索及运行中装依赖。
- 用 exit 0、HTTP 200、匹配到 flag 样式、工具摘要或模型判断替代独立验证与可信提交；任何新工具都不增加 judge 权限。

## 6. 前三项建议与后续可验证问题

**建议供后续设计优先比较的前三项是：**

1. **有界 HTTP 批量对照**：把模型已能列清的实验合并执行，减少重复决策往返，保留每项请求及状态依赖。
2. **可追溯的输出提取／差异视图**：从已有原始输出一次拿到决定下一步的差异、错误和上下文，降低读回成本。
3. **源码／页面到请求动作的定位辅助**：减少从线索到可执行请求的机械整理，特别关注动作响应而非只查静态文件；其当前优先级最依赖 r8。

这不是要求 r8 前先实现三项。**先让待运行的 r8 观察已有 A+D 的行为，是保持归因清楚的较小改动路径；本文不授权或执行 r8。** 若仍未消费齐全线索，不立即加工具；若已消费而微小操作／读回占主要成本，再选择对应原语。交互 TCP／PTY、附件工具、浏览器属于扩展题型的能力，按真实任务需要进入，不拿 Throwback 单题给它们作失败归因。

以后若选择某项验证，应观察同一次运行中：线索首次可见到首次直接实验的时间、获得有区分力观察所需的工具／模型往返、首个候选及有效交付时间、真实 observable token 口径、错误／截断／unknown 是否仍完整保留，以及最终 candidate_only／verified／accepted／solved 的不同结果。A+D 后已有改善与新工具增量分开比较；不能承诺加速比例，也不把更早失败或更少调用当成收益。复用同题时标明既有知识与版本条件，跨题泛化仍需未泄露解法的独立题目。

**本文只是后续设计的分析输入，不作接口、工具选型或实施决定。静态代码只能证明接口存在与缺失；真实解题能力、效率收益和模型遵循，只有在另行授权且预算明确的真实 run 中才能证明。**
