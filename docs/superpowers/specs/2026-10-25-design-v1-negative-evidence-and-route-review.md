# design v1 G／H：否定证据与路线复核

日期：2026-10-26（Asia/Tokyo）。状态：**源头取证与事实交接三处提示已实施并随 `89e47dde` 提交，进度工具依赖随 `b1afa29a` 收口；原生脚本文本交接通过。后续 r4 有真实调用观察，但 Critic 未交付有效复盘，模型行为目标未验收。** 本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) G／H 的详细子文件，细节以本文为准。第一优先级[创建方式保存与续接漏参补齐](2026-10-25-design-v1-sync-resume-provenance.md)已完成并合回主区。第二优先级已完成最小无模型取证验证；第三优先级的隔离实施阶段仅修改三个 Markdown 提示并验证一条无模型原生文本交接，结果见 §3.4；该阶段未运行原题或产品模型，后续 r4 观察另见 §3.5。

## 1. 当前证据与纠正

原始 run 为 `/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261025-r3/runs/throwback-debug-20261025-r3-1/`，以下 `evidence/`、`progress.md` 均相对该目录；server.log 位于外层 r3 的 `target-evidence/`。这些是运行外的调试证据，不授予 Solver 读取服务器日志、私有 oracle 或答案的权限。

### 1.1 已核对的因果链

| 环节 | 原记录中的事实 | 能证明和不能证明的内容 |
| --- | --- | --- |
| 搜索实验 | Solver 通过网页中的远端命令取搜索结果，多处为 `os.popen(...).read()`；部分搜索丢弃 stderr 或接 `head`，没有记录搜索进程的退出状态 | 有 stdout 不等于成功搜索；空 stdout 不区分未命中、命令报错和结果未取到 |
| 远端实际错误 | server.log 第 91／147 行为 `grep: unrecognized option: R`，第 197 行为不支持 `b`；相邻请求并行，不把日志紧邻的 POST 当作错误的唯一对应调用 | 至少这些 grep 执行失败；不能据此说所有其他搜索都失败，也不能把多次局部空结果升级成全局不存在 |
| HTTP 交付 | Solver 的 s10／s19 等搜索请求后，GET `/s10`、`/s19` 返回 HTTP 200、bodyTruncated=false，模型可见工具输出未包含上述 grep 报错；相应命令使用 stdout-only 读取，丢弃 stderr，无退出状态 | 只证明 HTTP 响应及保存体完整；不证明远端命令成功或搜索覆盖完整。该缺口发生在构造实验和取结果时，不能预设为 host 截断错误 |
| Solver／Coordinator 摘要 | `progress.md` 和 Coordinator 的 Critic task prompt 把“全 rootfs 扫描零笔”等列为已经工具实测的事实 | 否定结论的强度超过已保留的执行事实；不据本次静态分析断言模型是故意忽略错误 |
| Critic 输入与动作 | `messages-ses_e8df79e9bffeCKzZXDQc6EM9as.json` 中，用户输入是上述结论摘要；工具只有一次 `ctf_progress_read` 和一次 `ctf_progress_note`，未核查搜索原始输出 | Critic 确实调用了，但拿到的不是一份独立搜索证据；进度摘要不含 grep 错误或远端退出状态 |
| 复核与最终结论 | Critic 将同一批摘要称为“8 项独立证据”，建议有界补查全负后按部署缺口停止；Coordinator 随后记“确认容器内不存在 flag” | 发生了共享前提未经核对而被反复增强；并非“少调用一个 Critic” |

定位入口：Solver 消息文件 `messages-ses_e8e00c62affeNhXgn67V9m5j5E.json` 中，s10 的 POST call `call_00_5pfbboajdyji5adnqhan2gu2` 与 GET call `call_00_020e7t1dx3fl0lbymqxquk7w`；s19 的 POST call `call_00_9g0192gzx1hwsqhvq4x8v2m0` 与 GET call `call_00_b4m5cuhbep8yeu245ozbuzwx`。这里只保存索引，不复制请求、cookie、payload 或答案。

Root 有最终正文，不能继续称为“Root 没返回”。后续原记录的源码取证也不能替代实际解题链或重写为 solved。本次未读取私有答案，未重新执行攻击请求。

### 1.2 根因判断与不确定性

已证实的是两个信息断点：**实验没有保留足以判断搜索有效性的事实；交接把待核对的否定主张变成了已确认事实。** Critic 依赖同源摘要，未恢复丢失的信息，反而增强了结论。空业务表与有限目录未命中还被用于推断整个部署缺答案，是另一项范围推断错误。

