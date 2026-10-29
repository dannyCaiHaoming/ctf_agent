# Recon 协同重设计：题内记录、及时交回与按需方法

日期：2026-10-29（Asia/Tokyo）。状态：**设计草案；人类随后批准的 §10.4 交接对齐＋§10.5 maxToolJobs first cut 已实现并通过无模型验证，真实模型行为未验证，其余 slice-2 范围未实施**。

归属：[核心 design v1](2026-10-22-ctf-agent-design-v1.md) §1.2、§1.4、§2.B／C 的 recon 细节子文件，不另立架构依据。本文件捕获本次人类已确认的 A1＋B3 和职责边界；研究中仍写作“候选”的选项，不能覆盖本次决定。正式纳入时，对应章节应注明 recon 细节以本子文件为准；本次只准写指定两文件，故未修改父 design 添加入口（`AGENTS.md:30–35`）。设计不构成实施、模型调用或 git 授权（`2026-10-22-ctf-agent-design-v1.md:7–9`，下文简称 **V1**）。

## 1. 现状定锚：已有能力与真正缺口

### 1.1 证据口径

仓库路径均相对仓库根；`V1:行号` 指上述核心设计。两份外部本地材料以完整路径首次定义，后文缩写仍表示同一文件：

- **研究**：`/tmp/recon-research.md:1–203`，全文已读。它是先前只读研究，原有选项梯度与问题列表尚非批准项（`:3,128–159,186–195`）；本次人类决定已收敛其中的 A1、B3、单维护者、题内范围及 Solver 边界。
- **R11**：`/Users/caihaoming/Documents/pentest-agent-run-data/seizurecipher-debug-20261029-r11-deepseek/runs/seizurecipher-debug-20261029-r11-deepseek-1/recon-diagnosis.md:1–119`，全文已读。本草案引用其校正统计，未重新计算 transcript，未查看 oracle／答案。
- 下表实现证据已只读核对；未执行网络、题目、真实模型或外部项目。StrikeAgent 的描述仅转引研究的固定版本静态阅读，不表示本次联网复核。

### 1.2 已有，不重复建设

| 已有内容 | 文件依据 | 本设计采用的真实能力边界 |
| --- | --- | --- |
| recon 保存观察、消费未测线索、原生 task 交回与固定产物发布 | `product/opencode/agents/recon.md:18–34` | **已有“有界回合与交回”**，`:25–28` 明确要求回答完或无进展即返回；不是现在才补一个 handoff 口号。 |
| 题内会话私有 work，已有 workspace.read/write | `apps/launcher/src/control-service.ts:899–915`；`apps/launcher/src/workspace-tools.ts:99–108,160–178` | work 按 session 映射；写入经临时文件 rename，读返回文件内容。支持同会话重读，不是自动恢复注入或跨会话共享。 |
| 固定 artifact 与来源绑定 | `apps/launcher/src/artifact-tools.ts:51–85`；`product/opencode/agents/recon.md:30–34` | host 生成真实 ref、hash，固定 bytes 并核对读取；固定快照不是可变 latest 状态，也不证明接收者已消费。 |
| 原生 task 同题续接 | `product/opencode/agents/coordinator.md:19–28`；`apps/launcher/src/control-service.ts:965–980` | Coordinator 保留实际 task_id 并续接；recon 可继续读自己的 work。不能外推为 host 崩溃恢复或新 session 自动读旧 work。 |
| 进度事件与重复调用可观测性 | `apps/launcher/src/progress-ledger.ts:257–327`；`apps/launcher/src/control-service.ts:583–597,662–664,706–711` | JSONL 增量落盘；progress.read 从当前 audit 生成有界摘要。精确参数指纹仅分组，不阻止执行。progress 仅 Coordinator／Critic 可用，不是 recon 日志。 |
| 已发布离线方法、原生 skill/read | `product/opencode/opencode.json:69–93`；`apps/launcher/src/control-service.ts:25–31,952–962`；`apps/launcher/src/launch.ts:94–103,169–202` | recon 已有 skill/read；读取限定发布 skillRoot，资产目录递归复制并记录 hash。无需知识检索服务或新 task 权限。 |

真正缺口是：现有观察与最终报告没有形成由 recon 持续维护、按调查问题组织、恢复后消费的工作主本；“还有哪些值得做的侦察路线”与停止判断没有被这份记录连起来。已有未测线索交接保留，但它是 task 摘要，不再另造 progress lead 或 work queue。研究依据：`研究:34–58,74–81,136–150`。

### 1.3 R11 的诚实归因

R11 的主因链是**职责越界 → 交回迟 → 下游时间饥饿**。recon 实际交回用时 21 分 36.364 秒，Solver 在 21 分 48.065 秒后才绑定，仅余 7 分 43.203 秒；29.5 分钟是 recon 会话生命周期，不能全算活跃工作（`R11:3,11–24`）。第 64 轮完成 HTTP 基线后仍继续 13 分 44.099 秒；此前已找到坐标绘制源码和可视化路线，但这不表示首分钟已完成全部基线（`R11:68–95`）。

35 次 view 是 **35 个不同路径、35 个不同 SHA-256**，37 个 job 的 argv 也不同；这是围绕同一坐标／字形瓶颈的 render → view → adjust 变体循环，不是原样重复或压缩遗忘的证据（`R11:78–89`）。当前产品配置 `compaction.auto=false`、`prune=false`，summary／compaction agent 禁用；研究未取得 r11 生效配置，不能断言那轮发生了自动压缩（`product/opencode/opencode.json:10–13,39–44`；`研究:58`）。

**持久记录是合理产品需求，但不是 r11 已证实根因的修复结论。** 方法与记录可以帮助识别低信息增益、保留实验成果；是否改善交回行为须真实 run 证明。工具看图成功也不证明精确转写能力，提前启动 Solver 不保证解出（`R11:87–91,110`）。

## 2. 耦合目标：三部分一起改变

人类确认的理由是：这三部分互相依赖，必须作为一个最小能力切片设计。

1. **持久探索记录**保留问题、区别性实验、证据和剩余路线，让 recon 能判断“还有什么值得调查”，不只记得调用过哪些工具。
2. **及时交回**由上述判断驱动：基线完成后，剩余侦察路线已耗尽或价值低，或下一步已属 Solver 深解，就交回有证据的基线与路线；不把低价值变体累积成“仍有进展”。
3. **Skill／Reference 方法**告诉 recon 怎样调查：从材料提出可区分的问题，选择有信息增益的最小实验，将结果写回记录，并在下一次选择和恢复时消费它。这样才有结构化执行，而不是更长的随机试探清单。

循环为：**分派问题 → 查已有记录／按需方法 → 区别性调查 → 更新同一记录 → 判断剩余侦察价值 → 必要时继续，否则发布并交回**。这个循环由 OpenCode 承载的角色完成，不新增程序求解循环或调度器（`V1:13,19–24,43–47,133–135`）。

只加“快交回”的 prose 已有失败先例；只写文件而不据此选下一步，或只读 Skill 而不产生证据，都不达到本次目标（`product/opencode/agents/recon.md:25–28`；`R11:99–110`；`研究:78,195`）。

## 3. 薄设计

### 3.1 A1：一份按问题组织的普通工作记录

**已定：** recon 是唯一维护者，主本位于本题、本 recon 会话的 work，采用普通 Markdown。为使后续计划可执行，本草案取默认虚拟路径 `work/recon-investigation.md`；这是文件命名的实施选择，不是新增 host 契约。它是工作记录，不是可执行队列、JSON schema、任务数据库或第二份进度账本。

文件按当前调查价值排列问题，保留同一问题的连续实验与结论；新图、新参数不会自动生成一个“新问题”。可用稳定小标题识别问题，不让模型编造可信 run/session 身份或手抄 hash。每个问题用自然语言记录以下内容，无需强制字段拼写或程序解析：

