# Critic 信号离线核对

当前结论以文末“追加复核”为准：早期重复参数计数不能排除其他 Critic 触发条件；七次恢复并非全部无效。下方早期核对保留其证据与局限。

2026-10-25；主会话只读核对，未运行模型／目标，未改产品代码。

## 结果

`inspect.py` 从原始 R 的 progress.jsonl 与 root messages 提取元数据，结果 observations.json。不读取 reasoning 字段内容，不输出 prompt/body/argv。Coordinator 当前文件与 run 固定副本 SHA-256 相同：6f06eaffc605a8e4fc5ed584f606fdd9b713be4518a4c9871a510cb7b2c88060；Critic 同为440ef091d1c2e6c3af7412b32b281637bbec90388fa6a2b593ca1a62b7e52eee。

- Root 调用 progress.read **0 次**，task(recovery-critic) **0 次**，progress.note **1 次**（seq807）。没有证据表明重复摘要被本次Coordinator实际读取。
- 四个后台通知是seq258/647/785/793；各消息存在于root保存记录。因此原始空/短task_result可到达父上下文，不应写为“父完全看不到交接”。但包络不含finish=length、source message ID或完整性结论。
- 在上述四处及seq807之前，按当前 digest 的分组键(tool+argFingerprint)重建计数，均无达到 Coordinator 三次触发阈值的组；digest 本身从 count>=2 开始返回，这不表示其 repeated 列表为空。不能将7次语义不同的task恢复概括为已满足“相同工具参数三次”触发；现有计数也不判断结果是否有新知识。
- publication等为空能证明没有可信产物，不证明7次恢复没有有用text。故连续两次没有artifact并不独立证明语义停滞；本文不据此保证调用Critic必然解决问题。
- `control-service.ts:27`允许Coordinator分派Critic，:531-535返回progressDigest，:608校验Coordinator/Critic权限；产品opencode.json允许相应工具。`progress-ledger.ts:294-326`只在读取时按全audit的tool/fingerprint计算重复、返回recent/latest notes，没有自动推送、每交接完整性统计或episode去重。静态权限和逻辑存在不等于本run调用成功，因本次无调用证据。
- Coordinator第26-27行已列触发条件且“可按需要”读取；Critic不介入不能单独归因于漏写条件或工具故障。本次没有选择A增加重复提示词的证据。

## 建议边界

选择B仅限已证实缺少的交接完整性事实，并入子任务完整性改动：将原始finish与报告为空/未完整/unknown告知父会话。保持Critic/Coordinator语义判断；不另加自动Critic调度器、重复指纹监控、强制每两交接调用或新权限。没有独立充分证据要求本轮修改Critic文案或progress重复规则。对complete产物语义质量、何时Critic有效仍为模型遵循未验证。

## 验证层次与限制

这是保存轨迹+源码/资产hash核对；没有运行Critic原生调用，无需将接口假设误写已验。原始证据位置与hash在observations.json。无新增测试或新判定器；可重跑命令：python3 inspect.py（原始R必须仍存在）。后续若检验行为，另需预算授权，当前不恢复真实调试。

## 追加复核：输出上限、七次恢复与 Critic 可见信息（2026-10-25）

本节修正上文仅凭重复参数阈值收口的判断。只读核对原 run、配置与保存的消息；没有调用模型。可重放元数据投影为 `python3 recheck.py`，输出 [recheck.json](recheck.json)，包含来源 hash。脚本不导出 prompt、正文、reasoning 或凭据；下表的任务目的由人工读取 task 输入核对。字符数为 Unicode code points，不混用产品 JavaScript textChars。

### 上限来源

原 `profile.json` 引用 `config/opencode.volcano-coding.example.json`，其中模型 `limit.output=8000`；该文件当前 bytes 与原 HEAD `cfa950fd` 的版本相同。使用当前 product 配置和该模型配置，按 launcher 合并规则重建（不解析 env 凭据、不启动运行），SHA-256 为 `7077ec3b70ded277f4a9ab8a6298bd33efcdb86bbbb1c19efbf4383a0e5a937a`，精确匹配原 run 的 configSha256。单用历史 HEAD 的 product 配置不匹配，说明不能忽略当时 dirty 输入。

104 次 host 准入上限为 4,451,538–5,000,000，故不能将最后 length 归因总预算耗尽。原消息中 Recon、Domain Solver、Reference 和 Root 的首次／最终空 length 均记录 output=0、reasoning=8000；Strategy 首轮为 71+7929；Reference 补交为 3603+4397。支持配置的单次输出额度被用尽，其中包含报告的 reasoning 计量。原日志没有 max_tokens／maxOutputTokens 请求记录，故只确认配置来源、保存用量及一致性，不声称捕获了原 HTTP 参数或证明 provider 内部策略。既有固定版本接线探针支持 min(model limit, admission)，但不代替原请求证据。

### 每次恢复与父会话可见内容

