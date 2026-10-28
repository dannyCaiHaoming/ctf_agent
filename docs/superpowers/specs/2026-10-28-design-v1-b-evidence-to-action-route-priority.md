# design v1 B：证据到行动的路线优先级与收敛（web／CTFd 方法论增量）

日期：2026-10-28（Asia/Tokyo）。状态：**聚焦 design，待计划与验证；尚未改产品、未运行模型。** 本文是 [B 通用解题方法与耗时优化](2026-10-26-design-v1-b-method-generalization-and-efficiency.md) 的子片，由 r7 实测缺口驱动；沿用 [A／B 资产设计](2026-10-22-design-v1-ab-product-assets.md) 的原生 Skill、固定副本与受控 Reference 和 [Skill 发现与使用](2026-10-24-design-v1-skill-discovery-and-use.md) 的按需载入，不另建知识平台、不铺 web／pwn／crypto 三类模板或 wordlist。

## 1. 唯一目标与原始问题

**目标：** 让已掌握的 challenge-specific 路线／动作被**优先、低成本地直接测试**，并在无结果的通用枚举上收敛，而不是靠堆提示或强制载入。只针对 r7 实测的 web／CTFd 缺口，不推广成通用漏洞百科。

**原始问题（r7 `throwback-debug-20261028-r7-1`，已从证据核实）：**
- Domain Solver 已取得 admin（空帐密 `POST /login`）、确认 Jinja SSTI（`{{7*7}}`→49）、取得 RCE（`lipsum.__globals__["os"].popen`）。
- Recon 发布的 baseline 与已读的 `CTFd/templates/admin/chals.html` **已含** `POST /admin/chal/delete`（recon 证据出现 5 次）。
- Domain Solver 的 **78 次 http 工具调用中 0 次打 `/admin/chal/delete`**（仅 2 次碰任何 `/admin/chal*`），末段约 20 分钟持续搜 flag 档名／env／静态目录／SQLite。
- 该题 flag 由**动作产生**：r6 已证「登录→建 challenge→删 challenge，回应 26 bytes 即 flag」，不是磁盘上的静态档案。
- Domain Solver 109 次准入（本 run 最大段），run 30 分 `deadline_exceeded`，无 Engineer／Verifier／判官。

即：线索与能力都在手，却没对 specific 路线执行，并错误假设 flag 是档案。这不是靶场缺 flag，也不是 recon 完全没给线索。

## 2. 分层缺口与一个硬张力（关键未知，先判层再修）

r7 失败至少有两层，**必须先判是哪一层，不能默认是内容缺口**：

- **L1 发现／调用（2026-10-28 已从 r7 逐消息 tool parts 核实，不读 reasoning）：** r7 **全 run 0 次** `skill` 工具调用——不仅 Domain Solver，Recon 等所有角色都没载入。该 skill 已在 `inventory.json` 列出、对各角色可用，故**不是访问问题，也不是 DS 专有**；是一个**跨角色的识别／调用缺口**。对照 [B 方法论](2026-10-26-design-v1-b-method-generalization-and-efficiency.md) §1.1：r4 时 Solver 与 Critic **曾**成功调用过同一 skill。因此调用是**时有时无、不可靠**，而非从不发生；`domain-solver.md` 第 12 行的「需要时按需载入」在 r7 没被任一角色触发。
- **L2 内容／收敛（待确认，且被 L1 门控）：** 现有 `web-session-diagnosis` SKILL v6 已含「把 frontend action 追到 request method/target/handler」「不要无新证据反复猜路线」，但**没有**明写「掌握 specific 路线／动作时应优先于通用枚举或 RCE 翻档」「flag 可能由动作产生而非档案」这类收敛与优先级指令。但 r4 证据显示：**即使载入了 skill 也没带来解题**（b-method「加载过不等于正确使用」），故 L2 内容的收益本身未经证实。

**硬张力（本片核心难点）：** [Skill 发现与使用 §1](2026-10-24-design-v1-skill-discovery-and-use.md) 明确边界「不是增加 Skill 载入率、强制每题调用 Skill」。而 r7 恰恰是**无人调用**——若用「强制载入／提高载入率」去修就直接违反既定设计。两者张力意味着：**不能靠强制调用，也不能假设加内容就有用**。

**由此得出的判层结论：** L1 不是 DS 专有或访问问题，而是跨角色、时有时无的识别／调用；L2 的内容收益在「载入后是否真的改变行为」未验证前无法独立成立。**两层都指向同一个前置问题：一份可发现、相关的方法，为何有时被载入（r4）、有时无人载入（r7），且载入后未见行为改变？** 这是下一步要先回答的，而不是先堆内容。

## 3. 要回答的问题（按顺序，先 L1 后 L2）

1. **L1-识别：** 只看 `web-session-diagnosis` 的 name／description，一个已取得 admin／RCE、手握 admin 路线线索的 Domain Solver 会不会判定它相关？若不会，是 description 的触发面不覆盖「利用阶段的路线选择」，还是角色根本未进入「找方法」的自判？
2. **L1-证据：** r7 Domain Solver 的 0 次调用，是「看到但判定不需要」还是「其工具可见描述里方法不显眼」？需从 r7 逐消息 tool parts（工具名／状态）核对，不读 reasoning。
3. **L2-内容：** 若在 r7 情形下载入了 v6，现有正文是否足以把行为导向「先测 `/admin/chal/delete` 等 specific 动作、并识别 flag 可能由动作产生」？还是确实缺一段收敛／优先级指令？
4. **收益归因：** 任何增量如何证明它**改变了路线选择**，而不是只多了没人读、读了也不照做的文字？（见 §5 验证）