| 内容 | 必须表达的意思 |
| --- | --- |
| 问题 | 本轮要区分什么，已知前提与本轮基线交付是什么。问题身份与证据版本分开。 |
| 已试区别性实验 | 做了什么对照、改变了什么相关变量，原本期望区分什么；不是完整 argv 或逐工具流水账。 |
| 观察＋证据 | 实际看到什么、哪份材料／输出支持它、哪里截断或未知；区分事实与推断。本会话可先记实际 work／job／HTTP 来源，交回前将必要来源固定为真实 artifact ref。 |
| 已排除（refuted） | 仅写有反证支持的结论和适用范围。tested 只表示试过；失败、未完成、前提不足、无命中或看不清不能自动记成 refuted。 |
| 剩余路线（routes-remaining） | 还有哪些证据支持的侦察区别可做、能增加什么信息；说明是值得在 recon 做，还是应交 Solver。低价值、受阻和未知分开。 |
| 未测＋重试条件 | 未做什么、为何未做、需要哪些输入／状态／证据变化才能值得再试；执行状态未知必须保留 unknown。 |

以上是人类选定的 A1 内容语义，沿用既有 tested／untested／refuted（`product/opencode/agents/recon.md:20–23`；`研究:137,142–150`）。记录外显事实、简短判断与证据，不保存 chain-of-thought、秘密或答案正文；大型原始输出留在已有证据载体，以引用关联。

维护节拍按信息变化：回合开始建立／读取；有意义实验结束、反证成立或剩余路线改变时更新；决定交回时收束。不要求每次工具调用后写文件，也不在深解结束才补一篇报告。写失败或实验与写入之间中断时，未记录部分仍是缺口，不能声称 exactly-once 或“恢复必不重做”（`apps/launcher/src/workspace-tools.ts:160–178`；`研究:144–150`）。

### 3.2 恢复与交接：单一主本，摘要和快照只是交付

同 run、同 task 续接时，recon 先读主本并对照本轮分派／未测线索，再选择下一项；已有结果仍适用时直接采用。若要复验，要能指出相关状态、前提或证据变化及预期信息。缺文件、缺来源或未知执行不能当作“此前什么也没做”。本切片不启用自动压缩，不增加恢复 hook；恢复先读仍是角色约定，须观察实际消费行为（`product/opencode/agents/coordinator.md:22,25–28`；`研究:51–58,137–148`）。

交回前用现有 workspace.write 完成主本及必要交付材料；用 artifact.publish 固定所需证据和必要的去敏记录快照。主本可直接保持去敏以便发布；若需摘录，摘录只作不可变交付物，**不成为第二个可编辑状态源**。保持 snapshotFixed／rangeComplete／originalComplete 的区别；后续更新主本不改变旧快照（`apps/launcher/src/artifact-tools.ts:51–85`；`product/opencode/agents/recon.md:31–34`）。

原生 task 返回携带：基线事实与路线、重要实验和反证、剩余／未测项及重试条件、交回原因，以及工具实际返回的 ref 和必要提取说明。摘要去敏，不含 flag、候选 bytes、cookie、完整 prompt、chain-of-thought 或 job argv。Coordinator 继续使用已有 task 文字交接保留这些摘要及实际 ref；它不是 recon 主本的另一位编辑者，也不增加 progress lead。下一角色按权限消费实际 artifact，不能访问 sibling work；同 task 恢复仍以 recon 私有主本为准（`product/opencode/agents/recon.md:22–23,30–34`；`product/opencode/agents/coordinator.md:25–28,40–43`；`product/AGENTS.md:28–30`）。

发布回执或执行结果未知时暂停受影响交接，不因缺 ref 重跑实验或盲重发。新 recon session 只能从已确认交付物得到明确快照，不保证自动找到最新主本；本次不做 host 重启恢复、跨 run 记忆或双维护者合并（`product/opencode/agents/recon.md:33`；`apps/launcher/src/artifact-tools.ts:54,73–85`；`研究:37–39,148`）。

### 3.3 B3：常驻极短骨架＋按需方法

**已定：** `recon.md` 常驻内容只保留职责、停止／交回规则与记录约定，兼容现有工具、去敏和固定交付要求。方法细节放按需 Reference 或原生 Skill；不强制每题加载，不全文常驻，不新增角色或 knowledge-agent 层（`V1:43,113–123`；`研究:156–169`）。

为切片 1 提供明确落点，本草案选择**一个聚焦原生 Skill** `product/skills/recon-investigation/SKILL.md` 承载方法。这是基于现有发布链的资产包装选择，不改变人类已定的 B3；不同时再建一套独立 Reference。选择理由：方法覆盖授权服务、附件、协议／数学结构的基线，不能假装现有 Web Skill 的适用面覆盖全部；skill/read 已授权且目录会被递归发布（`product/opencode/opencode.json:69–85`；`apps/launcher/src/launch.ts:94–103`；`研究:79–81,156–158`）。`recon.md` 仅给简短的按需入口，写作时可按既有产品资产语言风格处理。

方法内容限定为：识别材料能证明什么；承接已有具体线索；提出一个可区分解释的问题；依据前提选择最小对照；解释观察与否定范围；更新剩余路线；判断继续还是交回。方法资产附来源、版本、适用／不适用条件，避免全领域分类树、固定扫描流程、payload 目录或题目答案触发词。若借用其他方法，其中“继续直到候选”的 Solver 目标不能覆盖 recon 的基线边界；研究只发现该文字张力，**没有证明 r11 读过该 Skill**（`product/skills/web-session-diagnosis/SKILL.md:38–44,56–60,72–78`；`研究:81,161–169`）。

Reference **角色**与方法 Reference **资产**不同：简单知识读取由 recon 直接使用已授权 skill/read；确有需要时由 Coordinator 按需分派已有 Reference。recon 不获得 task 分派权，Reference 不获得目标网络／脚本／材料修改权（`product/opencode/agents/reference.md:7–14`；`product/opencode/agents/coordinator.md:23`；`apps/launcher/src/control-service.ts:25–31,952–962`）。

### 3.4 职责边界及记录如何驱动交回

recon 的交付是**有证据的基线＋可交接路线**：已知材料、入口／结构、必要低成本观察、支持路线的证据、反证和明确未解项。它可以做确立路线所必需的最小实验，但不把精确转写或深度解题循环当成基线完成条件。逐字形辨识、精确串转写、高解析分字／字型比对等核心深解归 Domain Solver；必要渲染或看图并非一律禁止（`V1:21–24`；`product/opencode/agents/domain-solver.md:7–18`；`R11:85–95`）。

每次记录发生有意义更新时，recon 用其中的事实判断：本轮基线是否完成；剩余侦察区别能否改变路线判断；继续是否已进入 Solver 的求解责任。**基线已完成且剩余侦察路线耗尽／价值低，或者后续是 Solver 深解时，停止实验、固定已有材料并经原生 task 交回。** 不要求证明整题所有解法都穷尽。基线因能力／材料不足受阻且无证据支持的可行侦察时，同样交回“部分基线＋缺口”，不填造完成。

还有高价值、范围内的基线问题时可继续，先消费已有具体线索；排序仅限本轮问题的调查顺序。整队路线、资源、换题和分派仍由 Strategy／Coordinator 决定，recon 不成为第二 planner（`V1:19–24,47`；`product/opencode/agents/recon.md:20–28`）。

针对 r11 的行为对照：发现坐标编码与可视化路线后，补完必要基线，将已做对照、仍辨不清的位置类型与原始证据交 Solver；不继续以新文件名、裁切和方向变体追逐精确文字。也不把“已有第一张图”硬编码为所有题的退出条件，或规定所有题最多一张图（`R11:76–95`）。

## 4. Host 兜底：延期且有条件

人类明确采用先结构、后按证据决定兜底。项目 L1 教训是 **prompt 单独不可靠**；这里已有交回提示仍被 r11 忽略，迁移记录也只确认先前 A+D 装配，不证明及时交回（`product/opencode/agents/recon.md:25–28`；`R11:99–110`；`2026-10-22-ctf-agent-current-state-and-migration.md:22`）。切片 1 的待验证价值在问题结构、持续记录、实际消费与职责边界，不能包装为“多写几句就保证执行”。

