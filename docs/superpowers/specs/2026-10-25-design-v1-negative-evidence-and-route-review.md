# design v1 G／H：否定证据与路线复核

**状态（2026-11-10）：搜索取证、事实交接与有界回合交回均已落地；r10 首次出现 Critic `redirect`。模型能否正确取证、判断并换对路线仍未验证。**

本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) G／H 的详细子文件，细节以本文为准。改写前的逐次记录（隔离基线 hash、scripted 链运行细节、命令与失败）见 commit `268813d5` 中的本文及下文链接的 gates 证据。

## 1. 问题：否定结论被摘要一路放大（r3）

r3 中，Solver 的远端搜索失败了，但交接把「全 rootfs 扫描零笔」当作已实测事实，Critic 又把同源摘要当作「8 项独立证据」，Coordinator 最后记为「确认容器内不存在 flag」。

| 环节 | 事实 | 能说明什么 |
| --- | --- | --- |
| 搜索实验 | 远端命令只取 stdout（`os.popen(...).read()`），丢弃 stderr、接 `head`，不保留搜索自身的退出状态 | 空 stdout 分不出未命中、命令报错和没取到结果 |
| 远端实际错误 | server.log 有 `grep: unrecognized option: R` 等报错 | 至少这几次搜索失败；不能推到全部搜索 |
| HTTP 交付 | 对应 GET 返回 200、`bodyTruncated=false` | 只证明 HTTP 响应完整，不证明远端命令成功 |
| 交接与复核 | Coordinator 称「均为工具实测」；Critic 只读进度摘要，未核查原始输出 | 待核对的否定主张被当成事实，并被反复加强 |

**根因是两个信息断点：** 实验没有保留判断搜索有效性所需的事实；交接把待核对的主张写成了已确认事实。原 Skill 已有「错误不等于反证」的规则，再加同义警告或多调 Critic 都补不回丢失的信息。HTTP 工具只能保存 HTTP 层事实，无法找回远端丢弃的 stderr；本地 `job.run` 的退出码也不能代表其内部远端命令的状态。

原始 run 位置与 call 索引见[搜索取证最小证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/search-evidence-minimal-20261025.json)。哪些有效搜索覆盖了哪些范围、模型为何忽略信息缺口，仍不能据这几项记录下结论。

## 2. 搜索结果的有效性

**状态：已落地（Web Session Diagnosis v5，随 `89e47dde` 提交）。**

**目标：** 决定性搜索的结果能区分「执行失败或结果未知」与「在已说明的范围内搜索成功但未命中」，交接结论与之相符。

**决定：** 在方法层修正取证，不改 HTTP 的成功含义。Solver 用目标已有的能力，一并取得搜索自身的退出状态、stderr、有界 stdout 与所查范围，下游命令（如 `head`）的状态分开记录。取不到状态或错误时，标为「这次搜索有效性未知」，修正一次调用或转向另一项有依据的观察，不把空白解释成「没有」。`grep` 无匹配与参数错误按工具本身的语义区分。现行措辞见 `product/skills/web-session-diagnosis/SKILL.md` 中 `Check response continuation and business postconditions` 的第 4 项。

**交接：** 沿用原生 task 结果与产物引用，写明决定性观察的实际执行状态、有限范围、输出完整性、支持的局部结论，并附错误或未知原文的小摘录。不用「全盘扫过」替代事实，也不为每次工具调用强制附表或发布。

**不采用：** BusyBox 兼容层；把 HTTP 200 当远端成功；通用证据评分器或全局否定 gate；调高输出上限；自动重复实验；把正常的 grep 参数错误归为产品工程故障。

**无模型验证（2026-10-25）：** 在断网只读容器中，用同版本 BusyBox 1.31.1 对自造文件复现四种情况，并经未修改的 HTTP 保存与 workspace 读回链交付。证据见[搜索取证最小证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/search-evidence-minimal-20261025.json)。

