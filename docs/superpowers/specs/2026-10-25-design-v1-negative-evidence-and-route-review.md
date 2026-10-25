# design v1 G／H：否定证据与路线复核

日期：2026-10-25（Asia/Tokyo）。状态：**原失败模式的同版本无模型对照与现有 HTTP 保存／workspace 读回已验证；未实施产品修改，未做模型行为验证。** 本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) G／H 的详细子文件，细节以本文为准。第一优先级[创建方式保存与续接漏参补齐](2026-10-25-design-v1-sync-resume-provenance.md)已完成并合回主区。本次依用户授权，仅执行第二优先级的最小无模型取证验证并回写结果；未运行原题或产品模型。

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

**建议替换位置（未修改 Skill）：** `product/skills/web-session-diagnosis/SKILL.md` 的 `Check response continuation and business postconditions` 第 4 项；保留其空白／重复响应不得无依据重试的约束，替换为下面的候选表达。`Interpret results` 与 `Stop and change direction` 的已有有限反证规则继续保留，不再叠加同义警告：

> If the response is empty, unchanged, or repeated, record its limits and do not repeat without new evidence or a justified input change. For a decisive remote search, retain the search process's own status, stderr, bounded stdout, and searched scope using available capabilities. Keep its status separate from downstream commands, HTTP, and local jobs. Interpret no-match status according to the actual tool; if status, errors, or necessary output are unavailable, preserve search validity as unknown. Hand off the supported local conclusion with a small decisive excerpt and its source.

**短交接（开发者手写核对，未发送给 Agent）：** 来源为本次最小证据的 `actualExecution.observations.error` 与实验保存体 `work/http/2.bin`。仅搜索自造 `corpus/a.txt`；摘录 `grep: unrecognized option: R`、`search_status=2`、`head_status=0`。HTTP 200、bodyTruncated=false，完整读回 3352 bytes，决定性事实在 preview 外。本次执行失败，不能称未命中；有效无匹配样例的状态 1 只支持该文件未命中；原空体缺状态／stderr，搜索有效性未知。该路径只作实验来源索引，不是已发布 artifact ref，也不证明真实 task 交接成功。

**失败与未证明范围：** 终检首次发现既有 sync-resume design 链接目标未包含在隔离 allowlist，已从主区有界补复制该一个文档并记录哈希，未改其内容；初始 17-file 基线仍在最小证据保留，未重跑实验。Python 3 探测失败已保留，现有 Python 2.7 完成实验。没有读取私有 oracle、原靶场搜索或攻击，没有产品代码／Skill／角色修改。未证明原历史搜索覆盖、完整原 HTTP 保存体、截断／缺权限场景、完整 OpenCode 注册／题目绑定／角色授权／发布／原生 task 链、Solver 是否正确修命令与收窄结论、Critic 判断、token 开销或跨题泛化；不声明修复完成、verified、accepted 或 solved。候选措辞的行为效果仍需另行授权；本次到此停止。

**验收边界：** 先用原样例检查错误不再在实验取证中丢失，正常空结果只能支持有限范围的未命中，截断／权限缺口保留未知。数据呈现可离线核对；Solver 是否因此正确修命令、收窄结论必须另有明确模型预算的行为验证，不能靠文字断言或 mock 宣告根因已修复。

## 3. 第三优先级：Critic 独立复核关键前提和未完成线索

**唯一目标：** 对影响换路或停止的关键主张，Critic 能核对其事实依据和推断范围，不将 Coordinator 的转述当独立证据。

**当前真实能力边界已核对：** `checkReadPath` 将原生 read 限于 Skill 根；受管 workspace／artifact 读取要求 challenge 绑定及解题角色，Recovery Critic 不在其中。`progressDigest` 只投影工具操作／结算与重复信号，不保存 HTTP body、远端 stderr 或退出状态。因此本次不能再泛称“Critic 已有原始证据读取能力”；仅给 ref 或调用 progress.read 并不能补齐关键事实。

**优先的最小方案：** 复用现有 Coordinator→Critic 原生 task prompt，传待复核主张、来源角色／调用索引、第二优先级保留的决定性事实小摘录及其缺口。Coordinator 转交可核对事实，不先把它包装成“均已证实”；同一来源的复述不计成多份独立证据。去掉要求“理由必须对上部署缺口”这类预设结论的问法，改为核对建议是否由当前证据支持。

Critic 的独立性是独立检查“这些事实是否足以得出该结论”，不等于再执行一遍实验。证据未给、来源未确认或范围不足时，指出具体缺口，建议原 Solver 做最小补查；不通过开放 sibling work、原始会话、服务器日志或实验权限来兜底。仍沿用现有来源角色回传与 Coordinator 续接，无新角色、工具、自动调度或统一消息框架。

去敏的小摘录不是完整工具 body、候选 bytes、flag、cookie 或控制秘密。若必要事实不能在当前安全边界内提供，应保留“无法复核”，不能编摘要来冒充独立核对，也不能因发布失败就把未确认的观察当已证实。第一优先级消除了漏参造成的后台发布失败，不自动让 Critic 获得读取权限或具备正确判断能力。

**判断契约：** 区分无可验证候选、搜索有效性未知、仅所查范围未命中、证据支持具体环境缺陷，以及预算／权限导致必须停止。允许在没有授权内可行下一步时停止，不能把停止理由提升为“全环境没有答案”。未验证的题面线索是未解决项，不是指定某条题目解法。

**不采用：** 增加 Critic 次数或另加 judge；让 Critic 只对同一个摘要换一种说法；没有必要即新增读取接口。若事实小摘录不足以完成原样例核对，先报告缺的具体信息，再决定是否需一个受限的既有引用读取能力，不能预先设计通用证据平台。

**验收边界：** 先核对原 Coordinator→Critic 输入能否携带必要事实，及当前角色是否能在既有接口下取得它们；分别保留“输入可达”与“判断正确”的结论。行为样例只覆盖失败搜索误报、同源摘要重复、未验证线索、以及证据充分或授权耗尽时合理停止；不要求无限继续。模型效果须另授权预算，不向提示注入本题答案或专属捷径。

## 4. 是否能从根源解决，以及下一步边界

本版将修正点放在**实验取结果时的信息保留**和**交接时主张与事实的分离**。它能直接针对本次“信息丢失→摘要洗成事实→Critic放大”的因果链；仅加提醒、错误字符串 gate 或额外 Critic 属兜底，不能替代它。

这仍不是“模型永不误判”的保证：模型可能在事实齐全时作错判断。只有原样例的输入／输出链与明确预算内行为验证都支持，才可称本次问题改善；通用效果需未泄露解法的独立题目证据。当前已完成根因定位、方案更新及 §2.1 的同版本最小无模型取证链验证，未宣称产品修复或模型行为改善。

后续只先推进第二优先级的实验取证／交接内容；第三优先级复用该事实再做复核，不把两者整包实施。公开接口连通性有具体未知时才拆对应最小验证 plan。没有必要不改 host／工具接口，不新建 schema／gate／readiness／框架。本次验证结论及最小证据经核对已合回主工作区，核心入口同步状态；一次性验证 plan 已移除，本次隔离工作区按流程归档。临时复现脚本保留于主区忽略目录 `runs/search-evidence-minimal/verify.mjs`，供核对而非产品运行。未改产品、未 commit／push，不自动开始后续实现或模型行为验证。