**本切片不改 host。** 仅当切片 1 真实 run 显示结构＋记录不足，才进入有条件的下一切片：若基线／低价值判断已可得仍延迟交回并挤压下游，研究一个 per-recon 时间／步数 cap；若失败证据指向记录不可见或恢复消费入口不足，再考虑一个窄 A2 状态面。只补已证缺口，不自动并做两者。

诊断中的 3–5 分钟建议是未实施的反事实估计，**不是本设计批准的 cap 值**（`R11:112–117`；`研究:72`）。未来兜底应先核实公开 OpenCode 接口、在途工具收束和可交回性；host 到点取消也不能冒称已完成交接。A2 如获证据支持，身份、引用、存储／可见性由 host 负责，语义判断仍归角色；仅一个状态面，不建 progress 与队列双主本、不选路、不重造会话循环（`V1:45,133–135,230`；`研究:138–150`）。本草案不预定其接口或实施授权。

## 5. 排除红线

| 人类用词／相关延伸 | 已定最小薄形式 | 明确排除的越界形式与依据 |
| --- | --- | --- |
| “排隊” | 主本内按调查价值排列本轮问题；可据新证据调整。 | A4 攻击图、DAG、自动意图生成、scheduler、worker 认领／重试系统。`V1:13,45,133–135`；`CLAUDE.md:58`；`研究:140,175`。 |
| “記住已探索” | recon 单维护的题内 Markdown，已有 artifact 快照和 task 摘要交接。 | 跨 run memory、统一记忆服务、知识图谱、事件源／重放平台；progress lead 与 work queue 双建。`AGENTS.md:26–28`；`研究:137–150,176`。 |
| “去重” | 同问题、相同前提／状态下参考已试结论；复验有变化理由，区分 tested 与 refuted。 | 相同 URL／工具硬禁、语义匹配即拒绝。POST 改状态后再次 GET 是合法必要观察；不同参数也可能绕同一瓶颈。现有指纹仅观测。`apps/launcher/src/progress-ledger.ts:90–137,298–327`；`研究:46–49,146–150,178`。 |
| “寫成skill” | 一份有来源、适用条件的按需方法，常驻只留短骨架。 | B4 自演化 KB、RAG、skill-router、自动评分／蒸馏成功答案为触发器、每题强制加载。知识须固定并 run 外审核。`V1:43,81,119–123`；`研究:158–169,179`。 |
| “Reference 帮 recon” | 直接读已发布方法；必要时 Coordinator 问现有 Reference。 | 新 knowledge-agent 层、每题必经知识代理、给 recon 新委派权或给 Reference 原始实验权。`product/opencode/agents/reference.md:7–14`；`apps/launcher/src/control-service.ts:25–31`。 |
| “recon 更自主／兜底” | 按问题调查基线，交回路线；host 仅后续按证据补资源／状态缺口。 | recon 第二 planner、深解转写循环、新监控／唤醒调度框架、自建 provider loop 或 OpenCode fork。`V1:19–24,45,133–135`；`AGENTS.md:16–19`；`product/opencode/agents/coordinator.md:30–38`。 |

真题驱动要求方法／机制服务已观察缺口，真实模型行为单独验收；不靠新增 fixture／gate、硬编题解或更大通用底座替代验证（`V1:29,39,93–95,176`；`CLAUDE.md:58–63`）。本设计不新增 OCR、视觉或精确转写能力，也不作此类能力声明。

## 6. StrikeAgent：只借原则

研究对象为 **Yean-Sec/StrikeAgent_AtkBrain-Flash**，研究固定版本 `7526baa7ea88de04b1900f04a06b13b77ab5682e`。**人类已确认这就是所指仓库（2026-10-29）**；仍只借下列原则、不把同名项目混为一谈，也不引用 stars 或宣传作为能力证明（`研究:84–112,126`）。

只采用三项原则的薄表达（`研究:118–123,182`）：

- **稳定问题身份与证据版本分开**：同一问题连续记实验；输入／状态改变时保留变化依据，不因新图 hash 就宣称新问题，也不新增 strategy_key 数据库或唯一索引。
- **否定结论反馈**：将有范围的反证写回主本，在恢复和交接中实际使用；tested、无命中与 refuted 不混同。
- **方法适用资产**：方法说明何时适用、不适用、如何区别解释及来源；不携题目答案，不自动进化或跨局检索。

不移植 Pi 运行时、攻击图、依赖调度、持久 frontier、red-team spiral、worker 或跨局演化平台。外部静态机制存在不证明其效果优于本项目；本设计无需等待仓库消歧即可按已定 A1＋B3 编写，但任何进一步外部归因须先确认。

## 7. 切片计划：当前一片与条件去向

**2026-10-29 更新：slice 1 verified FAILED（r12）。** 下表及 §4、§8、§9 保留 slice-1 设计时的历史措辞，不再表示 slice 1 未部署或 host 仍须延期。r12 已部署短骨架和可选 Skill，但 skill/read 均为 0、workspace.write 为 0、未尝试创建主本、artifact.publish 为 0；Recon 仍有 95 model.call、66 jobs、51 次 view 尝试（49 成功），继续 render → view → adjust 字形循环。可选 Skill 未加载本身不违规，失败在必要记录、职责边界和可消费交接没有落地。约 29.5 分钟是会话生命周期；有效交回为 950.293 秒（15:50.293），其后约 818.720 秒为空闲，不能都算作探索。依据：下文 **R12:19–50,73–93,156–185**。这与 r11 再次印证 L1“约定／prompt 单独不可靠”；人类已选择 slice 2 的 **host-enforced recon bound＋修复发布交接＋可信预算可见性**，细节以新增 §10 为准。只批准本次设计草案，不构成实施或重跑授权。

| 切片 | 能力边界 | 何时停止／进入其他去向 |
| --- | --- | --- |
| **切片 1：当前唯一实施目标** | 约定层结构：`recon.md` 极短骨架＋一份按需方法 Skill＋A1 主本与交回／恢复约定。复用 workspace、artifact、task；无 host 改动，行为可由 run 核验。当前仅设计草案，角色和 Skill 尚未改。 | 完成资产／内容核对后，真实行为待独立授权 run；若结构有效就到此停止。不能因没有模型授权把静态通过写成行为通过。 |
| **切片 2：有条件 host 兜底** | 仅在切片 1 run 证明及时交回仍失败时，研究 per-recon 时间／步数 cap 的最小职责。 | 先记录失败版本、条件、交回点及在途行为，再定范围；不预定数值、不自动执行。 |
| **更后：确需才考虑 A2** | 只有证据说明私有 work＋已有交付不足以满足题内状态可见／恢复需要，才考虑一个窄 host 状态面。 | 先解释 A1 具体失败在哪里；不以未来“可能忘记”建底座，不引入跨 run memory。 |

这是条件分流，不是预排长期 roadmap；本文件不展开后续实施步骤（`AGENTS.md:30–35`；`CLAUDE.md:21–25`）。

## 8. 待答

仅余以下小问题，不重开 A1、B3、单一主本、职责边界或 host 延期决定：

- ~~人类所指 StrikeAgent 是否正是 `Yean-Sec/StrikeAgent_AtkBrain-Flash`？~~ **已确认（2026-10-29）**：即该仓库，仅借 §6 原则，不移植平台。
- 后续首个行为验证批次的具体授权参数：目标／初始状态、模型／provider、批次边界、token 上限及允许的续接／重试范围。恢复判据需要同批内同 task 续接观察；不默认多开 run 或启用压缩。本问题不阻止当前两份草案交付，未授权就不运行（`AGENTS.md:49–53`）。

## 9. 验收：看 run 行为，不看措辞命中