原 Skill 已有“错误不等于反证、局部未命中不等于全部穷尽”的规则；继续加同义警告或增加 Critic 调用次数，不解决上述断点。HTTP 工具本就只能保存 HTTP 状态、body、完整性；它无法找回远端已丢弃的 stderr，也不能通用认证任意正文中远端命令的退出码。现有 `job.run` 的退出码属于本地进程，不能拿来冒充其内部 HTTP 调用所执行的远端命令状态。

不确定性保留：哪些有效搜索后来补足了哪些范围，及模型为何忽略这一信息缺口，仍不能仅据这几项记录下全局结论。本次足以确定修正位置，不需要先重跑完整题目。

## 2. 第二优先级：搜索结果的证据有效性

**唯一目标：** 决定性搜索的返回能区分“执行失败／执行结果未知”和“在已说明范围成功搜索但未命中”，交接结论与之相符。

**源头修正方向已选：** 优先在现有 Web Skill／实验与交接方法中修正“如何取得可解释结果”，不是先修改 HTTP 成功含义。Solver 选择远端执行方式时，应利用目标已有能力一并取得搜索本身的退出状态、错误、有效输出与所查范围；保留其对应原始响应。不要只取 stdout 或让后续 `head` 的状态代表上游搜索。输出需有界，若不能完整读取则明确缺口；不为观测而安装依赖或增加范围。

这些是实验应保留的事实，不新增产品动作协议、通用包装器或固定 JSON schema。host 继续保存自己可知的 HTTP／本地 job 事实与来源；远端输出中的命令状态仍是待解释的目标响应，不能伪装为 host 已独立认证的状态。通用规则不能写入本题路径、路由、payload 或答案。

若现有远端方式无法取到退出状态或错误，Solver 应标为“这次搜索有效性未知”，按实际环境修正一次具体调用或转向另一有依据的观察；不能把空白解释为“没有”。`grep` 无匹配状态与参数错误需按工具语义区分，不能简单规定“所有非零退出都失败”。本地脚本退出成功也不能覆盖其内部远端命令未知。

**最小交接：** 继续使用已有原生 task 结果与产物引用，说明决定性观察的实际执行状态、有限范围、输出完整性、支持的局部结论和必要证据索引；保留错误／未知原文的小摘录。不得用“全盘扫过”替代事实，不能因引用存在就自动判结论成立。这是对现有交接内容的聚焦修改，不为每次工具调用增加表格或强制发布。

**不采用：** 增加 BusyBox 兼容层来代替 Agent 正常修命令；HTTP 200 自动等于远端成功；通用证据评分器或全局否定 gate；调高输出上限；自动重复实验；把正常 grep 参数失败直接归为产品工程故障。

### 2.1 2026-10-25 最小无模型验证结论

**版本与基线：** 主区 `main`／HEAD `ee78e017a3fdbb8418329ca1843968b2fc2596f5`；在 managed worktree `/Users/caihaoming/.codex/worktrees/search-evidence-minimal/pentest-agent` 复制本次依赖的主区当前 18 个文件，共 239770 bytes，包含已修改的 `product/AGENTS.md`、Coordinator、核心 design 及未跟踪的本文、执行文档与既有 sync-resume 依据文档。逐文件基线 SHA-256、相对 HEAD 的差量、执行命令和最小原始观察见[本次最小证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/search-evidence-minimal-20261025.json)。有序路径／哈希清单的聚合 SHA-256 为 `8340d49d7f618843a8df2121fd55b8cf97e1c6e171acbc07d8af3bbd316fb3b3`。验证阶段未复制历史目录或依赖、未改主区；运行时引用主区已有 tsx，执行的 HTTP／workspace／file-page 来自隔离基线。

**原证据提取边界：** 仅检查 §1 的四个指定 call 对象及 server.log 的 91–95、147–151、197–201 行错误／版本窗口，未输出或保存完整请求、cookie、payload 或答案。URL 解码后 s10 的搜索参数为 `-RIn`，s19 为 `-RInaE`；均为 `os.popen(...).read()`、丢弃 stderr、接 `head`、未保留搜索状态。原 GET 200、bodyTruncated=false；本次只检查其工具输出 preview，不据此补判原保存体尾部，也不把相邻并行日志唯一归属到某个请求。

**同版本前后对照：** 原日志及本地已有镜像的工具均为 BusyBox 1.31.1。镜像固定为 `sha256:ec0deee9a8a45ac74494e7dfc92357711fcf0b1e1c58543f09d6f824f3d9be98`；使用其已有 Python 2.7.18、断网只读临时容器、非 root、无宿主目录挂载，仅在 tmpfs 自造 `corpus/a.txt`（19 bytes、三行）搜索，不启动原靶场服务。最初探测 Python 3 缺失，改用已安装的 Python 2.7；未安装依赖或扩大平台。同版本号只固定工具语义，不证明整个历史部署或其 Python 版本相同。