| 情况 | 结果 | 支持的结论 |
| --- | --- | --- |
| 参数错误，HTTP 200 | 旧方式得 0 bytes stdout；新方式得到报错与搜索状态 2 | 只证明参数错误，不能称未命中 |
| 有效搜索无匹配 | 状态 1，stdout／stderr 均空 | 仅该文件对该模式未命中 |
| 状态与 stderr 取不到 | 读回完整但内容为空 | 有效性未知，不补填状态 |
| 上游失败、`head` 成功 | 搜索状态 2，`head` 状态 0 | 不能以管道最后的状态代替上游状态 |

新方式在错误样例上多出约 1.1 KB 文本，无需新增 host 包装器、schema、角色或输出上限。这只验证了取证与读回可行，不证明 Solver 会照做。

## 3. Critic 独立复核关键前提

**状态：已落地（Coordinator「進度與 Recovery Critic」与 Recovery Critic「交付」两处提示，随 `89e47dde` 提交）；模型判断未验证。**

**目标：** 对影响换路或停止的主张，Critic 检查给定事实是否足以支持结论，指出未核实的前提、范围跳跃和未解决的线索。这里的「独立」是判断独立；Coordinator 转交的摘录不等于 Critic 读过或认证了原始证据。

**现有接口的限制：** Coordinator 与 Recovery Critic 没有普通的 workspace／artifact 读取能力，原生 read 只限 Skill 根，只给路径或 ref 它们无法自行核查。进度帐本记录的工具调用只能证明操作发生过，不能证明搜索有效；模型写入帐本的摘要也不会因此变成 host 认证的事实。

**交接规则：**
1. 来源角色在结果中写明有限范围、实际执行状态、必要的错误或输出小摘录、完整性缺口与来源索引，区分观察与推断；原文没保留就写缺失。
2. Coordinator 转交这些事实及其限制，把待复核的结论作为问题提出，标明摘录来自哪个角色的哪次观察，不把「未知」压成「未命中」，也不预设结论。
3. Critic 分开判断两件事：事实的来源与有效性是否说清楚；即使事实成立，是否足以支持结论。同源摘要被多个角色重复不算多份证据；有限范围的有效搜索不能证明整个环境不存在答案。
4. 资料不足时，Critic 指出一个影响当前决策的具体缺口，由 Coordinator 决定是否在现有权限与预算内补充，补已有记录优先于重做实验。没有授权路径时可以停止，停止原因与环境事实分开记录。

转交可带必要的去敏事实小摘录，仍禁止完整工具 body、候选原文、flag、cookie、控制秘密、完整 prompt、chain-of-thought、job argv。去敏没有程序保证；无法在边界内提供必要事实时写「无法复核」，不能编写替代摘要冒充证据。是否需要受限读取能力未定，只有具体样例证明交接缺少不可替代的信息时才讨论。

| 验证 | 结果 | 能说明什么 |
| --- | --- | --- |
| scripted 原生链 domain-solver → Coordinator → recovery-critic（2026-10-25，[证据](../../gates/g-solver-verification-20261023/run-completeness-20261025/critic-factual-handoff-minimal-20261025.json)） | 状态、小摘录、来源与限制逐字符到达 Critic | 文本传递可行；不证明真实 Coordinator 会忠实选材，也不证明 Critic 判断正确 |
| r4 真实 run（2026-10-26，`89e47dde` 加未提交修改） | Domain Solver 与 Critic 都成功载入 Skill；Critic 读完进度后以 finish=length、零正文结束 | 读取入口可达；空正文问题转[空正文恢复](2026-10-26-design-v1-c-empty-result-recovery.md) |

**待验证：** 用不含原题答案的局部案例，检查模型能否处理以下四种情况：有明确报错却声称未命中；只有摘要、没有执行状态；有效的有限搜索却声称全环境不存在；预算已尽时合理停止。需要真实模型时另行授权模型、批次与预算。如果模型拿到完整事实仍判断错，问题在判断，不据此扩权。

## 4. 长执行内部的停滞