| 判据 | 可核对的行为证据 | 不算通过的替代指标 |
| --- | --- | --- |
| 及时交回 | 按分派完成必要基线后，记录显示剩余侦察路线耗尽／价值低，或下一步属 Solver；recon 随即收束、返回基线与路线，Solver 实际得到可用材料与执行时间。用事件／transcript 对齐基线、发布、交回和下游开始，不预设所有题相同分钟阈值。 | 调用更少、宣称“已交回”、只发布未返回；或把首图等单工具结果硬定为基线完成。 |
| 主本被维护并消费 | 有意义实验后实际更新同一问题记录；同 task 恢复先读记录，并在下一项选择、合理复验或交回中采用已有观察／反证。无恢复场景时此项记未验证。 | 文件非空、清单非空、读过文件但仍忽略结果；宣称已验证跨 run／崩溃恢复。 |
| 调查有结构 | 能从问题追到区别性实验、实际观察及证据，再追到剩余路线判断；新视图／参数只有能区别解释才继续，tested 与 refuted 的边界正确。 | Skill 已加载、固定字段齐全或模板措辞命中；新图片数量等于新信息。 |
| 下游可用与角色守界 | 原生返回有去敏摘要与真实 ref；授权接收者实际读到必要证据，保留歧义、未知和重试条件；精确转写／深解由 Solver 承担。 | 私有 work 路径冒充跨角色引用、快照固定冒充已消费；view 成功冒充 OCR／识字通过。 |

真实验证须沿用产品入口、保留版本、初始条件、知识／工具配置、失败及实际用量；usage 缺失记 `unavailable`。同批要求不能用不同 run 的局部成功拼接；r11 是失败对照，不是新版行为结果（`V1:93–95`；`AGENTS.md:39–43`）。

静态审阅只证明约定一致、资产可发现／可读取；真实 run 才能证明本次角色行为，且不能自动外推效率、通用解题率、精确视觉能力或 solved。solved 仍按 V1 §1.3 的独立审阅与可信裁判整题完成判定。**当前交付只有两份审阅草案；无实现、无行为验收、无 challenge run。**

## 10. Slice 2：宿主约束、可消费交接与预算可见性（评审草案）

### 10.1 已定目标、证据口径与红线

人类已选定三个部分作为同一主题：限制 Recon 对全队时间的占用，限额内留出发布／交回窗口，使 Solver 真正取得固定证据，并让各角色看到宿主已知的预算。不是再次征询是否需要 host 兜底。§4 的延期条件已由 r12 满足；§8 的“host 延期决定”仅作历史记录。当前代码仍无本节新增能力。

新增证据缩写（行号是本次只读工作区快照；未用 Git 核验版本或 dirty 状态，不能将当前代码冒充 r12 完整部署快照）：

- **R12**：`/Users/caihaoming/Documents/pentest-agent-run-data/seizurecipher-debug-20261029-r12-recon-slice1/runs/seizurecipher-debug-20261029-r12-recon-slice1-1/recon-r12-diagnosis.md`。失败行为取自该诊断，未重算 transcript、未读 oracle 或输出答案。
- **R12-state**：同 run 的 `state/run.json:35–39`，本次直接读取 budget：wallClockMs=1800000、maxSteps=3000、maxToolJobs=100、maxObservableTokens=5000000。这些是历史配置，不是本设计的新默认值。
- **C**：`apps/launcher/src/control-service.ts`；**J**：`apps/launcher/src/job-tools.ts`；**P**：`apps/launcher/src/progress-ledger.ts`；**A**：`apps/launcher/src/artifact-tools.ts`；**L**：`apps/launcher/src/launch.ts`；**Plugin**：`apps/opencode-plugin/src/index.ts`。下文均为这些文件的 file:line 引用。

红线：只在薄控制层已有预算／task 机制上做小增量；**NO scheduler / monitor / watchdog / wakeup / framework / DAG / planner**，不重造求解循环、不 fork OpenCode。保留 recon→solver 的同步 dispatch，不把 background 当作解决方案；现有 Verifier 的 background 规则不在修改范围。交接只用 artifact.publish/read，无新 transport、共享可写 work 或整目录自动复制。recon 不成为 planner；无 auto-evolving、memory、RAG。依据：`AGENTS.md:16–19,26–35`、`CLAUDE.md:21–25,58–64`、`V1:13,43–47,133–135`。宿主 cap 只改善**时间／资源分配**，不会提高精确字形转写能力；后者是独立轨道，不纳入 slice 2（`R12:143–150,204–210`）。

### 10.2 当前链路：已确认的强制点与缺口

| 链路 | 当前实现及证据 | 对设计的约束 |
| --- | --- | --- |
| 全局墙钟 | `L:204,227–229` 用 deadlineMs 覆盖值或 profile.wallClockMs，在 OpenCode 启动后计算 deadlineAt；`L:261–292` 既有循环检查 deadline 并 stopAll。`C:198–199,471–472` 根／子 binding 共享 expiresAt，`C:432–435` 每次 live 检查过期。 | wallClockMs 不是每个子任务的独立额度，也不是从 launch 最初一刻起计时；已有循环和准入点足以承载小扩展，不加计时服务。循环含 SDK await，不能承诺精确毫秒硬实时停止。 |
| 模型步数／token | `C:40–45` RunBudget 只有 maxModelCalls/maxObservableTokens；`L:228` 将 maxSteps 映射到 maxModelCalls。`C:224–250,483–497` 在刷新 usage 后串行再检查，按全 run admitted 计 model.call；达到上限 stopAll。`C:344–350` 检查已观察 token。 | maxSteps 是 admitted model calls，不是工具数或 per-task turns；需另在已有 Execution 上归属当前任务轮次，不能从 assistant 消息数猜。usage 不完整不冒充实测全量。 |
| 工具准入／执行 | `C:500–515` tool.before 检查权限和超时；`C:692–715` execute 再检查、按 session/callID 去重并登记 Resource；`C:717–754` 异步准备后检查 live，再启动真实 job。 | 新预算检查必须覆盖 before 和 execute，串行执行处只扣一次；异步等待后重查关闭／停止，不能只靠 prompt 或 before。 |
| 绑定与同步任务 | `C:438–479` SDK 父子身份和原生 task call 关联后绑定；`C:519–566` 两种模式都建 Execution，sync 另有结果视图；`C:965–990` 续接校验所有权及 active execution。`C:995–1004,1096–1134` 可信终态结算及 syncDisplay。 | 用现有 Execution/Binding，不能另建任务平台；续接有新 Execution，不能借此重置同一 Recon 配额。 |
| 发布／私有路径 | `C:911–914` work 映射到调用 session；`C:836–841` 普通 read 落到 readWorkspace；`apps/launcher/src/workspace-tools.ts:51–59,99–108` 路径缺失拒绝。`C:770–792,825` 发布／读取走 registry；`A:57–85` 固定 bytes、生成 ref、按 run/challenge 及 hash 核对并分页。 | r12 Solver 读 `work/points_from_lol.txt` 实际是在读自己的空 work，拒绝是隔离正确，不应放开 sibling work。 |
| 预算可见性 | `C:585–589` 已在 progress.read 的 `completion.budget` 返回 admittedModelCalls、maxModelCalls、observedTokens、maxObservableTokens、deadline、stopped；`C:662–664` 仅 Coordinator/Critic 可读。`P:314–327` 本体是事件摘要、usage 与重复调用分组。 | 不是“host 没有预算接口”；缺少剩余量、任务归属和默认可见路径，Recon/Solver 不应为此获得全量进度日志权限。 |

### 10.3 最小 per-recon bound 与收束窗口

**已定行为**：探索额度耗尽先进入受限收束，不立即撤销 binding；收束仍允许整理必要记录、发布已有证据、原生交回。收束到期才停止该 Recon，保留已发布引用与未完成原因；不因某 Recon 耗尽局部额度就 stopAll 整队。全局 deadline、token/step 上限及显式停止始终优先，窗口不得延长总预算。`C:315–331` 的 stopChild 会 revoke、取消资源并 abort，`C:432–435,790` 随后无法 publish，因此**不能拿现成硬 stop 当软收束入口**（`R12:181–192,204–208`）。

**推荐的最小机制（待实施核验）**：优先以宿主计数的 model.call **步数上限＋预留收束轮次**落地；墙钟边界复用现有 deadline 检查，不要求模型计时。步数可确定性拦住无休止 render/view 变体，避免一开始就引入异步唤醒。若同时配置 Recon 墙钟上限，则在既有 `checkBudget` 调用及 admission 边界检查软／硬截止；不新增 timer loop。数值由单独预算配置决定，不在本文指定 cap 数字，r11/r12 的 3–5 分钟只是未经批准的估计。