| 四类观察 | 实际对照与支持的结论 |
| --- | --- |
| 原模式参数错误，但 HTTP 200 | 保留 `grep -RIn` 作为失败输入。旧 `os.popen` 方式只取得 0-byte stdout，管道末端状态 0；改为以现有 subprocess 分别取得搜索 stderr／状态，并保留同一个 `head` 下游后，得到 `grep: unrecognized option: R`、搜索状态 2。只证明参数错误，不能称未命中 |
| 有效搜索无匹配 | 同一有限文件以支持的 `-rn` 搜索自造的缺失标记，状态 1、stdout／stderr 均为空；只能说该文件对该模式未命中。额外命中对照状态 0，stdout 为 `corpus/a.txt:2:MARKER` |
| stderr／搜索状态不可得 | 原 stdout-only 方式交付的空体不含这两项；即便 HTTP 200、完整保存并读回 0 bytes，搜索有效性仍为未知。不能用外部对照已知的错误替未知接口补填状态。此次未另测截断正文，截断规则未据此验收 |
| 上游失败而 head 成功 | 改进方式实际搜索状态 2，实际 head 状态 0；分别记录，不能以管道最后状态或本地容器退出 0 替代上游状态 |

**现有交付链：** 将以上实际结果交给仅监听 `127.0.0.1` 随机端口的 HTTP 服务，直接调用未修改的 `createHttpTools().request` 保存，再用未修改的 `readWorkspace` 读取返回的 `bodyPath`。四次响应均为 200、bodyTruncated=false；原空体／错误／无匹配／命中分别为 0／3352／171／193 bytes，来源与读回 SHA-256 逐一相同，workspace 页均 `done=true`、nextCursor=null。错误样例增加 2250-byte 无决定性事实的边界控制前缀，确保 `search_status=2` 和 grep 错误均不在 2048-byte preview 内，仍可从 `work/http/2.bin` 完整读到；不是把 preview 当全文。未增大任何限额，未启动 OpenCode。

**额外输出成本：** 同一错误实验旧 stdout 为 0 bytes；保留搜索状态、stderr、stdout、范围和下游状态的文本为 1102 bytes，增量 1102 bytes；另加的 preview 边界控制为 2250 bytes，仅用于本次验证，不计作源头方法的固有成本。错误交付总计 3352 bytes。不是 token 测量，provider usage 为 unavailable；未调用产品模型。

**在本地条件内定稿的方法与表达：** 使用已有运行时分别捕获搜索自身状态、stderr、有界 stdout 与有限范围，若保留下游裁剪须分别记录其状态；错误或状态丢失时保留未知。现有 HTTP 保存／受管读取可承载这些事实，不需要新增 host 包装器、schema、角色或输出限额。过程状态仍是响应中的目标执行事实，本次本地直接观察可对照，不由此升级为 host 对任意远端状态的独立认证。

**取证验证时的建议替换位置（当时未修改 Skill，本次落实见 §3.4）：** `product/skills/web-session-diagnosis/SKILL.md` 的 `Check response continuation and business postconditions` 第 4 项；保留其空白／重复响应不得无依据重试的约束，替换为下面的候选表达。`Interpret results` 与 `Stop and change direction` 的已有有限反证规则继续保留，不再叠加同义警告：

> If the response is empty, unchanged, or repeated, record its limits and do not repeat without new evidence or a justified input change. For a decisive remote search, retain the search process's own status, stderr, bounded stdout, and searched scope using available capabilities. Keep its status separate from downstream commands, HTTP, and local jobs. Interpret no-match status according to the actual tool; if status, errors, or necessary output are unavailable, preserve search validity as unknown. Hand off the supported local conclusion with a small decisive excerpt and its source.

**短交接（开发者手写核对，未发送给 Agent）：** 来源为本次最小证据的 `actualExecution.observations.error` 与实验保存体 `work/http/2.bin`。仅搜索自造 `corpus/a.txt`；摘录 `grep: unrecognized option: R`、`search_status=2`、`head_status=0`。HTTP 200、bodyTruncated=false，完整读回 3352 bytes，决定性事实在 preview 外。本次执行失败，不能称未命中；有效无匹配样例的状态 1 只支持该文件未命中；原空体缺状态／stderr，搜索有效性未知。该路径只作实验来源索引，不是已发布 artifact ref，也不证明真实 task 交接成功。

**失败与未证明范围：** 终检首次发现既有 sync-resume design 链接目标未包含在隔离 allowlist，已从主区有界补复制该一个文档并记录哈希，未改其内容；初始 17-file 基线仍在最小证据保留，未重跑实验。Python 3 探测失败已保留，现有 Python 2.7 完成实验。没有读取私有 oracle、原靶场搜索或攻击，没有产品代码／Skill／角色修改。未证明原历史搜索覆盖、完整原 HTTP 保存体、截断／缺权限场景、完整 OpenCode 注册／题目绑定／角色授权／发布／原生 task 链、Solver 是否正确修命令与收窄结论、Critic 判断、token 开销或跨题泛化；不声明修复完成、verified、accepted 或 solved。候选措辞的行为效果仍需另行授权；本次到此停止。