| 顺序／角色 | 恢复前父侧可核对信息与请求目的 | 原生返回与 child 保存终态 | 判断 |
| --- | --- | --- | --- |
| 1 Recon | 通知正文为空；明确要求补交已有证据，不重做实验 | 8259 字符，最终 stop；同一恢复 user 下另有 length assistant，并发生 workspace 写入及 artifact.publish 拒绝 | 取回报告成功，不能归类纯无效重试；多 assistant 应按既有关联规则 unknown，不选最后一条制造唯一。发布拒绝不能靠同步读取修复 |
| 2 Domain Solver | 通知为空；要求总结已做实验 | 8441 字符，stop；一次 job.read | 有报告恢复，不等于重新解题或无进展 |
| 3 Domain Solver | 已取得上轮报告；要求第二轮有界实验 | 4518 字符，stop；15 次 HTTP 与一次 workspace.read | 新实验，不是空报告重试；结果支持否定先前推论 |
| 4 Strategy | 原通知有 114 字符；父明确指出截断并要求续交、不做实验 | 0 字符，stop，reasoning=2665；无工具调用 | 真正补交失败，而且不是 length；调高上限不能解释或修复这一例 |
| 5 Strategy | 父明确指出前两次为空／截断，要求直接输出结论、不用工具 | 4929 字符，stop；无工具调用 | 后续补交成功；此前“再要求只总结”已在原任务中出现，不能当成全新修复 |
| 6 Reference | 空通知；要求直接给出已有知识，并允许回答无可靠来源 | 6739 字符，但 length；无工具调用 | 有正文但仍不完整，原生 completed 包络没有表达 length；不能记完整交付 |
| 7 Domain Solver | 已有第二轮结果及 Strategy／Reference 返回；要求第三轮只读实验 | 7923 字符，stop；8 次 HTTP，另有本地文件／job 操作 | 新实验，不能仅按恢复次数称无效；随后 Root length 无正文 |

共七次：五次补报告、两次继续实验；补报告中四次有正文，但 Reference 仍 length，Recon 还有多 assistant 归属歧义。正文存在不等于语义正确；没有把每条报告全文认定可信成果。返回保存在父 tool output，恢复 prompt 直接引用空／截断及上轮结论，支持父侧确实获得这些信息。没有原 provider 请求快照，不能证明每条保存消息在每个请求中完整保留或模型理解了它。

### Critic 条件纠正

- 原角色规则列出多个条件：阶段交回、相同参数至少三次且无进展、连续两次交接无新产物、接近上限、错误前提／交接缺口需要换路。“没有三次相同参数”只能排除其中一项。
- 第二次空后台交接后，按“没有新 artifact/package/verification”的字面条件已存在触发依据；但 Recon 已恢复了长报告，因此这并不能证明语义停滞。阶段交回本身也过宽。条件的阶段入口、判断信号和是否必须调用混在一句“只在…才”中。
- Strategy 首次补交仍为空，下一次恢复 prompt 明确识别连续交接失败：父可见失败，不是缺失全部信号。后一次成功不能消除曾有判断机会，也不能证明 Critic 必须优于补交。
- seq807 的 Coordinator progress.note 明确记录 redirect、已否定的路线和环境未知，说明它实际做过路线判断；但此前／全程未分派 Critic。该 note 位于 Strategy 成功补交之后、Reference 补交与第三轮实验之前，不能用后两轮信息解释当时决定。
- 无 Critic 调用意味着不存在“Critic 当时看见了什么／为何拒绝”的证据；这里只能检查 Coordinator 的调用机会。权限存在、已有规则和可见信号均不能替代模型遵循证明，也不能从轨迹推断未调用的内在原因。

### 最小修复范围与代价

保留现有同步来源、事实展示、多通知消费实作范围。另将 Coordinator 的 Critic 条件澄清为：阶段交回是评估时点；依据实际新增信息／证据、持续交接失败或需换路作调用判断；正常文字交接不以 artifact 缺失自动认定停滞。只改既有规则，不加调度器、计数器或自动重试。代价是判断仍依赖模型，不能离线保证遵循。

不新增“恢复必须只总结”的重复提示（原任务已这样要求），不设统一恢复次数上限，不提升同步 artifact 发布权限。配置 8000 的来源已清楚，但合适值及报告质量效果未证：不直接提高到任意值，不假设关闭／调低 reasoning 的接口可用；作为后续有预算的单变量效果验证选择，预期代价为单次成本和时延增长。Root 保留 host 事实兜底，不自动补叫模型。

离线可验证关联、完整性、拒绝边界与配置接线；仅文字规则审查不能证明 Critic 调用或恢复效果。后续模型样本应同时覆盖“无 artifact 但有新信息”“连续补交失败”“已否定路线需换路”，以误触发、漏触发、有效报告及额外消耗评估，不重跑全套多 Agent 流程作为前置。