1. **归属与防重置。** `Execution` 保存当前调用的 admitted turns 和收束事实；同一 run/challenge 的 Recon 额度由现有 host 预算持有并累计，复用或新建 Recon session 不重置。前者回答“当前任务几轮”，后者避免 Coordinator 通过续接／重开绕过上限。这是本文推荐的窄配额作用域，不给其他角色新增配额系统。首次 Recon 可信绑定时启用墙钟（若配置），后续保持原截止；不从 prompt 中采信 elapsed/remaining（`C:107,137,455–477,550–563,970–980`）。
2. **窗口在总额度之内。** 设 Recon 总调用额度为 B、收束预留为 R，要求 0<R<B；探索最多 B−R 次，收束仍最多使用原 B 内的剩余调用。若采用墙钟，同样从局部总时间内扣除 closure 时间，并裁剪到全局 expiresAt；总／局部预算不足以容纳收束时明确拒绝继续探索或直接报告不足，不虚构“保证交付”。不硬写 B、R 或分钟值。配置只允许宿主装载，不由 Coordinator 自增。
3. **强制内容是工具能力，不是语义判卷。** 收束期间禁止新的 job.run、http.request、workspace.view、搜索／diff、skill/read 等继续探索入口；仅保留本会话 workspace.list/read/write、已有 job.read/cancel、artifact.publish/read 和最终文字交回所需模型调用。写权限仍限私有 work，发布仍按原权限、大小与完整性规则。不给 job.run “最后一次处理”的例外，否则可继续同一循环。准入在 `C:483–512,692–715` 重查；收束事实通过 §10.6 的现有返回路径展示。不判断字形、路线价值或文本是否真的总结。
4. **在途工作。** 已准入 job／HTTP 不在切换软边界时假装完成；复用 Resource deadline/controller，执行前在异步等待后重查，最多运行到局部硬截止与全局 deadline 的较早者。已进入收束但资源未 settled 时，不能发布它的 job 流（`J:146–152`）；返回已有材料及该缺口。文件快照不会把未知 producer 升级为可信 producer（`C:773–779`）。
5. **已有同步结束路径。** 收束正常返回沿用 `toolAfter`／`settleSync`；空正文、length、未知来源仍按既有 completeness 分类，不能因为 cap 命中改成 complete。硬边界复用局部 stopChild 及取消路径并保留 unknown；父 Coordinator 应得到局部 stop 原因和可确认 refs，不得只见无信息 abort。全局仍可运行时由原生同步 task 解除等待后继续（`C:995–1004,1096–1134`）。
6. **提前固定，避免空手。** 不把所有发布延后到最后一轮：有首份可用基线就发布必要快照，收束时只补已改变材料及简短记录。host 能保证不再准入探索、保留窗口和已确认 ref；**不能保证模型在窗口内一定写完或自然语言总结正确**。若窗口内仍无可消费产物，记 slice-2 交接行为失败，不把止损当验收成功（`R12:93,158–162,189–192`）。

**窄技术待验证点**：一次已经发出的 model.call 可能跨过软截止；当前 chat.params 只限制 maxOutputTokens（`Plugin:148–152`），没有证据证明可中断推理后继续同一同步 task 收束。故推荐首落步数预留：在下一轮调用前进入收束，并保留全局硬 deadline；它是步数约束，不宣称严格局部墙钟 SLA。若人类要求严格局部墙钟且在途模型也必须获得完整 closure，需先核实原生公开接口能否安全完成；不默认切 async、不暗加唤醒／自动续接。既有循环检查包含 `refreshObserved`、SDK status 等 await（`C:345–347,413–423`；`L:261–292`），其时延也不能忽略。

### 10.3b DESIGN UPDATE：自然交回优先，显式高上限仅作异常兜底（待人类评审）

**状态与替代范围（2026-10-30）**：本节是设计草稿，不是实施或真实运行授权。保留 §10.3 原文作为历史依据；本节建议取代其“统一的固定调用阈值适合作为常规 Recon 收束时点”的使用方式，以及其中把步数 cap 等同于及时交回的预期。保留 B/R 配置、局部 closure、可信计数、同题累计、全局预算优先及独立局部停止的边界。**不是否定所有固定数值上限：否定的是跨题一律用紧阈值来决定何时结束正常侦察。** 以下只涉及预算、准入与生命周期，不解读任务内容。

#### 证据与统计口径

本节源码引用使用本次读取的仓库行号，简称 **CS**=`apps/launcher/src/control-service.ts`、**RP**=`apps/cli/src/composition/releaseProfile.ts`、**Schema**=`config/release-profile.schema.json`。历史 §10.2–10.3 的 C/L 行号不作为当前实现行号。

审计根目录为 `/Users/caihaoming/Documents/pentest-agent-run-data/`；三个 run 的相对目录如下，每个目录下 **A** 指 `evidence/control-audit.json`，**S** 指 `state/run.json`：

- **r13**：`seizurecipher-debug-20261029-r13-recon-cap/runs/seizurecipher-debug-20261029-r13-recon-cap-1/`。
- **r14**：`mfw-debug-20261029-r14-recon-exploit/runs/mfw-debug-20261029-r14-recon-exploit-1/`。
- **r15**：`throwback-debug-20261029-r15-recon-exploit/runs/throwback-debug-20261029-r15-recon-exploit-1/`。

计数为对各 A 的完整 JSON 数组筛选 `role == "recon"`，分别统计 `op` 和 `allow`；HTTP 为 `op == "tool.before" && detail.tool == "ctf_http_request"`，发布为 `op == "artifact.published"`。不把 tool.before 等同于执行成功、HTTP 成功或网络请求实际完成；不读取参数、响应、产物正文或候选内容。时间为审计 `at` 差值，不是模型推理耗时。下表每行来源即相应 A 全量计数，定位锚点另列。

| run | 生效 cap | model.call 准入／拒绝 | tool.before 准入／拒绝 | HTTP tool.before 准入 | artifact.published | 首末模型准入跨度 | 首模型准入至交回记录 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| r13 | B=35，R=10；S:40–47 | 28／0 | 40／1 | 3 | 5 | 120,310 ms | 132,367 ms |
| r14 | 两字段缺省，OFF；S:37–42 | 14／0 | 23／0 | 11 | 3 | 86,320 ms | 97,723 ms |
| r15 | 两字段缺省，OFF；S:37–42 | 142／0 | 189／0 | 127 | 1 | 751,492 ms | 768,708 ms |

三个 S 的全局配置相同：wallClockMs=1,800,000、maxSteps=3,000、maxToolJobs=100、maxObservableTokens=5,000,000（r13 S:41–44；r14/r15 S:38–41）。这些是历史预算，不是本次授权或新默认值。

- r13 A seq **41–298** 为首末 Recon model.call；seq **248** 为第 24 次 exploration，**255** 为第 25 次 closure，**257** 拒绝一次探索 tool.before，**297** 为第 28 次 closure；seq **300** 的 `task.result` 为 `finish=stop, completeness=complete`。这证明局部 closure 后仍能交回；28<35，**没有覆盖 B 耗尽硬停**。最终 S:3 为 deadline_exceeded，不把局部交回说成整场成功。
- r14 A seq **46–177** 为首末 model.call；seq **179–180** 为同步结束／结果，`state=completed`、`finish=stop, completeness=complete`。无 cap、无 Recon 拒绝记录，自然交回发生在 14 次准入后。
- r15 A seq **45–1132** 为首末 model.call；seq **1134–1135** 为同步结束／结果，`state=completed`、`finish=stop, completeness=complete`。无 cap、无 Recon 拒绝记录，自然交回发生在 142 次准入后。seq **1595** `completion.saved` 的机械结果为 `state=confirmed, sent=true, solved=true`；只引用结果状态，不解读提交内容，不把 S:3 的 completed 单独当 solved 证据。

**结论及限度**：r13 的窄阈值成功触发收束；r14/r15 在无 cap 时均能自行交回，调用量却相差约十倍。若把 B=35/R=10 套到 r15，按现有逻辑第 25 次准入后就会禁止继续探索，无法保留所观察到的 142 次自然轨迹；“可能因此失去 solve”是反事实风险，未经重跑证明。三例支持放弃统一紧阈值，不能证明所有题都会自然交回，也不能从计数判断哪一轮语义上已无收益。把 r13 视为已知过跑场景是本次人类提供的任务背景；这里不通过内容分析重新判定病态。