**验收边界：** 先用原样例检查错误不再在实验取证中丢失，正常空结果只能支持有限范围的未命中，截断／权限缺口保留未知。数据呈现可离线核对；Solver 是否因此正确修命令、收窄结论必须另有明确模型预算的行为验证，不能靠文字断言或 mock 宣告根因已修复。

## 3. 第三优先级：Critic 独立复核关键前提和未完成线索

**唯一目标：** 对影响换路或停止的主张，Critic 检查给定事实是否足以支持结论，指出未核实前提、范围跳跃和未解决线索。这里的独立是判断独立；通过 Coordinator 转交摘录，不等于 Critic 独立读取或认证了原始证据。

### 3.1 原失败的直接原因及当前接口

本次只读重核 Coordinator 消息文件 `messages-ses_e8e06bb50ffe1yvaOTkP48LRz4.json` 第 14 条的 task `call_00_x1a1txgx8jlnyshx7gbmsp8l`，及 §1 指定 Critic 消息文件：

- Coordinator 把“全 rootfs 扫描零笔”等称为“均为工具实测”，没有交付搜索自身状态、错误和覆盖限制；同时要求停止理由对应“部署缺口”。这既把推断预先包装成事实，又限定了期望结论。
- Critic 只调用 `ctf_progress_read` 和 `ctf_progress_note`，随后把同源摘要称为“8 项独立证据”，用所谓全盘扫描否定未查位置，并把剩余两项补查全负预定为部署缺口成立。问题包含证据来源、搜索有效性和推断范围三项，不只是遗漏某个目录。
- `progress-ledger.ts` 的 `safeDetail` 把 `tool.settled` 投影为 callID／tool／job／result／durationMs；`progress.note` 同样可由模型填写。工具调用记录能证明发生过操作，不能证明对应搜索有效；模型摘要进入宿主账本也不会变成宿主认证的题目事实。
- `control-service.ts` 的 `checkReadPath` 把原生 read 限于 Skill 根；`checkSolver` 要求 challenge 绑定及解题角色，Coordinator 和 Recovery Critic 均没有普通 workspace／artifact 读取能力。仅给路径或 ref 不能使它们自行核查正文。复核时 Coordinator 的“進度與 Recovery Critic”段禁止把工具 body 放入 Critique 任务，与小摘录方案冲突；本次隔离区已替换该段，见 §3.4。

因此，当前小摘录方案能解决“只传结论，缺乏判断材料”的输入问题，但仍依赖来源角色保留并忠实选择事实，不能宣称已消除摘要遗漏或失真的全部可能。第二优先级只验证了取证／读回可行性；本次已落实 Skill 措辞，但不能假定真实 Solver 已会生成这种交接。

### 3.2 选定的最小修正及其边界

沿用现有来源角色 → Coordinator → Critic 的原生 task 文本交接：

1. 来源角色在决定性观察的结果中提供有限范围、实际执行状态、必要错误／输出小摘录、完整性缺口和来源索引，明确哪些是观察、哪些是推断。原文未保留就写缺失，不让后续角色补编。本步依赖 §2 的源头取证修正；已有产物发布约束继续适用，不另为每次复核强制发布。
2. Coordinator 转交这些决定性事实及其限制，把待复核结论作为问题提出。摘录必须标明来自哪个角色的哪次观察，保持其状态与原文含义；来源索引只供追踪，不等于已认证。保留与主张相冲突的事实，不能把“未知”压缩成“未命中”，也不要求 Critic 为某个预定结论找理由。
3. Critic 分别判断事实来源／有效性是否已说明，以及即使这些事实成立、是否足以支持当前结论。摘要被多个角色重复不增加独立证据数量；有效的有限搜索也不能自动证明整个环境不存在答案。原记录中“源码在某处”的题面线索不能直接改称“答案只在该处”；线索未验证应保持未解决，不在本设计指定题目解法。
4. 资料不足时，Critic 指出一个会影响当前决策的具体缺口，由 Coordinator 决定是否在现有权限和预算内交原 Solver 补充。补充已有记录优先于重做实验；缺口确需新观察才提出有依据的最小实验。没有可执行的授权路径时可以停止，并把停止原因与环境事实分开记录，不要求为了取得确定结论无限搜索。

**提示修改位置（本次隔离区已实施，见 §3.4）：** Coordinator 的“進度與 Recovery Critic”转交规则应允许必要的去敏事实小摘录，同时继续禁止完整工具 body、候选原文、flag、cookie、控制秘密、完整 prompt／chain-of-thought／job argv；Recovery Critic 的“交付”应明确上述事实与推断复核职责，并使用已有 summary／blocker／nextAction 表达，不新增 schema。Solver 的取证交接归 §2，不在第三优先级复制一套规则。