**状态：候选 D（有界回合交回）已落地（merge `3ad11f48`，含 `6e282fd5`）；Critic `redirect` 在 r10 首次触发，能否救回解题未证实。**

**问题（r7）：** Domain Solver 末段约 20 分钟反复搜索 flag 档名、env 与 DB，却没测 Recon 已给出的 `/admin/chal/delete`；Recovery Critic 准入 0 次。Coordinator 已有停滞规则，Critic 也有 `continue/redirect/stop_and_report` 输出，缺的是触发时机：停滞规则只在任务交回时评估，而停滞发生在长执行内部，Coordinator 在这段时间里没有机会套用规则。

| 候选 | 判定 | 原因 |
| --- | --- | --- |
| A. Coordinator 背景分派并周期评估 | 不可行 | 子执行进行中没有机制唤醒父会话，周期评估等于忙轮询，`coordinator.md` 已禁止 |
| B. host 停滞信号前移 | 暂不做 | 现有重复检测按 `tool` 加精确参数指纹分组，换着参数搜索不触发；要更粗的「无新进展」信号和执行中通知路径，属接口改动 |
| C. Solver 自判交回 | 只作辅助 | 自判不可靠，作为 D 的使能写进角色提示 |
| D. 有界回合交回 | 已选并实现 | 让既有的交回边界停滞规则自然触发，无需新唤醒路径或 host 机制 |

**实现：** `coordinator.md` 的「有界回合分派」要求分派 recon／domain-solver 时写明本轮问题与停止条件，每次回合交回都套用停滞规则决定继续、换路或派 Critic，不忙轮询，不新增唤醒、monitor 或 scheduler。`domain-solver.md` 的「有界回合與交回」要求无进展或有未测线索却要转向时交回，不拖到 deadline。Recovery Critic 职责未改：只建议，Coordinator 决定。

**常驻决策骨架：** 按需载入的 Skill 调用不可靠（r7 全 run 0 次），所以「固定思路」放进常驻的角色提示，不做成要模型自己载入的 Skill。骨架要薄：观察 → 有具体线索先低成本直测 → 有界探索 → 停滞就交回 → 由 Critic 判断是否换路，并点名何时该载入哪个 Skill／Reference。不扩成分类 playbook 或漏洞百科，也不强制每题载入 Skill。

| run | 结果 | 能说明什么 |
| --- | --- | --- |
| r8-2（2026-10-29，throwback） | 解出；Critic 准入 0 | 解题来自直接测对路线（线索帐本的作用），D 的停滞路径没被用到 |
| r10（2026-10-29，seizurecipher，`cddcbb25`） | 约第 13 分钟 Critic 给出 `redirect`，Coordinator 接受；仍未解出，卡在看图能力 | D 的触发与消费路径首次在真实 run 运作；不证明能救回解题 |
| a3／a4（2026-11-06，只读结构化字段） | Solver 几乎每次参数都不同，精确指纹重复不触发；a3 C1 首个 Solver 回合 11.5 分钟才交回；a4 回合很短，但 Coordinator 每次都续派 Solver | 停滞检测仍取决于回合长短；交回边界的派单路径能走到，是否换对路未判断 |

**去向：** 本文不再新增 host 停滞信号。触发条件改由 [Recon 重设计](2026-10-29-design-v1-recon-redesign.md) §5 评估；交回时 Coordinator 能看到什么，见[结果完整性](2026-10-25-design-v1-run-readiness-and-result-completeness.md) §5.2。

## 5. 边界与未证明的事项

- 修正点只在两处：实验取结果时保留信息，交接时分开主张与事实。只加提醒、错误字符串 gate 或额外的 Critic 调用都只是兜底，不能替代它们。
- 不新增 judge 权；不忙轮询；不建 monitor、scheduler、readiness 或框架；不改候选验证标准，也不改身份、scope、预算与停止校验。
- 不保证模型不再误判。只有原样例的输入输出链与另行授权的行为验证都支持，才能说问题已改善；要证明通用效果，需要未泄露解法的独立题目。