#### 当前机械契约与薄层约束

当前 `admit` 先检查全局预算，再按 Recon 累计准入加一：`n>=B` 标 exhausted，否则 `n>=B-R` 标 closure（CS:498–522）。因此第 B−R 次已是 closure，第 B 次可完成文本交回，但下一次受检查的模型／工具入口才走 `checkReconExhausted`；不能写成“B−R 次探索全部执行完后才收束”或“第 B 次立即中断模型”（CS:540–550）。

`reconQuota` 只对已配置两字段的 Recon 生效，并以 challengeId 在当前 service/run 内累计；execution 单独记数，同题重派不退款（CS:509–537）。`checkReconTool` 的 closure 白名单为 workspace.list/read/write、job.read/cancel、artifact.publish/read；探索被拒绝但保留发布出口（CS:553–564）。硬停保存已发布 refs 和 unknown result facts，走 stopChild；局部 cap 不调用 stopAll（CS:540–550）。全局 token/step 耗尽仍有自己的 stopAll，不能因“never stopAll on closure”删除它（CS:359–366,498–506）。

**约束／设计决定**：host 只使用可核验的 model.call 数、经过时间、tool.before 数、规范化工具调用指纹、发布计数、拒绝计数；这些都不等于覆盖度。是否已映射足够范围、是否继续调查、材料是否有价值由 Recon／Strategy 判断。不得把路径、页面、产物数量或模型自述包装成 host 的覆盖评分；不得让 host 阅读正文判定“有无新知识”。这沿用 host 负责身份／预算、模型负责选择／解释的职责（`AGENTS.md:16–20`），也是本次明确约束。

#### 选项与取舍（均为设计候选评价，不声称已验证）

| 选项 | 对三例的机械影响 | 代价与风险 | 决定 |
| --- | --- | --- | --- |
| (a) 宽松／弹性预算，按类型或 run 配置 | 事前给已知过跑 run 紧 B；给未知／大调用量 run 高 B，可同时容纳 r13 的紧约束与 r15 的 142 次轨迹。现有 RP:11–13,53–58 已支持每份 profile 提供 B/R。 | 谁分类、谁加预算必须明确；host 自动按“web 大小”分类会越界。随指纹／发布自动扩额可能被变体无限续费，还需新状态。 | 只采用**运行负责人事前显式选 profile**；首切不加类型分发表、运行中扩额或新配置层。 |
| (b) 连续 N 次准入无新发布且无新指纹则 closure | 能捕捉完全重复调用，但只有 1 次发布的 r15 说明“发布稀疏”本身不能代表停滞；本次未计算连续无新指纹窗口，不能宣称此规则能区分 r13/r15。 | 合法长分析／重试可能误触；改参数、nonce、路径或重复发布可逃避；规范化过强又误合并。工具成功／新指纹也不表示语义收益。 | 不纳入首切。若以后有明确误跑证据再研究，至少需要显式 N、宽松最小启动额度、在途 settled 的窗口定义和独立最高 B；不得以语义评估修补误判。即使加这些边界也不能消除误伤。 |
| (c) 自然交回为主，固定数只留作高异常上限 | r14 的 14、r15 的 142 都不应接近 closure；r13 仍可显式用历史紧配置。现有状态机足以执行。 | 对未事先识别的过跑，止损更晚；高 B 不能保证先于全局墙钟/token 触发，也不能保证任何规模的正常任务都不被截断。 | **推荐最小形式：(c)＋(a) 的事前人工配置。** 不建立自动弹性或收益代理。 |

时间触发也只是机械兜底：三例首调用至交回分别约 132／98／769 秒，统一短时限同样可能截断 r15；调用跨度不能推导可泛化时间限额。首切不增加局部计时器、监控、唤醒或严格墙钟 SLA，沿用已有全局 deadline（本节审计计时；§10.3 最后段）。

#### 推荐最小契约与首切可实施边界

1. **未配置仍 OFF/unavailable**，既不填隐式高默认，也不保留隐式 35。两字段要么都缺省，要么是满足 `0<R<B` 的安全整数；沿用 RP:53–58 与 Schema:23–35。OFF 只关闭局部 Recon cap，不关闭全局预算。
2. **配置负责人是运行负责人／人类，不是 Recon、Coordinator 或 host 分类器。** 在 run 前按允许成本、历史机械计数与目标范围选择既有 release profile；未知规模可保持 OFF，若需要兜底则明确给高 B/R。不得因高 B 自动提高全局预算，不得运行中重置／扩额；同 run 多题当前共享同一配置数值、各题独立累计，不新增每题 override map（CS:525–537；RP:11–13）。
3. **供评审的显式宽松配置示例为 B=512、R=10，closure 点 502**：502 约为已观察最大值 142 的 3.54 倍，给出显著余量；保留历史 R=10 避免同时改两种策略。512 是候选工程余量，不是三例估计出的最优值、生产默认或本次真实调用授权；R=10 也未证明普适。历史 B=35/R=10 仅作已知过跑场景的显式选择，不作为通用模板。这些值只进入显式配置／测试输入，runtime 不硬编码。以后不同预算可换值而不改程序。
4. **closure 公式不另造**：仅当已配置且累计 n 达到 B−R 时收束，B 为最终局部上限；自然交回可发生在任意更早时点，不等待凑满配额。阈值表达的是预算压力，不是“已经侦察充分”。本推荐实质是改变 cap 的使用政策和配置量级；当前 CS:509–558 已能执行，不为制造代码差异另加 mode、阈值函数、计分器或 scheduler。首个实施切片是澄清配置语义并用现有入口验证高配额、紧配额、OFF 三种行为；若原谓词完全满足，不要求修改它。
5. **保留 closure 与硬停出口**：准入／工具入口及异步重查不得绕过；同题换 session／重新派单不重置。局部 closure 或耗尽绝不 stopAll；父任务得到真实状态、可确认 refs 与局部原因，abort 不确定保持 unknown。并发限制及 maxToolJobs 不变。全局 deadline/token/step 仍优先，不能保证剩余预算一定足够 R 次交付。
6. **硬停证据严格分层**：本次只读发现既有无模型用例覆盖 B 后拒绝、只 abort 本 child、stopAll 未调用及 unknown 传播（`tests/contract/slow-tools.test.ts:94–144`）；本次未执行。r13 止于 28<35，r14/r15 未配置 cap，三例均未验证真实模型达到 B 的硬停分支。首切可做无模型边界回归，仍须把真实硬停标为未验证；不得以测试通过或正常交回代替它。

本节不改变已有章节的其他交付项，也不恢复历史待办；所有实施／模型运行均待另行授权。本次仅写设计与单步计划供人类评审，无产品修改、git、网络或挑战运行。

### 10.4 修复 Coordinator→Recon→Solver 的发布与消费链

**诊断事实与文本来源分开。** `R12:156–162` 记录实际分派分别要求 Recon“不自行发布产物”、Solver“不发布产物”，随后传私有 work 路径，seq 816–819 拒绝且 publications.json 为空。当前 `product/opencode/agents/coordinator.md:20` 反而明确同步／背景均可发布；`:40–43` 的 ref 交接主要写成“给 Engineer”；`:25–31` 的 recon/solver 分派要求未明确落实上游产物消费。因此不能声称仓库 prompt 存在一条可直接删除的“不发布”原句，也不能证明仅改 wording 就会改变模型行为。

**已定交接契约**：