去敏不是对任意正文安全性的程序保证；无法在现有边界内提供必要事实时明确“无法复核”，不能编写替代摘要冒充证据。Critic 只看到来源角色转交的小摘录时，应保留这一来源限制；禁止称“已独立核验原始输出”。是否另需受限读取能力仍未定：只有具体样例证明现有交接缺少不可替代的信息，才讨论该缺口，不预先增加读取接口、角色权限或通用证据平台。

### 3.3 是否针对根因，以及需要什么验证

本方案直接修改产生误判的输入与推理任务：从“接受已经证明的摘要，并解释为何应停止”改为“核对观察是否有效、结论是否超出观察”。它针对交接与推断这段因果链；第二优先级负责在实验处保留事实，二者缺一不能宣称解决完整原问题。再加 Critic 次数、错误词检测、强制换路或固定补查轮数，都不能替代这两个修正。

**已能决定：** 先修改现有交接／复核提示契约；保留 Critic 建议、Coordinator 决策、Verifier 验证的责任边界；不因本次误判增加实验权限。停止可以由预算／权限／当前无可行下一步支持，环境缺陷必须有相应证据；“没有可验证候选”不升级为“全环境没有答案”。

**仍未证明及最小验证问题：**

- 输入能否保真到达：§3.4 已在具体版本／隔离配置下验证一条原生 scripted 链，状态、小摘录、来源及限制逐字符到达。脚本如何选择和转交由开发者写定，尚未证明真实 Coordinator 会自行忠实选材；不据此重跑整个靶场或扩展生命周期。
- 模型会不会按修正后的职责判断：使用不含原题答案的局部案例，分别检查“有明确报错却声称未命中”“只有摘要而无执行状态”“有效有限搜索却声称全环境不存在”，以及“预算已尽时合理停止”。同源重复不应加强结论，未解决线索不应被凭空否定。需真实模型时另明确模型／provider、批次和 token 预算；脚本固定回复只能验证传递，不能证明判断改善。
- 摘录方案是否足够：如果模型收到完整必要事实仍作错推断，问题在判断，不据此扩权；如果正确判断确实依赖未交付的原始内容，先指出缺哪段、现有来源角色为何不能提供，再决定是否改交接或讨论受限读取。不能把任何失败都解释成“需要新工具”。

当前结论为三处提示契约已在隔离区实施、单条 scripted 原生文本交接通过；尚待主助手审阅合回，未验证模型判断，不把原始输出独立核验、真实行为修复或完整问题解决标为已完成。

### 3.4 2026-10-25 提示契约实施与最小原生文本交接

以下保留隔离实施时的条件与未提交状态；随后提示与证据已提交为 `89e47dde`，其工具依赖由 `b1afa29a` 收口。后续真实运行另列 §3.5，不回填为本节 scripted 样本的能力证明。

**隔离基线与增量：** managed worktree／identity 为 `/Users/caihaoming/.codex/worktrees/critic-factual-handoff-minimal/pentest-agent`，detached HEAD `fdbbce44579ca3a951be8c7fc408fa6a9db2d420`。从主区 main 有界复制 51 个当前依赖文件（544910 bytes），包含未提交的 host／插件、配置、产品规则与角色当前基线；未将这些继承差量算作本次修改。有序 `path + TAB + sha256 + LF` 聚合 SHA-256 为 `868dc6767111683385177239b551634c7cd90b484d8b53af5c7c1064855334ce`。逐文件清单、基线副本及相对复制基线的补丁留在该工作树忽略目录 `runs/critic-factual-handoff-minimal/`；[紧凑证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/critic-factual-handoff-minimal-20261025.json)保留关键原文、hash、命令和失败。

**本次产品修改仅三处：** Web Session Diagnosis v4→v5，只替换续读／业务后置条件第 4 项为 §2.1 已验证措辞；Coordinator 只替换“進度與 Recovery Critic”的转交条目，允许必要去敏小摘录、忠实保留来源／状态／范围／未知／反证并开放结论问题；Recovery Critic 只替换“交付”相关条目，区分事实有效性、推断范围与停止理由，同源重复不加强证据，缺口先查已有记录，再建议授权内最小补查。保留原权限、生命周期、发布与独立验证契约，无新增字段或框架。