## 4. 候选做法与结果去向（不预先定案）

针对 L1（二选一或组合，取其一最小）：
- **A. 调 description 触发面**：把「利用阶段：掌握 specific 路线／admin 动作时的直接验证与优先级」纳入 `web-session-diagnosis` 的 description，使利用角色更可能自判相关。**不**改成「每题必载」。
- **B. 角色侧一句自判提示**：在 `domain-solver.md` 的「按需载入」处补一句：掌握 admin／源码路线线索、或准备深入通用枚举／RCE 翻档前，先判断是否有对应方法可用。仍是自判、非强制。
- 结果去向：若 r7 证据表明 L1 是 description 覆盖问题→走 A；若是角色自判时机问题→走 B；两者都不充分→记录为发现层仍未解，不强行塞强制载入。

针对 L2（仅在确认内容缺口时）：
- **C. 给 SKILL 增一节「证据到行动的收敛」**，最小条目（方法论，非 wordlist、非题解）：
  1. 掌握 challenge-specific 路线或 admin 动作（create／delete／update 等）时，**先低成本直接测试该动作**，再做通用枚举或 RCE 翻档；
  2. flag 可能由**动作的响应／副作用**产生，不一定是磁盘档案；在假设「flag=档案」前先排除动作产生；
  3. 对同一类无结果搜索（档名／env／DB）设**停止条件**：手上有未测的具体线索时，停止扩大通用搜索、转测该线索。
- 结果去向：条目进 `product/skills/web-session-diagnosis/SKILL.md`（或其 Reference）；明确**不**列具体路径字典、字段名、题解或 payload，保持方法论层级。

候选 B（DS 专有自判提示）经 §2 L1 判定**已不充分**：r7 是跨角色无人调用，不是 DS 一个角色的时机问题。

**与产品侧收敛的分界（经 L1 判定后，其权重上升）：** Recovery Critic 在「重复搜索＋具体线索未测」时的停滞→换路决策，以及 Coordinator 在 Recon 已出 specific 路线时要求先做低成本验证，属**角色协作**缺口（r7 报告「下一步」1–2 项）。它们由宿主编排层控制，**不依赖模型自己选择载入并遵循 Skill**；鉴于 L1 显示调用不可靠、L2 收益未证，这条路线对 r7 这类「线索在手却未测」很可能比 Skill 内容增量更高杠杆。本片不实现它，但记为并列候选方向供选型。

**L1 判定后的下一步（先回答、再决定要不要做 C）：** 需要一个受控真实 run 探针（r8，另行授权 model／provider／批次／token）来区分「description／触发面不够」与「模型在active 工作中本就少调用方法」：在同题上观察 (i) 调整 description 触发面后调用率是否变化、(ii) 载入后是否真的在深入通用枚举前先测 specific 路线。无模型无法回答这两点。若探针显示即使载入也不改变行为，则重心转向上面的产品侧收敛，而非继续堆 Skill 内容。

## 5. 最小验证与边界（诚实标注能证到哪层）

- **无模型只能验到「装配＋可发现」：** 固定副本 SHA 一致、frontmatter 名称／description 合法、新增 description 面能被角色工具可见、Reference 路径可读。**无模型无法证明模型会照做**——路线选择是模型行为。
- **路线选择只能由真实 run 验证（r8，需另行授权 model／provider／批次／token）：** 判据是行为性的——在同一 throwback（或等价 web 题）上，掌握 specific 路线后**在深入通用枚举前**实际发出该路线请求；而不是只看 Skill 是否被载入或文字是否新增。不能用「载入率上升」或「文字已加」冒充收益。
- 一道 web 题的证据**不足以**推广；本片结论只约束 web／CTFd 的这一类缺口。多类证据出现前，不扩成 pwn／crypto 模板或 wordlist。

## 6. 禁做清单

- 不新建知识平台／检索服务／漏洞百科／通用框架；不铺 web／pwn／crypto 三类策略模板或 wordlist（本片证据不支持）。
- 不强制每题载入 Skill、不以提高载入率为目标（违反 skill-discovery §1 边界）。
- 不在 Skill／Reference 写入具体路径字典、字段名、payload、题解或从成功题反向制作专属触发词。
- 不改模型、工具权限、公共搜索／依赖安装限制、候选验证标准；不新增角色、Schema、Hook、fixture、gate。
- 不在本片顺带做 Coordinator／Recovery Critic 协作改造（另立）；不混为一批效果证据。
- 未经明确授权不运行真实模型、不 commit／push。

## 7. 完成含义

本片完成仅指：**判明 r7 缺口在 L1／L2 哪一层并据此做最小增量，且已明确该增量的行为验证只能由真实 run 认账。** 不证明 throwback 可解、不证明泛化或提速，不记 solved。结论定稿后转入 [B 方法论](2026-10-26-design-v1-b-method-generalization-and-efficiency.md) 并删除据此生成的一次性 plan。