- Coordinator 的派单不能覆盖来源角色的发布职责；“不提交裁判／不做 package”不得写成“不发布 artifact”。Recon→Solver 同样执行真实 ref 交接，不只 Engineer 路径执行。`product/opencode/agents/recon.md:20–24`、`domain-solver.md:30–34` 已有发布契约，修订时保持一致。
- Recon 在本 session 完成写入／job 后选**下一角色确实需要**的材料发布：已提取的结构数据、来源／基线说明、去敏主本快照，以及确实有用的结构图。不是每题固定文件清单、不是把 94 个文件全部打包，也不强制一张图代表基线完成。使用 `artifact.publish({source:"file",path:"work/..."})` 或现有 settled job／HTTP 来源；host 产生 ref 和 hash（`C:770–792`；`A:57–69`）。
- 原生 task 交回只带真实 ref、用途、必要提取说明、覆盖范围及未知；Coordinator 原样转交 Solver，不猜 hash、不自造 ref。缺 ref 时明确“材料未交付”，可在剩余额度内请求原 Recon 仅发布已有文件，不能把私有路径冒充输入或默认重跑实验；传输状态未知遵守既有暂停／不盲重发规则。
- Solver 用 `artifact.read({ref,cursor})` 分页读到需要的 bytes，完整读取要求到 done/nextCursor=null；图像可用发布返回的 path 经既有 workspace.view 查看，不能把 base64 文本当视觉输入。读取可信 ref 与实际消费分开记录；需要本地加工时只在 Solver 自己的 work 写必要派生文件，不另建传输机制（`A:73–85`；`C:825,843–858`；`Plugin:124–126`）。
- 原始来源缺失、被篡改、异题 ref 必须继续拒绝；文件 producer 未知仍保留 execution:null／originalComplete:null，不借本次交接补造来源（`A:73–78`；`C:773–779`）。Solver 后续交 Engineer 的候选／最小复现证据仍沿用原发布契约，不在此新增候选整理／验证流程。

这是首个推荐实施切片：**修正派单契约并以现有真实 artifact 通道验证跨角色消费**。只加 cap 会把“晚交回但无 ref”变成“早中止但无 ref”；先让局部结束有交付出口，收益直接对应 seq 816–819。这个切片的无模型测试证明接线，不证明模型会遵守；它不替代 §10.3 的 host bound，也不单独宣称 slice 2 完成。

2026-10-29 first cut 结果：三份角色约定已对齐，`d-artifact-handoff.test.ts` 经真实同步 task 准入／SDK 可信子绑定建立 Recon Execution，以真实 ArtifactPublisher 发布非秘密 32773 bytes，经 Coordinator 的原生 task 结果／输入转交原 ref，Solver 在空私有 work 下两页 artifact.read 重组相同 bytes；原文件修改后的快照固定、私有路径、伪造／异题／损坏 ref 拒绝均通过。只替换 SDK 身份／消息事实，无预置 publications／bindings，不运行解包／渲染 job。此结果验证控制链和 bytes，不验证真实模型会遵守约定，也未新增图像能力或验证视觉判读。

### 10.5 maxToolJobs：当前为未接入，最小补齐全 run 累计准入

`R12:172–183` 已排除重复事件计数：134 个不同 callID 的真实 job.run，第 101 个在 seq 1147 仍准入。当前源码进一步定位：

- `apps/cli/src/composition/releaseProfile.ts:11,47–49` 读取并校验 maxToolJobs；`R12-state:35–39` 保存了 100。
- **`L:228–229` 创建 ControlService 时只传 maxSteps 与 maxObservableTokens；`C:40–45` 根本没有 maxToolJobs 字段。** `C:692–715,754` 也没有全局累计 job gate。
- `J:15–16,177–180` 仅对尚未 settled 或清理未知的 job 限制每 session 2、每 challenge 8；与配置中的 100 无关。settled job 释放的是并发容量，不是一个错误重置的 maxToolJobs 计数器。

因此，**当前代码证实配置未绑定到累计执行准入**；不是 per-session=100，也不是 maxToolJobs 的并发语义或已存在计数器的生命周期 bug。该静态根因与 r12 现象一致；未逐字对照 r12 全量部署源码，保留这层版本归因限制。

推荐修复语义：maxToolJobs 是同 run 所有角色／题目累计的 **job.run 准入上限**，独立于并发限额。由 launcher 传入既有 RunBudget；在 `prepareSolver` 的串行状态变更段、验证身份与唯一 callID 后、任何异步启动前原子检查并消耗一次。tool.before 只预检，不扣第二次；execute 不能绕过；job.read/cancel、发布和读取不扣 job 数。已准入但启动失败／取消仍计消耗，明确叫 admitted jobs，不冒充成功进程数，不回退计数、不靠新 session 重置。这样不需要另一套 reservation 生命周期（依据 `C:189–190,229–252,692–709`）。

到达 N 后第 N+1 次应拒绝、无 spawn／无新 job handle；同时到达的两个调用不能都越界。耗尽 job 配额只禁新 job.run，**不自动 stopAll**，否则再次封死 artifact.publish 的收束出口；现有全局时间／模型／token 上限照常约束其他调用。返回明确的 job-limit 原因和 remainingJobs=0。此处是拟议契约，不是现状描述；不提高 100 来掩盖问题，也不顺带修所有 budget 校验器。

2026-10-29 first cut 结果（上述“当前／拟议”为接线前诊断）：launcher 已将既有 profile.budget.maxToolJobs 传入 RunBudget；ControlService.prepareSolver 在 handle 的 serial 状态段、身份／唯一 callID 与既有参数检查后、任何异步准备／spawn 前检查并累计 admittedJobs，tool.before 只预检不计数；所有角色／题目共用一次 run 计数，不回退。拒绝经现有 RPC 的消息返回 `denied: job limit; remainingJobs=0`，没有新句柄，不 stopAll；read/cancel／发布／读取和同步交回不扣 jobs。RunBudget 未配置时为 unavailable（job.run 预检同名字段），不补默认、不实现 §10.6 快照。真实 JobManager 并发 2/session、8/challenge 不变。

验证条件与版本：`codex/recon-slice2`；ControlService SHA-256 `ecdca0116c8372d33deffea0e54d451d0364dde8d97e2d80c10b4ac910b36160`，launch `c3dc40f7078e30fea546c38517eb5ec1463041aae55d70c4f090d1f6f601e064`。既有 `slow-tools.test.ts` 新增六例覆盖跨角色／题目累计、末名额并发和异步准备竞态、身份／callID、无退款、耗尽后出口、0／未配置；原并发测试在已配置累计额度下保留。`npx tsc --noEmit`、build、deterministic（40 文件／615 测试）、全套 npm test（51 文件／657 测试）均 exit 0；首次沙箱回环监听 EPERM／HTTP 超时后，在允许本地回环的环境验证，无外网／provider／challenge run。无独立 review；只证明机制可用，不证明真实 Coordinator／Recon／Solver 行为或完整 slice-2，§10.3、§10.6 不在本次范围。未发现须越界修复的产品缺陷。

### 10.6 窄可信预算信号：复用 progress 与工具返回

由 ControlService 用同一准入计数／deadline 生成小快照，不另建 state framework，也不从模型文字或 progress 事件回算预算。建议字段含义如下（名字可在实施时与现有类型对齐，语义不可省略）：

| 字段 | 来源／边界 |
| --- | --- |
| sampledAt、remainingMs | host 当前时间及 max(0, expiresAt−now)，明确这是采样时全 run 剩余时间，不是模型收到时仍精确有效。 |
| admittedJobs、maxToolJobs、remainingJobs | §10.5 唯一累计准入计数；未接线前不能伪造 remainingJobs=100。没有配置／实现时标 unavailable，不写 0 表示耗尽。 |
| currentTaskTurns、taskRemainingTurns、phase | 从已绑定当前 Execution 的 model.call 准入取数；Recon 的探索／收束阶段由 host 判定。Coordinator 无子 execution 时用 null，不把全 run admitted 当当前任务轮次。 |
| taskRemainingMs | 只有配置局部墙钟时才可计算，未配置用 null；与全局 remainingMs 分开。 |
| stopReason／restrictionReason | 全 run stop、当前 task 收束／上限、job-limit 分开；限制新 jobs 不等于整个 run stopped。没有停止为 null，保留 unknown，不推断 solved。 |

暴露路径必须真能进入模型可见内容：