**条件与实际结果：** Node v26.3.0、OpenCode 1.19.3、SDK／plugin 包均 1.19.0，复用主区现有依赖，无安装。局部缩减已有 `runs/task-parameter-minimal/native/native-probe.ts`／`run-native.sh`，保留 `env -i`、独立 HOME／XDG、loopback-only sandbox；外连自检为 EPERM，唯一 provider 为本地 `stub/scripted`。一条原生后台 task 链为 domain-solver→Coordinator→recovery-critic，不改变前后台机制、不执行 HTTP／job／搜索／发布／靶场动作。Solver 返回带本轮随机 observation 标记的**合成观察**：有限范围、`search_status=2`、`grep: unrecognized option: R`、下游 0、HTTP 200、本地 job unavailable、输出缺口、未知、反证及预算停止限制，均不冒充实际搜索观测。

Coordinator 脚本从实际 provider 请求里收到的原生完成通知提取正文后构造 Critic task prompt，不从源端变量、全局常量或响应日志取材。该次来源正文 864 字符；来源输出、父端收到、Critic 首次 user prompt 中正文逐字符相等，SHA-256 同为 `a871a05c6ef630038823006aca1bb979902a5591e8cd66bdf1145c75acc326a3`。两个原生 execution 均 completed、completeness=complete；请求为 Coordinator 6、Solver 1、Critic 1。修改后 Coordinator／Critic 正文进入实际 system 请求；三文件复制 hash 相符，原生 inventory 发现 Skill。**Skill 正文未出现在请求且未调用，仅完成装载／发现检查，不能称已使用方法。**

**命令、失败与停止：** 在隔离工作树执行 `runs/critic-factual-handoff-minimal/native/run-native.sh success`。首次 `attempt-success.stZEXB` 的驱动误以为完成通知含 Critic 角色名，停在 phase=3，末检 `3 !== 4`、exit 1；实际 Critic 已收到并返回。保存原失败驱动和日志后，仅将通知匹配改为实际结果标记，再以同一命令运行 `attempt-success.zC1JXs`，phase=4、exit 0。第二次是本次唯一有效检查，成功后未再运行。`node_modules/.bin/vitest run tests/contract/opencode-config.test.ts` 为现有配置定向检查，2/2、exit 0（实际 Vitest 2.1.9）；只改 Markdown，未重复全仓 typecheck／build／test。

**陈述边界：** scripted 只能证明此版本／配置下原生文本可达及具体内容未丢失，不能证明 Solver 会正确取证、Coordinator 会自行忠实选材、Critic 会正确判断、合理停止或跨题泛化。去敏未程序强制、来源未认证，转交摘录不等于独立核验原文。provider 计数为脚本合成，真实 usage=unavailable；无真实产品模型、原题或 oracle 操作，无 verified／accepted／solved 主张。未改产品源码、权限或发布校验，无 commit／push。2026-10-26 主助手已核对基线及增量，合回三处提示、本文和紧凑证据，同步核心 G／H；一次性 plan 已删除，本次工作树按流程归档。

### 3.5 r4 后续真实运行观察（2026-10-26）

本节更新当前完成状态，不改写 §3.4 的 scripted 条件。原 run 为 `/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261026-r4/runs/throwback-debug-20261026-r4-1/`；`state/run.json` 记录 HEAD `89e47dde` 且 productDirty=true，OpenCode 1.19.3、`volcano-coding/deepseek-v4-1-flash-261017`。不能将此运行归成后续 `b1afa29a` 干净提交的真实验收。

`evidence/messages-ses_e8c489f8dffeMS33QdITentS1T.json` 与 `evidence/messages-ses_e8c4e20c8ffeK8MCXYu73eos6U.json` 分别记录 Domain Solver、Recovery Critic 成功调用 `web-session-diagnosis`。Critic 同时完成 `ctf_progress_read`，下一条 assistant 消息为 finish=length、output=0、reasoning=8000，没有 `progress.note` 或有效复盘正文。这证明实际读取入口可达；不能据此验收事实选材、独立判断、停止决策或提速，也不能仅凭输入较长断定空输出根因。源头取证与事实交接的目标仍保留，空正文后续策略见[空正文恢复设计](2026-10-26-design-v1-c-empty-result-recovery.md)，尚未实施。

## 4. 是否能从根源解决，以及下一步边界

本版将修正点放在**实验取结果时的信息保留**和**交接时主张与事实的分离**。它能直接针对本次“信息丢失→摘要洗成事实→Critic放大”的因果链；仅加提醒、错误字符串 gate 或额外 Critic 属兜底，不能替代它。

这仍不是“模型永不误判”的保证：模型可能在事实齐全时作错判断。只有原样例的输入／输出链与明确预算内行为验证都支持，才可称本次问题改善；通用效果需未泄露解法的独立题目证据。当前已完成根因定位、§2.1 的同版本取证链验证及 §3.4 的隔离区提示实施／原生脚本文本交接；未宣称真实模型行为已修复或改善。

本次只将第二优先级已定取证措辞作为第三优先级交接的必要前提一并落地，未重做搜索实验；后续模型行为验证须另有明确模型／provider、批次及 token 预算。公开接口连通性有具体未知时才拆对应最小验证 plan。没有必要不改 host／工具接口，不新建 schema／gate／readiness／框架。本次验证结论及最小证据经核对已合回主工作区，核心入口同步状态；一次性验证 plan 已移除，本次隔离工作区按流程归档。临时复现脚本保留于主区忽略目录 `runs/search-evidence-minimal/verify.mjs`，供核对而非产品运行。该验证阶段未改产品；随后设计与最小证据已提交为 `fdbbce44`，未 push。此前第三优先级只读复核仅更新本文及核心 H 入口；本次隔离实施与无模型结果见 §3.4，已合回主区，本次提交仅包含相关提示、设计与最小证据，其他未提交工作保留。

## 5. r7：停滞检测的触发时机，与常驻决策骨架（聚焦子设计，2026-10-28）

**状态：聚焦设计，待计划与真实 run 验证；未改产品、未运行模型。** 由 r7 `throwback-debug-20261028-r7-1` 驱动，与 [B 路线优先级增量](2026-10-28-design-v1-b-evidence-to-action-route-priority.md) 的 L1 判定互补：那份管「方法为何无人载入／内容」，本节管「停滞时换路判断为何没被触发」。

### 5.1 r7 证据与被钉准的问题

- r7 Recovery Critic **准入 0 次**：换路判断从未被叫起。Domain Solver 末段约 20 分钟重复 flag 档名／env／DB 搜索，却没测 Recon 已浮现的 `/admin/chal/delete`。
- `coordinator.md` **已有**停滞规则（第 26 行「相同工具／参数重复≥3 次且无新进展…应评估是否分派 Recovery Critic」）与 `ctf_progress_read` 访问（第 27 行）；`recovery-critic.md` 也已有 `route: continue/redirect/stop_and_report` 与 `capabilityGap` 输出。**判断的家已存在，不缺。**
- 真正缺的是**触发时机**：Coordinator 的停滞规则只在**任务交回边界**评估；r7 把 Domain Solver **同步分派**后进入长时间阻塞等待（第 21 行还明写「不靠轮询等待」），停滞发生在**长执行内部**，Coordinator 没有 turn 去套用规则、读进度或叫 Critic，直到 deadline 子任务都没交回。Coordinator 本 run 仅 5 次准入即其被阻塞的佐证。

**一句话：换路判断（Recovery Critic）与停滞规则（Coordinator）都在，但「长执行内部的停滞」是触发盲区——没有角色在子任务跑的 30 分钟里察觉并叫起 Critic。**

### 5.2 要回答的问题（触发层）

1. 长执行内部的停滞由谁检测？Coordinator（被阻塞／按设计不轮询）、Solver 自身（自判不可靠，见 L1）、还是宿主（已记录重复 fingerprint，但目前只记不触发）？
2. 「具体线索未测」是语义判断（对比 Recon 浮现的路线 vs 实际请求），宿主只有机械的重复信号。触发（机械信号）与判断（语义，归 Critic）如何分工，才不误触发也不漏触发？
3. 让 Coordinator 背景分派长 Solver 任务以保持可响应，与第 21 行「不靠轮询等待」如何并存？「有界周期评估」和「忙轮询」的界线写在哪？
4. 常驻决策骨架（见 5.4）放进角色 prompt 后，是否真的改变行为？——只能真实 run 验证。

### 5.3 候选做法与结果去向（不预先定案）

- **A. Coordinator 背景分派 + 有界评估**：长 Solver 任务用 `background=true`（sync execution 修正后两种模式都能发布，背景让 Coordinator 保留 turn），在既有调度节拍／宿主停滞信号出现时读一次 `progress_read` 并套用既有停滞规则，而非忙轮询。结果去向：若能界定「有界评估 ≠ 轮询」的触发条件，写入 `coordinator.md` 停滞节；否则记为仍依赖交回边界。
- **B. 宿主停滞信号前移**：宿主已有重复 fingerprint；候选是当「同指纹无进展超阈值」在子执行期间发生时，作为**信号**（非决策、非新 judge 权）surface 到决策点（例如进度摘要显著位、或给 Coordinator 一个评估时点）。结果去向：若需改 `ctf_progress_read` 暴露面或新增信号字段，先记接口影响面再拆最小 plan；不新建 monitor／scheduler、不忙轮询。
- **C. Solver 自判交回**：Solver 在第 N 次无进展同类搜索且有未测具体线索时停手、交回或先测该线索。结果去向：作为**辅助**写入 solver 角色 prompt，但因 L1 显示自判不可靠，不作为唯一依赖。
- 判断仍归 Recovery Critic：触发后，把 Recon 浮现的路线与实际请求交给它，由它语义判断「有未测线索→redirect」。**不新增 judge 权、Critic 只建议、Coordinator 决定**（保持现有边界）。