1. 保留 `progress.read` 原有 `completion.budget` 兼容语义，增加以上小快照；`P:314–327` 只投影，权威数值仍由 C 提供。Coordinator 分派／续接前应读真实预算，不再写“deadline unknown”代替可得事实。但不能只靠它主动读 progress，r12 已证明它可能不读（`R12:185`）。
2. 在现有受管工具成功返回及受控预算拒绝中附小快照，使 Recon/Solver 每次工具边界都收到；保持工具原字段、分页、图像 attachments 完整。`Plugin:124–126` 把一般返回 JSON 化，workspace.view 则直接返回 ToolResult，故图像路径要把预算加进可见 output，不能只藏在未渲染 metadata。
3. 原生 task 起始／同步交回也展示同一快照，复用 `chat.message` 的 synthetic text 与 `tool.execute.after` 已有事实展示点（`Plugin:138–140,166–168`）。预算是 host 附加事实，不采信 Coordinator 自报值；不新建通知／唤醒机制。仅在 model.call 的 RPC 结果多一个字段不够：`Plugin:148–152` 目前只使用 maxOutputTokens，模型不会自动看到那个字段。
4. 不给 Recon/Solver 开完整 progress.read 权限；不暴露其他 session 私有 work、凭据、候选正文、完整 argv 或推理。旧 progress ledger 仅按需要记录预算阶段／拒绝事实，不成为第二计数源（`C:662–664`；`P:194–215,257–283`）。所有 await 后停止检查仍保留。

### 10.7 行为判据、真正待决项与授权

整体 slice-2 验收必须同时看到：host 在参数化探索边界拒绝新探索、窗口内仍能发布／读取／交回；局部耗尽不误停 Coordinator/Solver；同题续接不重置 Recon 配额；同 run 跨 session 第 N+1 个 job 被拒且没有 spawn；真实 refs 经同步任务交到 Solver 并被读取；不主动读 progress 时仍能在既有返回看到可信预算。需要覆盖 in-flight／异步准备竞态、收束空正文、hard-stop 未确认和全局 deadline 优先。只取消成功、工具返回 200、测试全绿或本地文件存在都不等于完整交接，更不等于 solved。

真正待决仅为：

- **数值授权**：Recon 总额度／closure 预留及任何局部墙钟值未批准，不能把 3–5 分钟当默认。配置参数化可先做无模型验证；真实批次前必须确定。
- **局部墙钟严格程度**：推荐先采用步数上限＋收束轮次；严格墙钟且要求中断中模型仍能收束的接口可行性尚未证实，按 §10.3 的窄验证处理。若必须改 async 才可行，返回人类评审，不自行切换或新增调度。
- **真实行为批次**：目标、模型/provider、token 总上限、批次及续接／重试范围尚无新授权。确定性测试不能替代 r12 原失败链的真实行为验收，也不新开题目来逃避它。

草案形成阶段只编辑本设计并新建指定单步计划，当时没有产品实现、测试运行、联网、Git 或挑战运行；该阶段只做代码／证据自检，不冒称独立 review。随后获准的 first cut 结果限 §10.4／§10.5 上述记录，不表示批准或实现其余机制；父 design 入口及涉及后续 host 限制的措辞留对应范围处理。

## 11. 交回判断：四种原因与“消除具体不确定性”（人类提出，2026-10-30）

### 11.1 问题

现行 `recon.md` 与 recon-investigation Skill 已有“基线完成、偵察低价值或下一步属 Solver 即交回；受阻交部分结果”，但判断落在“高价值／低价值”上，没有参照物。r11／r12 Recon 都把逐字形试探当成“仍有进展”；r13 Recon 把有限 GET 与源码阅读概括成“无其他攻击面”。本节把停止判断改写成可对照的四种交回原因，并给“价值”一个参照：**是否帮助回答本轮问题**。

全部作为现有角色文字与工作主本里的判断约定，**不新增 schema、字段校验或 host 判断**。host 仍只负责 §10.3／§10.3b 的预算收束。

### 11.2 四种交回原因

| 交回原因 | 判断依据 | 交回什么 |
| --- | --- | --- |
| 本轮问题已回答 | 已有证据足以支持本轮基线结论 | 结论、证据 ref、适用范围 |
| 下一步主要属于求解 | 入口、材料和关键前提已明确；剩余是利用、推导、精确恢复 | 可执行路线、必要材料、尚未证明的部分 |
| 调查受阻或继续价值低 | 缺少必要前提，或剩余实验不能有效区分当前解释 | 部分基线、未解问题、恢复调查所需条件 |
| 额度要求收束 | host 给出的预算事实（closure 拒绝消息） | 当前已有成果、未完成项、停止原因；**不宣称基线完成** |

交回时写明属于哪一种。前三种是模型结合证据的判断；第四种以 host 事实为准，与前三种可同时出现（例如收束时已回答本轮问题）。

### 11.3 落地原则

1. **派单 = 消除具体的不确定性。** Coordinator 派 Recon 时，本轮问题写成要消除的不确定性，而非“做一遍 Recon”。例：
   - Web：确认题面入口、附件源码和实际服务之间的对应关系，找出能支撑下一步验证的入口；部署差异无法确认时明确保留未知。
   - 坐标／图像材料：确认材料如何生成、坐标如何解释，以及能否得到可供后续识别的结构图。**精确读出全部字符不是 Recon 的交回前提。**
2. **继续的理由 = 下一次实验会改变什么决定。** 准备继续时能简短回答：当前还不确定什么？这个实验的不同结果会怎样改变路线或交付？答不出（例如源码已定坐标方向，只是换配色再看）则不足以继续；前提改变后的同 URL 复验（例如登录状态改变后重读）可以成立。由模型结合证据判断；host 不以新文件、新指纹、发布次数替代。只在实验或路线变化时记入主本，不要求每次工具调用写说明。
3. **交付标准 = 下游能开始工作。** 可用交付让 Solver 知道：已确定什么及依据；哪些解释被排除、排除到什么范围；下一项实验是什么、前提是什么；哪些材料可直接使用、哪些仍有缺口。“可能是某种编码”通常不够；“已从源码确认转换关系，提取输入和参数，剩余问题是求逆，相关材料已发布”接近可执行。沿用现有 artifact 通路与工作主本，不另写平行报告；重点是核实下游实际消费。
4. **允许带明确新问题重新调查，不自动续跑。** Recon 交回不是永久禁止再侦察。Solver 发现新的前提缺口时，Coordinator 可在原授权与剩余预算内分派一次明确调查（例如“核实这份源码是否对应当前接口”）。续接须带新证据或具体缺口，不能只写“继续找”；换会话不重置额度（host 已按题累计，§10.3）。这降低 Recon“现在不查完以后就没机会”的压力。

### 11.4 文件落点与边界

- `product/opencode/agents/recon.md`：四种原因取代“高／低价值”句；继续判准；交付标准；第四种对应 closure 拒绝消息。同时删去已过时的“不新增时间／步数限制”表述（host cap 已存在，未配置时为 OFF）。
- `product/skills/recon-investigation/SKILL.md`：“Ask one distinguishing question”补“会改变什么决定”；交回段改为四种原因与下游可开工标准；保留现有反证范围、主本与发布规则。
- `product/opencode/agents/coordinator.md`：有界回合分派改为“本轮要消除的不确定性”并附两类例子；按需再调查规则（带新证据／具体缺口，不写“继续找”）。
- `product/opencode/agents/domain-solver.md`：一句说明如何接收“尚未证明的部分”，以及发现前提缺口时经 Coordinator 请求一次明确调查，而非自行重做 Recon 的全部工作。

红线不变（§5、§10.1）：不新增 schema、字段校验器、语义判卷、调度或续跑机制；不让 Recon 成为 planner；不写题目专属解法。

### 11.5 风险与验收

这些仍是 prose；slice 1（§7）已证明仅靠角色文字可能被忽略。本次两点不同：第四种原因有 host 收束兜底；“消除具体不确定性”写进 Coordinator 派单文字，即 Recon 每轮实际看到的任务本身。验收按 §9 看真实 run 行为：Coordinator 是否按不确定性派单；Recon 交回是否标明原因、交付是否让下游直接开工；继续理由是否出现在主本的实验／路线变化处；是否出现带具体缺口的再调查而非自动续跑。静态文字一致不等于行为通过。