### 5.4 常驻决策骨架（回应「固定思路」与 L1）

L1 已证 on-demand skill 调用不可靠（r7 全 run 0 次）。因此「固定解题思路」不应再做成需模型自己载入的 skill，而应放进**常驻、始终在上下文的角色 prompt**：一层**薄**决策骨架——观察 → 有具体线索先低成本直测 → 有界探索（允许试错，但设停止条件）→ 停滞则交回／发信号 → 由 Critic 判换路。骨架的职责之一是**点名「何时去拉哪个 skill／reference／工具」**（如「比对源码 vs 行为 → 载入 source-comparison reference」），从而直接缓解「不知道何时用什么方法」。这不等于「每题强制载入 skill」，不违反 [Skill 发现与使用 §1](2026-10-24-design-v1-skill-discovery-and-use.md) 边界；skill-discovery 的弱点正是只做了「可被发现」而缺这层常驻的「何时发现」。骨架必须薄，不得膨胀成分类 playbook 或漏洞百科。

### 5.5 最小验证与边界

- 无模型只能验「装配」：角色 prompt／骨架合法、`progress_read` 暴露面含所需停滞信号、Critic 触发路径可达。**是否真改变行为只能由真实 run（r8，另行授权 model／provider／批次／token）认账**：判据是行为性的——长执行中停滞被检测、Critic 被叫起并给出 redirect、未测的 specific 路线在 deadline 前被实际请求。不拿「规则已写」或「Critic 被叫起次数」冒充收益。
- 禁做：不新增 judge 权；Critic 只建议、Coordinator 决定。不忙轮询、不新建 monitor／scheduler／readiness／框架。不把骨架膨胀成通用 playbook／漏洞百科，不强制每题载入 skill。不改候选验证标准、身份／scope／预算／停止校验。未经授权不运行真实模型、不 commit／push。
- 完成含义：判明长执行停滞的触发归属与最小接法，并明确行为收益只能由真实 run 认账；不证明 throwback 可解或泛化。结论定稿后，触发措辞落 `coordinator.md`／`recovery-critic.md`／solver 角色，内容增量仍走 [路线优先级增量](2026-10-28-design-v1-b-evidence-to-action-route-priority.md)，据此生成的一次性 plan 完成后删除。

### 5.6 只读可行性结论（2026-10-28，未改产品、未运行模型）

对 5.2 Q3 与候选 A／B 做了只读代码核查，结论改变候选排序：

- **(ii) `progress_read` 是 live 的，但现有停滞信号太窄。** `progress.read`（`control-service.ts:584`）调用 `progressDigest(this.audit, …)`，`this.audit` 随每次 `tool.registered`（:710）即时累加，故执行中读会看到子任务活动。但 `repeated()`（`progress-ledger.ts:298`）按「`tool`＋**精确** `argFingerprint`」分组；r7 的翻找是**不同参数**的搜索（不同档名／路径），指纹各异、不计为重复。**现有机械信号对「换着花样搜、无新证据」这类停滞不触发**；要触发需更粗的「自上次新证据／artifact 起 N 次调用无进展」信号（新增项）。
- **(i) 没有机制在子执行「进行中」重新唤醒父（Coordinator）。** 父只在子任务**完成**时经 `receiveCompletion`（synthetic `<task state="completed">`）被唤醒；`hasOutstandingWork` 只维持 run 存活、不唤醒。背景分派让父不被阻塞，但父一旦 idle 就只能等完成通知。**要父在执行中周期评估＝必须忙轮询，`coordinator.md:21`「不靠轮询等待」明禁。**
- **因此重排候选：** **A（Coordinator 背景＋周期评估）现状不可行**（无执行中唤醒、忙轮询被禁）；**B（宿主停滞信号）需新增「执行中通知路径＋更粗的无进展信号」**，是真接口改动，拆 plan 前先记接口影响面。**新增并推荐候选 D：把长 solver 工作切成有界回合交回**——solver 在有界步数／无新证据时主动交回，或 Coordinator 以有界子任务分派，使**既有的交回边界停滞规则（`coordinator.md:26`）自然触发**，不需新唤醒路径、不忙轮询；C（solver 自判交回）是 D 的使能。D 仍依赖模型遵循「有界即交回」，属 prompt／方法层，收益只能真实 run 认账。
- **下一步最小选型：** 若走 D，是 `coordinator.md`＋solver 角色的有界回合措辞（无新 host 机制），可先无模型验证装配、再 r8 真跑验行为；若走 B，先写 `ctf_progress_read`／通知路径的接口影响面与「无进展」信号定义，再拆最小 plan。两者都不新建 monitor／scheduler、不加 judge 权、Critic 仍只建议、Coordinator 决定。
