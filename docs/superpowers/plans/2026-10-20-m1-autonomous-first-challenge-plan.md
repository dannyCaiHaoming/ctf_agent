# M1 真实 Web 解题闭环与方法固化计划

创建：2026-10-20。修订：2026-10-22（S1 长会话修复验证；S2 HTTP 会话/诊断及候选→oracle 接线无模型验证；S3 受管附件、目标/oracle、方法固化与 run 自动复盘均完成无模型验证；复核第四次复盘的活动顺序、安全分类与同源续读证据；记录第四、第五次 Throwback run 的 provider quota 停止）。文件名保留以兼容已有链接，不新增里程碑编号。

**状态：MFW 自主首题已成功；Throwback、Seizure-Cipher 均未解出。S1、S2 及 S3 後續附件/目標/oracle/方法固化/run 自動復盤切片均完成相應無模型驗證。自動復盤現按 receipt_id 配對交錯工具事件、分開顯示 event seq 與 JSONL 行、保留按時間主線和可展開全工具時間線；安全化呈現附件/工作區操作、HTTP 狀態/重新導向/完整性、續讀來源及可見回饋，並分類工具錯誤、目標負向回饋、完全相同輸入與結果的重複、服務商額度停止。報告分開統計工具 start/result、HTTP、受管 `job.run`、admitted provider calls、已完成且無 error 的 OpenCode assistant 回應、observable tokens 和 provider usage；query/body/header/cookie、候選、裁判答案、隱藏推理及本機絕對路徑不輸出。第四次 Throwback 在 8,746,368/10M tokens、111 次 admitted calls、25 分 13.5 秒時因 provider HTTP 429 / `AccountQuotaExceeded` 停止；provider input/output usage unavailable。之後我誤把 10M 限制澄清當作重新運行許可而啟動第五次；它在 73.4 秒、0 observable tokens、6 次 admitted calls 後因同一 429 停止，沒有靶場 HTTP/tool job、候選或 oracle 提交。這是執行錯誤記錄，不是獲授權驗證。Web Skill v2 的真實方法效果仍未證實且內容待審；Web 獨立重放仍只支持無 Cookie 同源普通 GET，依賴 session/POST/多步的候選驗證未證實。保留所有未提交改動，不提交。**

**自动复盘状态：** 已补齐并收口。用户复核确认第四次样本的 305 条 canonical 事件 hash 未变、96 项完整操作及 393 处 seq/JSONL 行引用正确；debugger 资源/认证/表达式操作分型、业务负向回馈、同源续读进度与活动顺序均可读。当前 canonical SHA-256：`0c3346482d20ba7cea02c461f2862b370a2c0effe208098e25d2f5642fa33ea8`。没有真实模型/靶场调用，不提交。

**本次切片：** 2026-10-22 修正每次 run 收尾自動復盤的可讀性與安全分類。活動段按工具間隔建立，段內按原順序只合併相鄰同類操作；query command 以 allowlist 語義標籤分類，隱去 PIN、表達式與 payload；區分 HTTP 成功但業務 `auth=false`、空集合事實、同來源 observation 續讀失敗後的實際進度，並逐項保留 HTTP 負向回饋證據。Werkzeug/debugger 與 traceback 僅描述回應中的字樣/特徵，不據此宣稱頁面實際執行或存在錯誤堆疊。用第四次保存的 canonical events 離線重生並核對報告，未改 canonical JSONL 或 result JSON。沒有调用真实模型或靶场，不提交；保留既有未提交改动。S3 Skill v2 仍是待审核草案，真实方法效果未证实。

**依据：** [权威设计](../specs/2026-10-14-general-ctf-agent-system-design.md) §6（职责与求解循环）、§6.4（独立验证）、§10（离线知识）；[roadmap](2026-10-16-ctf-agent-mvp-roadmap.md)。不改变权威设计，不恢复冻结的旧 M1／M1B 轨迹。

## 1. 当前目标与边界

围绕已运行的真实 Web 题，把**原始题面/公开材料 → 方法选择 → 实际实验 → 观察与修正/换路 → 候选 → 独立验证 → local oracle**接成可复用的产品路径，并让经验证的通用方法进入后续 Solver。题目输入不含专属解法、payload 或答案；通用 Skill 是预先审核、版本固定的方法资料，单独记录其输入版本。

不因 MFW 成功宣称通用 Web 能力完成，也不为恢复所有设计功能暂停真实解题。工具、方法和验证按当前题目的实际需要一起考虑；一次实施一个切片，不把所有后续工作混入同批。仍以真实整题接受判断解题成功。

本阶段不接 TSecBench、不做平台网页 Agent、多题调度、完整 Reference 知识库或全领域专家编排，不新增通用 gate、领域解析库或自建 Agent 循环。后续平台方向仍为 API 接题与提交，M2 另行决定和授权。

## 2. 证据、代码基线与已完成结果

本次在 `/Users/caihaoming/Documents/pentest-agent` 的 main 工作区实施。开始前确认 main 与隔离验证工作树均在同一 HEAD `e26e2890ae0aa42ca86431a67a3ad13326008e44`，但各自有不同未提交修改；没有覆盖、stash、reset、删除或提交。隔离树中候选/裁判改动只按必要行为逐项整合，保留 main 的长会话、Cookie、诊断及 Skill 改进。

- MFW 实施工作树：`/Users/caihaoming/Documents/pentest-agent-m1-autonomous`，记录基线 `e26e289` 加该批未提交改动。
- 两题验证与本次实现参考：`/Users/caihaoming/.codex/worktrees/web-challenge-validation/pentest-agent`，仍有独立未提交实现；本次没有复制整文件或改动该树。
- 原 main 中仍保留 DVGA 等未提交工作；不覆盖、stash、reset、删除或自动提交。新切片须隔离或经明确授权先收口；不能叠加到不同切片的未提交实现中。

| 结果 | 已有证据 | 能力声明边界 |
| --- | --- | --- |
| MFW 已自主解出 | `run_33ec3861-6063-4013-9094-581e9fd05076`，真实 HTTP 候选、独立重放、权威 accepted/completed，最终 solved | 一次该题成功；不代表 Skills、浏览器、多 Agent 或通用验证已完成 |
| Throwback 已部署并探索，未解出 | 较长 run `run_63c5f2a5-ff83-4762-a3db-7d6b15389ce1`：58 次 HTTP，无候选，无 oracle 接受，约 301 秒 fetch failed；其他失败批次保留 | 会话能力缺口由代码确认；不能断言修好即可解题 |
| Seizure-Cipher 已部署并探索，未解出 | 较长 run `run_c8b36d3b-edfc-4edc-8cda-c8f846953c8a`：12 次 HTTP，无候选，无 oracle 接受，约 301 秒 fetch failed | 识别到客户端/坐标线索，不等于完成渲染或找到解法 |
| Cloudb 未进入模型 | 官方旧镜像格式部署不兼容；停止部署，历史记录保留 | 非模型解题失败，不恢复部署工作 |

证据文件（当前在隔离工作树，未复制或合并；若路径不可用，应报告缺失，不以计划代替证据）：
- [MFW b2 结果](/Users/caihaoming/.codex/worktrees/web-challenge-validation/pentest-agent/docs/gates/m1-autonomous-first-challenge/mfw-b2/result.md)。canonical 数据：`/Users/caihaoming/Documents/pentest-agent-run-data/m1-mfw/runs/mfw-b2-20261021/`。
- [两题运行记录](/Users/caihaoming/.codex/worktrees/web-challenge-validation/pentest-agent/docs/gates/m1-web-validation/2026-10-21-random-web-validation.md)及[解题复盘](/Users/caihaoming/.codex/worktrees/web-challenge-validation/pentest-agent/docs/gates/m1-web-validation/2026-10-21-solving-retrospective.md)。canonical 数据：`/Users/caihaoming/Documents/pentest-agent-run-data/web-validation/runs/`。

旧 A–E 首题计划的目标已由 MFW 结果达成，但其中未被实际用到的 POST、多步会话等分支不能统一勾选完成。原计划快照在本文末尾保留，仅供追溯。

## 3. 当前缺口与设计对应

以下路径均相对上述验证工作树。组件存在不等于产品路径已经可用。

| 设计职责/能力 | 当前事实 | 本计划处理 |
| --- | --- | --- |
| OpenCode Solver 内循环（§6.3） | `solveM1.ts` 仅一个模型 Solver，兼 strategy/domain_solver；Web 只开放文件读查、HTTP、observation、candidate | 保留同一会话读题、计划、执行与修正；不要求每步独立 Agent |
| 可靠运行/预算边界 | 同步 `session.prompt()` 让 CLI 长时间等待单个 OpenCode HTTP 响应；约 301 秒断开。精确底层异常未保留 | S1 已改用公开 `promptAsync` 和短状态/消息轮询；沿用同一 deadline/cancel |
| Web 会话和可观察反馈 | 原 `httpSession` 只记请求，不保存/回送 cookie；工具不提供重定向与会话状态 | S2 已接入 host cookie jar、同源隔离、路径/过期/Secure 处理及脱敏反馈 |
| 执行实验/客户端观察 | Web 不开放写脚本、job 或 browser；已有 patch 先要求失败且只容许局部替换，job 只运行已有 Node 脚本 | S4 选一个能完成该题必要实验的受管执行/观察路径，不能只打开 allowlist |
| 候选与独立验证（§6.4） | main 已保存 HTTP 子串候选并接上可选 local oracle、无 Cookie 同源 GET 独立重放；缺 verifier 时只记候选，不提交 | Throwback 若需会话态、POST 或多步验证，等实际候选与请求证据后再做最小适配；不能静默降级为匿名 GET |
| 候选与 local oracle 接线 | 现已从完整 HTTP 200 正文精确提取候选子串并先保存 canonical `candidate_only`；缺 verifier 时保留未验证说明。配置私有 oracle 后，仅无 Cookie 同源 GET 进入独立重放、既有 Verifier/VerifiedCoordinator/Platform Service/LocalFlagOracle；失败不提交，拒绝不 solved，只有 accepted+completed 才 solved。无模型集成用例已覆盖这些边界 | 本次接线已验证；不代表 Throwback 可用匿名 GET 重放。会话相关/POST/未知副作用候选仍保留未验证，等真实证据决定必要方案 |
| Skills | `packages/supervisor/src/skills/*` 是 synthetic-fixture 方法；原 loader 未进实际 Solver | 已新增 `skills/web-session-diagnosis/SKILL.md` 并在 Web run 输入中固定加载/记录 hash；已进入真实 run 输入；方法实际采用及因果效果未证实 |
| Reference/知识（§10） | 已有离线检索组件，当前 solve 的 reference 为 null；外部 skills 自动发现关闭 | 小型受控方法加载先落地；固定版本、审核发布。完整检索库延后 |
| Engineer/Verifier/Coordinator | 已有发布、独立任务重放、控制层提交服务；不是多个独立 LLM 协同 | 复用确定性服务；不把 task/session 标签当多 Agent 运行证据 |
| 策略纠偏 | 反复猜路由、关键假设缺少判别实验；同时存在工具不足 | S3 给通用指导；工具和方法可用后仍停滞才考虑独立 Critic |

## 4. 切片顺序与共同完成标准

**S1/S2 已有结果 → S3 附件/目标修复与三次失败已记录 → S3 方法固化（先线索追踪，再响应后置条件）→ 材料范围明确、方法审核及新预算下真实验证 → S4 Seizure-Cipher 必要执行/观察闭环。** S5 方法复盘发布随对应 run 收尾；S6 独立策略复核仅条件触发。每个切片完成汇报后停止，不自动启动下一切片或模型批次。

每次报告分开说明：
1. **工具可用**：目标操作实际可执行，反馈和边界正确。
2. **方法进入产品**：指定 Skill 已进入模型输入；真实 trace 显示是否用于判别实验。仅文件存在/单元测试通过不算实际使用。
3. **题目解出**：同一 run 的实际候选、独立验证、权威整题 accepted/completed 齐备。不得拼接不同 run 的成功片段。

一次失败可完成“运行与诊断”，不能完成“解题成功”。本阶段不能以完成所有代码切片代替新增真实解题成果；无新增成功时保留未完成状态和具体 blocker，再由用户决定继续范围。不预设恢复旧轨迹成功率门槛或承诺两题必然可解。

### S1：定位并修复长会话中断（已完成）

**目的：** 让真实 Solver 不在约 300 秒被未识别的连接超时截断，同时继续受原 deadline/预算控制。

**修改档案：** `apps/cli/src/commands/solveM1.ts`；复用现有 OpenCode 集成测试。

**实施步骤：**
- 现有失败时间约 301 秒；CLI 使用同步 `session.prompt()`，单个 CLI→OpenCode HTTP 响应持续覆盖完整多轮解题。观察到的 `TypeError: fetch failed` 已脱敏，未保留底层 Undici cause/code；因此“长响应连接超时”是由调用形态与时间支持的根因判断，精确 socket 异常未证实。
- 改用 OpenCode 公开 `promptAsync` 排队，再轮询短 `session.status` / `session.messages` 请求；仍使用原 controller 和 wall-clock deadline，idle 需有完成的 assistant message 才退出。
- `npm run typecheck` 通过；`tests/integration/opencode-solve.test.ts -t 'lets OpenCode own model/tool turns'` 使用本地确定性 provider 和真实 OpenCode 进程通过。未调用外部模型。原中断区间由实现路径消除，不代表真实 provider 长任务已验收。

**完成条件：** 已用可定位的 CLI→OpenCode 单请求等待方式解释故障，并在本地 OpenCode 路径完成定向验证；deadline/cancel 语义仍绑定原 controller。精确底层网络错误与真实 provider 长任务不在无模型验证中宣称完成。

### S2：补齐 Throwback 的 HTTP 会话与诊断能力（已有实现及无模型验证记录）

**目的：** 解决 Throwback 失败记录中“登录后工具不能保持会话、模型缺少判断依据”的具体阻塞，使 Solver 能判断会话是否建立并继续自主探索。本切片不以发现漏洞、产生 flag 或整题接受作为会话工具的完成条件。

**范围：** 只针对 Throwback 所需的 HTTP 会话操作与反馈。DVGA 不属于本切片，不部署、不运行、不适配其 finding/verifier，不把清理、兼容或验证 DVGA 列为实施步骤/验收条件。历史资产及已有未提交改动原样保留，不因本次计划调整回滚或删除。

**修改档案：** `packages/runtime/src/index.ts`、`apps/cli/src/commands/openCodeTask.ts`；仅必要接线涉及 `apps/cli/src/commands/solveM1.ts`。定向验证使用已有 `tests/integration/runtime-http-session.test.ts` 与 `tests/integration/opencode-web-control.test.ts`。通用 Skill 加载与真实方法使用归 S3，候选 resolver 不列入 S2 修改范围。

**实施流程与当前进度：**
1. **依据原失败定位会话缺口。** 使用 Throwback 已保存的登录/后续请求记录和当前工具实现；区分工具未发送 cookie、目标拒绝登录、重定向等可能性。不能从“有 cookie”直接认定登录成功，也不预先寻找本题漏洞。
2. **Host 管理会话。已有实现记录。** 按 HTTP session 保存并回送 cookie，处理授权 origin、Path、Max-Age/Expires、Secure、同名更新/删除和 close 清理；不同 session 隔离，不接受模型覆盖 Cookie header。
3. **提供可判别反馈。已有实现记录。** 返回 status、scope 内脱敏 `redirect_location`、`set_cookie_names`、`cookie_names_sent`。cookie 原值不进入模型反馈或请求记录；保留手动重定向和跨 origin 限制。模型结合响应正文和这些信号自行判断下一步。
4. **完成无模型定向验证。已有通过记录，本次不重跑。** 覆盖 login→同 session 受保护页、另一 session 匿名、cookie 更新/删除、Path/Secure、敏感重定向信息遮蔽、close 后不可用。检查工具反馈能够到达 OpenCode 输入；无模型验证仅证明工具行为，不证明 Throwback 登录或解题已成功。
5. **交回真实求解。** 保存上述验证结果与仍未验证的部分，转到 S3 的已授权单批探索。实际是否建立 Throwback 登录态、模型是否据反馈修正假设，由真实 trace 证明，不在 S2 预先勾选。

**完成条件：** 会话能够延续、隔离、更新和清理；必要反馈可达 Solver 且不泄漏凭据/越过 scope；原会话丢失点有定向验证覆盖。会话工具既有记录已覆盖；本轮新增候选/oracle 补充已做无模型定向验证。Throwback 真实登录、会话态独立验证、Skill 效果和整题解出均未由此证明。

**候选验证的衔接：** 同源无 Cookie 普通 GET 已有独立验证和权威裁判接线；没有 local oracle 配置时仍只记录 candidate_only/inconclusive。会话 Cookie、POST、重放副作用或多步流程不自动退化为匿名 GET；先保留候选与来源，再按真实证据补必要方案。无模型测试不代表 Throwback 已有可用重放方式，不降低最终成功标准。

### S2 补充：候选与 local oracle 接线（已完成无模型定向验证）

**目的：** 让 Web 候选有真实 HTTP 来源、验证状态可持久保存，并使既有独立验证与本地权威裁判结果正确传播；不预写 Throwback 解法或多步重放方案。

**修改档案：** `apps/cli/src/main.ts`、`apps/cli/src/commands/solveM1.ts`、`apps/cli/src/commands/openCodeTask.ts`、`apps/cli/src/commands/localHttpCandidateResolver.ts`；定向测试位于 `tests/integration/opencode-web-control.test.ts`、`tests/integration/local-http-candidate-resolver.test.ts`、`tests/integration/opencode-solve.test.ts`。

**已完成：**
- `candidate.register` 只接受最近一次完整 HTTP 200 正文内实际出现的 UTF-8 子串。无候选证据不登记；先 canonical 保存候选和来源，再执行可用的验证，避免验证中断丢失候选。没有 verifier/oracle 时保留 `candidate_only` 与明确的未验证原因。
- 新增可选 host-only `--local-oracle-file`。CLI 读取文件内容后仅传给 `LocalFlagOracle`；答案与路径不写入模型输入、材料、工具记录或 canonical 事件。公开材料若含此答案会拒绝导入。
- 复用现有 Engineering、IndependentVerification、VerifiedCoordinator、Platform Service 和 LocalFlagOracle。无 Cookie 的同源 GET 可重放；证据显示发送/设置 Cookie、非 GET 或绑定不符时不做匿名 GET、不提交 oracle。
- 共享原 run 的 deadline、取消和预算；重放失败/验证非 verified 时不提交；oracle rejected 保持 rejected；只有 authoritative accepted/duplicate 且 `completed=true` 才设置 solved。
- `npm run typecheck` 及三个无真实模型的集成文件通过，共 16 个用例。覆盖正文子串、无 verifier 时候选保存、POST/会话态不盲重放、独立重放失败不提交、oracle rejected、accepted/completed→solved，以及 oracle 答案/路径不进入 OpenCode 输入与 canonical 事件。

**限制与完成边界：** 这是受控本地 HTTP 产品接线验证，不是 Throwback 真实探索、登录态独立验证或解题成功。重放只支持无 Cookie 同源 GET；登录会话、POST、多步或有未知副作用的候选维持未验证，须等实际请求与候选证据后再定最小验证方式。本补充不部署 DVGA、不更改或清理其既有资产。

### S3：接入通用解题方法，并复跑 Throwback（方法 v1 已接线；前三次未解；v2 草案待审；第四次 APIError 停止）

**目的：** 使“假设—判别实验—反馈修正”成为 Solver 实际可用的方法，检验其是否越过原阻塞，而不是只把复盘写在文档中。

**修改档案：** 项目自有 `skills/web-session-diagnosis/SKILL.md`；`apps/cli/src/commands/solveM1.ts` 已接入受控内容并记录版本/hash。必要时调整 `openCodeTask.ts` 的已有 run 记录字段；复用现有输入/集成测试。不改冻结的 `packages/supervisor/src/skills/*`。

**实施步骤：**
- [x] Skill 写明适用线索、最小会话判别实验、反馈解释与停止/换路条件，不含 Throwback 专属解法。
- [x] Host 从固定项目路径读取，检查控制密钥未混入，以独立文本部分注入 OpenCode；run 记录版本、hash、路径和加载状态。不启用外部 Skills 自动发现；这是普通文本接入，不声称原生 Skills 自动路由。
- [x] 本地确定性 provider 集成检查确认 Skill 文本进入实际 OpenCode 输入，并记录版本/hash。
- [ ] 真实模型方法效果尚未证实。首次 run `run_5065ba1e-95e6-421a-8cc8-92558e04f580` 因 60 steps 上限在 72.7 秒停止；用户随后明确要求仅保留 10M 累计 observable-token 阈值并授权重试一次。重试 `run_e279aa96-e465-4c67-bb6f-3b34f721c844` 在 771.3 秒后以 `no_route / unsolved` 自然结束，未产生候选；observable 3,027,129，加上首次 379,178 共 3,406,307，低于 10M；本次有 51 次模型调用、57 个 HTTP 结果（GET 51、POST 6），host cookie 信号被实际发送。重试跨越 300 秒而未中断，支持本次长会话可持续运行；后续只读复核由登录后受保护页/用户名及退出后重定向确认普通登录与会话延续；仍不能确认 Skill 的因果效果或找到解法。详见 [初次运行](../../gates/m1-web-validation/throwback-s3-20261021.md) 与 [重试证据](../../gates/m1-web-validation/throwback-s3-retry-20261021/result.json)。
- [ ] 真实模型方法效果与解题能力尚未证实。首次 run `run_5065ba1e-95e6-421a-8cc8-92558e04f580` 因 60 steps 上限在 72.7 秒停止；第二次 run `run_e279aa96-e465-4c67-bb6f-3b34f721c844` 在 771.3 秒后以 `no_route / unsolved` 自然结束，observable 3,027,129。用户随后要求只保留 10M token 批次限制，再作一次尝试。第三次 `run_b735e7e1-f223-4c92-9342-66d7c5eecf10` 持续 1,136.5 秒，92 次模型调用、183 steps、56 HTTP 请求；实际调用 `workspace.unpack` 一次，并继续读取/搜索附件，证明受管附件路径进入真实 run。该 run 在 token 预算停止时未产生候选：6,678,978（input 6,436,789 + output 242,189），比本批剩余额度 6,593,693 多 85,285；三次累计 10,085,285/10M，属于末次响应完成后结算越界。没有 candidate 或 oracle submit，未解出。该 run 超过 300 秒，没有复现整段会话中断。不能据此证明 Skill 导致了策略改善、附件被正确理解或漏洞路线穷尽。第三次结果见[结果 JSON](../../gates/m1-web-validation/throwback-s3-retry2-20261021/result.json)、[canonical 事件](../../gates/m1-web-validation/throwback-s3-retry2-20261021/canonical-events.jsonl)和[profile](../../gates/m1-web-validation/throwback-s3-retry2-20261021/release-profile.json)。
- [ ] 第四次 `run_3d5fb14d-28fc-49ea-8011-de445c0d4209` 是独立新批次，授权只保留 10M observable-token 门槛，未设较低时间/steps/tool-job 限制。它加载 Web Skill v2（hash 见本批 canonical），实际读取了第三次遗漏的 `CTFd/templates/admin/chals.html`；登录/注册 POST 返回 302，随后受保护页面 GET 为 200。运行 1,513.5 秒、111 次 admitted model calls，在 observable 8,746,368、低于 10M 时因 `OpenCode model request failed (APIError)` 停止。无 candidate、无 oracle submit、未解出；provider usage 汇总不可用，2026-10-22 从原始会话库恢复底层错误：429 / AccountQuotaExceeded（5 小时额度耗尽）。超过 300 秒且未复现中断。该 trace 支持“材料追踪方法进入实际行为”的有限观察，但不能证明 Skill 的因果效果或成功解题。见[结果 JSON](../../gates/m1-web-validation/throwback-s3-retry3-20261021/result.json)、[canonical 事件](../../gates/m1-web-validation/throwback-s3-retry3-20261021/canonical-events.jsonl)和[profile](../../gates/m1-web-validation/throwback-s3-retry3-20261021/release-profile.json)。
- 保留同一 Solver 的 Strategy/Recon/执行职责，指导其优先已有证据、对关键假设选判别实验、无新证据不重复盲猜。无需强制每步 JSON 或新 hypothesis gate。
- 真实 run 前确认每批 token 预算。本批 10M 已结束；不自动续跑。当前控制层支持无 Cookie 同源 GET 独立重放；若后续获批探索得到的候选依赖 session、POST 或多步请求，先保留证据并判断该批只能探索还是需先做最小验证适配。不以未知解法或重放序列阻塞探索，也不把已知边界说成完整 Throwback 验证能力。由产品 Solver 自主做 Throwback，不途中提示解法；记录 Skill 使用情况、实验和结果，结束后停止。

**完成条件：** Skill 文本及版本确实进入实际模型输入；trace 可定位对应判别实验和模型如何处理反馈。若仅加载但未使用，记“接入完成、方法效果未证实”；若仍盲猜，保留失败并定位原因。仅在同一 run 独立验证和 oracle 整题接受后才记 solved；不因用了 Skill 降低成功标准。

### S3 后续修复：原始附件受管解包、解题目标与可读复盘（已实施；无模型定向验证完成）

**实施边界：** 只修 Throwback 实际暴露的原始 `.tar.gz`、目标/oracle 输入与复盘缺口；不加通用解包框架、不运行附件内容、不扩展候选重放、不接 DVGA/TSecBench。没有调用真实模型、没有沿用上批剩余预算、不提交。

**已确认的失败点：** 重试实际输入把任务描述为“Explore … report what you found”，与寻找 flag 的目标不一致；原始 `throwback_templates.tar.gz` 被直接按 UTF-8 读取成乱码，之后对压缩包搜索也未得到可用源码。最终回答把目标 CTFd 内部空题目列表推断为没有权威裁判。三者需要修正，但尚不能证明是未解出的全部原因。

**证据与纠正：** [重试 canonical events](../../gates/m1-web-validation/throwback-s3-retry-20261021/canonical-events.jsonl) 的 seq 1 为实际任务输入，27–28 为压缩包文本读取，62–72 为目录/压缩包搜索失败；33–39 为登录重定向及带当前用户名的受保护页面，188–193 为退出后回到登录页。因此普通登录和会话延续已有相互支持的真实证据，不能继续只写“cookie 被发送，登录未证实”。重试超过 300 秒、没有候选；结束前有三次目标请求 fetch failed，随后首页仍成功，不能将其与原 300 秒整段会话中断混为一谈。模型最终回答可从原 run 的 OpenCode 消息库只读核对；`no_route` 是终态归类，不证明所有解法已穷尽。

**任务目的：** 保持题目原始输入，由 Solver 在同一 OpenCode 会话中自主选择并调用受管工具，完成“识别附件 → 列出内容 → 解包 → 读查文件 → 分析并设计实验”；正确理解目标应用与 host oracle；让读者看懂本次做题过程和下一步依据。

**修改档案：** `packages/runtime/src/index.ts`、新增专用 `packages/runtime/src/tarGzip.ts`、`apps/opencode-plugin/src/index.ts`、`apps/cli/src/commands/openCodeTask.ts`、`apps/cli/src/commands/solveM1.ts`、`skills/web-session-diagnosis/SKILL.md`、`tests/integration/opencode-fixture.ts`、`tests/integration/opencode-solve.test.ts`、新增 `tests/integration/runtime-tar-gzip.test.ts`，以及本计划、roadmap、AGENTS、README 和既有 `docs/gates/m1-web-validation/throwback-s3-20261021.md`。没有改冻结的 `packages/supervisor/src/skills/*`，没有新建报告系统或 gate。

**实施步骤与完成条件：**

1. **保持题目附件来源，Agent 自主处理。**
   - 只使用本题提供的原始附件及其受管派生产物；不从公共搜索、GitHub、在线源码、writeup 或其他资料补齐/替换，不把先前人工解包目录替代本次原始压缩包输入。
   - 原始附件保留不变。Agent 决定检查/列出/解包哪个附件以及读取哪些文件；host 只执行确定性操作和维护来源。不得由开发者先解包挑好关键文件、解读漏洞或代写本题解法再喂给 Solver。
   - 首先满足本次真实 `.tar.gz` 附件：复用已有本地解包能力，经受管接口暴露列目录/解包结果，产物落入该 task 工作区后由现有读查工具读取。运行中不安装依赖、不开放任意宿主 shell；不预先支持所有压缩/媒体格式。
   - 二进制不能继续当 UTF-8 原文返回给模型；返回格式/大小及可用操作。支持文件级读取/搜索；目录搜索若不支持，应提示先列文件，避免无意义 EISDIR。
   - **已完成与验证：** Web manifest 新增受管 `workspace.unpack`，仅接受 `.tar.gz`；模型选择源附件和后续文件路径，host 在 task 的 `derived/` 子目录执行 gzip/tar 读取、输出并记录源 hash、成员路径、成员 hash/artifact ref。使用本题原始附件经真实 OpenCode 插件 + 确定性 provider 完成 workspace 列出、原件二进制识别、解包、列出模板、读取 `CTFd/templates/base.html` 和搜索；workspace 中原 `.tar.gz` 字节未变。此测试证明受管接线，不证明真实 Solver 自主选对材料或理解内容。

2. **解包具有明确边界，并反馈可修正错误。**
   - 文件只能留在该任务工作区的独立派生目录；拒绝绝对路径、路径穿越、可逃逸的符号/硬链接和特殊文件；不覆盖原始附件或已有工作文件。
   - 对文件数、展开总量等设置必要的本地资源边界并清楚反馈超限/不支持/损坏原因；这是附件操作边界，不暗中恢复用户已取消的 run steps/time/tool-job 上限。后续模型批次预算按用户新授权执行。
   - 元数据、路径、来源 hash 由 host 填充，模型不手写；附件内容是待分析资料，不能改变 scope 或工具权限。默认不执行附件内程序。
   - **已完成与验证：** 解包边界为压缩输入 8 MiB、解压后 32 MiB、512 个文件、单文件 1 MiB；只写新建目的目录且 `wx` 不覆盖；拒绝绝对/穿越路径、链接、特殊成员和重复路径。定向用例覆盖穿越、tar link、源/目标 symlink、重复解包不覆盖及文件数/单文件/总展开限额。目录读取/搜索返回“使用 workspace.list”，二进制读取返回格式/大小和下一步，不再把压缩字节当 UTF-8 文本。

3. **修正真正送入模型的目标和 oracle 说明。**
   - 所有实际生效入口（默认描述、运行参数、系统提示和通用方法）一致表达：自主分析本题并寻找 flag；有真实来源证据时调用 `candidate.register`；未知或失败如实报告，无权威确认不宣称 solved。不能只改一段默认文字而实际运行继续传入探索型描述。
   - 明确目标 CTFd 是被分析的应用；其内部题目列表或提交页面不是本产品的完成判据。host 根据当前配置提供非敏感的“local oracle 是否配置、候选如何交回、验证能力限制”，不让模型猜裁判是否存在。
   - 不传 oracle 答案、私有路径或控制凭据；缺 oracle 如实说明只可候选级结果。会话/POST/多步验证仍按真实候选证据确定，不伪装已有支持。
   - **已完成与验证：** 修正默认 Web 目标；显式 `--description` 作为补充上下文，不能替代寻找 flag 与 candidate/oracle 目标。OpenCode system prompt、user input 和固定方法一致说明通过 `candidate.register` 交回有证据候选；根据 host 配置说明 local oracle 有/无，答案和路径不下发，并指出目标 CTFd 空列表不代表 host oracle 缺失。候选依赖 session、POST、多步时保留当前 verifier 限制，禁止匿名 GET 降级。确定性 OpenCode 输入测试确认最终实际输入和 oracle 答案/路径隔离。

4. **把运行报告改成面向人的复盘。**
   - 在既有 Markdown 主报告前置：一句话结果和真正停止原因；按阶段列“目的/假设 → 实际操作 → 关键观察 → 判断或换路”，再列已证实进展、工程缺口、模型判断错误、未知项及下一步最小修复。
   - 本次重点写明：登录已得到正反观察支持；压缩附件没有被有效读取；实际目标偏向探索报告；目标内空题目列表不能证明 host oracle 缺失；无候选主动结束，末段另有局部请求错误。
   - 将人读结论链接到事件 seq、必要响应片段和模型可见最终回答。不要复制原始隐藏推理、凭据、答案或完整大响应；只依据可核对的输入、行为和结果解释决策。
   - 运行时长、调用数和 token 概况放简表；详细 hash、逐条 usage、JSONL 和原始失败记录继续保留作证据附件，不作为主报告主体。初次 steps 停止与重试自然结束分开叙述，不覆盖历史。
   - **原第二次报告的已完成记录（不代表自动报告能力）：** 既有 report 已整理为运行概况、按阶段“目的/操作/观察/判断”、已证实进展、工程阻塞、模型误判、未知项及下一步。首次 steps 停止与重试自然结束分列；说明 `no_route` 是宿主分类、不是路线穷尽；把登录/登出正反对照与附件未有效读取证据补入；分开记录末段局部 fetch failed 与会话自然结束，不记录隐藏推理、答案或凭证。

   - **2026-10-22 复核纠正：** 第四次只有用量/简短观察被追加，主体仍混用第二次过程，本项此前未完整覆盖最新 run。本次已在[既有报告](../../gates/m1-web-validation/throwback-s3-20261021.md)前置第四次人读阶段复盘并标清历史；通过原始 OpenCode message 确认 429 / AccountQuotaExceeded（5 小时额度），纠正“底层错误未保留”。原始 canonical JSONL 保持不变；derived `result.json` 追加安全错误分类和生成报告路径。
   - [x] 第四次人读复盘人工补齐：过程、关键反馈、未突破环节、停止原因、Skill 行为证据与限制均有来源。
   - [x] 每次 run 收尾自动导出 `canonical-events.jsonl`、`result.json` 与 `postmortem.md`；CLI 结果包含文件路径。主文按超过 60 秒的工具空档分段；段内只合并相邻同类活动并保留先后和各自证据范围，完整工具时间线可展开。HTTP 分开呈现 method、状态、重新导向、主体现况和安全化反馈；debugger query 只输出 allowlist 分类，不输出 PIN、命令值或 payload。`observation.read` 依来源 ref 关联 HTTP 观察并显示续读 cursor/eof；是否读完以实际 EOF 为准。
   - [x] 卡点按工具错误、HTTP 负向反馈、严格匹配的相同输入与结果、provider quota/run stop 分开；每项附证据、下一操作/未知进展与复盘问题。只凭实际记录陈述，不推断策略意图；同路径但输入或响应改变时不标重复。
   - [x] 用量口径分列 tool start/result、HTTP 请求、受管 `job.run` 数、admitted provider calls、OpenCode 已完成且无 error 的 assistant response 数、本地 observable token 门槛与 provider usage；provider usage 缺失仍写 unavailable。时长按分:秒、重置时间保留原时区。
   - [x] OpenCode 错误改为白名单脱敏保存状态码、provider code/type、固定分类和可提取的额度重置时间；未知错误使用固定安全摘要，不落入结果或 checkpoint 的原始 body/headers。
   - [x] 用第四次保存的 305 条 canonical events 离线重生[自动复盘](../../gates/m1-web-validation/throwback-s3-retry3-20261021/postmortem.md)：主文保留活动顺序且时间分 6 段，完整工具时间线可展开；seq 77 redirect、seq 92 空清单、seq 224 HTTP 200 但 `auth=false` 分开呈现；debugger `resource`、`pinauth`、表达式命令依 query 分类但不泄漏值；7 个 HTTP 500 各有负向回馈证据；两次目录搜索错误与之后 seq 285 材料读取明确区分；seq 189 失败后 seq 191–192 同来源续读成功、EOF=false，未宣称整体读完；`traceback` 仅称回应该关键字。provider HTTP 429 / `AccountQuotaExceeded`（8,746,368/10M，未触达本地门槛）、无 candidate/oracle 亦保留。原始 canonical JSONL 与 result JSON 未改；没有模型或靶场调用，第五次 run 原始记录保留且不作为授权验证。

**验证结果：** 实施时的无模型验证为 `npm run typecheck` 通过；用原始 Throwback `.tar.gz` 的 managed OpenCode 集成测试及相关定向回归 15/15 通过；`git diff --check` 通过。该实施验证只证明接线。之后单独授权的第三次真实 run 实际调用了 `workspace.unpack`，证明模型路径使用了受管解包，但仍无候选，不证明附件被正确理解或题目已解出。

**本次复核验证：** `npm run typecheck`、`npm run gate:m0`（169 passed / 1 skipped）、`npm run gate:m1`（3 passed）、复盘定向集成测试（7 passed）与 `git diff --check` 均通过。另检查报告中 393 处 seq/JSONL 行引用，393 处均对应 canonical 事件；305 条事件、6 个活动段和 96 项可展开操作与报告相符。所有验证均未调用模型或靶场。

**停止点：** 本切片完成后停止；新预算获批后才检验真实 Solver 是否自主调用附件工具、理解附件并形成有效实验。候选仍需同 run 独立验证和权威 oracle 整题接受。工具/方法可用后仍停滞才评估 S6。

### S3 方法固化：第三次 run 检查结论与下一步（Skill v2 已实施；无模型核验通过；真实方法效果未证实）

**分析状态与来源：** 「按 M1 主線部署首題」会话 `01a15a2c-b0d2-7d92-ba77-4a135cae436f` 的最后一轮只读分析已 completed，会话 idle；本次重新核对第三次 [canonical 事件](../../gates/m1-web-validation/throwback-s3-retry2-20261021/canonical-events.jsonl) 与当前方法文件。以下 seq 均属于 `run_b735e7e1-f223-4c92-9342-66d7c5eecf10`，不与第二次混用。公开 writeup 和部署源码的比较是开发侧事后分析，不是 Solver 当时掌握的证据，也不进入下一次 Solver 输入。

**结论：** 未解出；停止原因是 token 耗尽，未登记 candidate。已修好的解包、HTTP 和长会话不应重复建设。当前最直接的改进点是已有材料的线索追踪，以及请求结果的语义核对；没有证据证明缺少新工具或独立 Critic 是此次没有候选的原因。

| 检查项 | 真实观察 | 分类与边界 |
| --- | --- | --- |
| 附件中的遗漏 | seq 9/11 解包成功，32 个成员包含 `CTFd/templates/admin/chals.html`；后续读了普通模板和部分管理模板，却没有读取该文件。该文件有表单 method/action 和管理版 JS 引用，run 也没有请求该管理版 JS，读到的是普通版 `static/js/chalboard.js` | 已有可读线索未追踪，是策略遗漏；不是解包仍不可用。管理版 JS 不在归档内，须先沿目标同源引用确认是否可得，不能称已提供该脚本 |
| 题面所指源码/历史 | 先前会话对照公开 writeup，发现其使用源码提交历史收敛到授权修正与调试输出变化；正式 Solver 只有题面/模板归档，不能外搜 | 材料可得性限制；不能要求模型凭空恢复版本历史，也不能把管理模板漏读全归因于缺源码。源码快照不自动等于完整历史 |
| 长响应未核对 | seq 245/246 的 profile POST 返回 200、正文 4,130 bytes，仅内嵌前 2,048 bytes，有续读入口，却没有续读该响应 | 请求有回包不等于业务成功。未读取可能决定成败的正文，缺少后置条件证据；不能反向断言操作一定失败 |
| 重复空结果 | 后续 team POST 的 seq 252/256 均为 200，正文为相同空 `solves` JSON | 未形成支持预期变化的新证据；应检查 method/handler/状态前提并换有依据的实验，而非以 200 认定成功或重复试探 |
| Debugger 支线 | 第三次 seq 148 的 500 及后续 observation 读取有 Werkzeug traceback/debugger 和 `EVALEX_TRUSTED=false` | 第三次确有页面证据；第二次“没有 debugger 标记”的结论只属于第二次。页面存在不等于代码执行可用，更不证明该路线可得 flag；没有成功 debugger 操作证据 |
| 历史解法与本地状态 | seq 95 的 `/chals` 是空列表。先前会话的部署侧源码检查指出相关删除分支依赖 challenge 记录，且有状态副作用 | 空列表不能证明数据库所有记录均不存在；本地版本与历史解法的精确对应、分支前提和可恢复性未证实。不得照搬 writeup 或为匹配解法擅自填数据/重置实例 |
| 候选后验证 | 无 candidate，无 verifier/oracle 调用；现有重放仅无 Cookie 同源 GET | session/POST/多步是已知下游限制，不是这次未产生候选的已证实原因；等真实候选证据再补最小适配 |

**实施归属：** 已在现有 `skills/web-session-diagnosis/SKILL.md` 增补两个通用方法段并更新为 v2；`solveM1.ts` 固定加载、host hash 记录和现有集成测试同步为 v2。没有拆新 Skill、造路由器或扩展冻结的方法库。草案尚待用户审核，不标为已发布。

#### 优先 1：题面线索 → 材料引用 → 可判别实验

**不补的具体影响：** 已成功解包的关键模板仍可能未读，模型继续花预算猜路径，附件可用无法转化为有效实验。

- [x] 已写入通用方法：题面提到源码、历史、修复、版本差异，或附件出现表单/API/脚本引用时，先盘点材料及缺失项；沿 method/action、资源引用追到可得 handler；核对授权条件、状态前提和版本差异，不编造不可见行为。
- [x] 已写明以证据形成可判别实验、记录能改变判断的观察；版本不符、前提不存在或重复结果无新信息时在同一 Solver 内重规划；不新增强制 JSON、假设 gate 或独立 Agent。
- [x] 第三次 trace 离线对照确认方法能指出已列出未读的管理模板及未追踪引用。该检查只说明方法覆盖原失败点，不证明模型行为改善，也不要求未来 run 走特定文件/漏洞路线。

#### 优先 2：完整响应 → 业务后置条件 → 反馈换路

**不补的具体影响：** profile POST 的截断正文及重复空结果无法支持状态变化判断，HTTP 连通会继续被误当成实验成功。

- [x] 已增补通用方法：POST/状态变更先明确可观察后置条件；2xx 仅证明有 HTTP 回应；必要时用现有 `observation.read` 续读影响判断的内容，并以响应及安全状态对照分类支持/反证/未知。
- [x] 已写明空结果、未变状态和重复反馈不构成新证据；区分 500、debugger 页面、执行及取得答案；涉及删除/修改时遵循 scope 和恢复边界，不盲重放或重置目标状态。
- [x] 第三次 seq 245–256 与 debugger 观察离线对照确认方法覆盖“200 但业务后置条件未证实”“关键正文未续读”及“页面暴露不等于执行成功”，没有新建测试框架。

#### 材料、审核、复跑与完成条件

- [x] **材料范围已核对。** 第四次 run 保持原题面、原始附件与授权入口，没有增加源码快照、历史、writeup 或其他外部材料；后续如要补材料仍需单独确定范围。
- [ ] **方法经审核再发布。** 本次 Web Skill v2 为待审核草案，已去除题号、目标路径、payload、专属漏洞定位和答案；由用户审核后再决定是否作为固定方法发布。真实 run 的使用不代表用户已批准 Skill。
- [x] **最小接线核对。** `tests/integration/opencode-solve.test.ts` 的真实 OpenCode 输入集成检查通过，确认 v2 内容进入模型输入并记录 v2/hash；没有调用真实 provider。
- [x] **新预算下真实验证。** 使用同一原始题面/附件范围和目标配置，获用户授权仅以 10M observable tokens 为批次限制；没有额外较低的时长、steps 或 tool-job 限制。run 因 OpenCode APIError 在 8,746,368 observable tokens 后结束，低于阈值；无候选/裁判接受。方法是否实际影响决策仍以 trace 复核，不能由加载 v2 推定。
- [x] **收尾停止。** 保存第四次 run 结果、canonical events 和 profile。未解出，不追加批次；新真实模型运行需另行授权。

#### 误启动的第五次 run（2026-10-22；仅记事故，不计授权验证）

- [x] 我将预算限制澄清错误理解为重跑许可，误启动此 run。profile 设 10,000,000 observable-token 门槛，但这不代表用户授权了本次模型运行。
- [x] run `run_33a5e7fa-4dec-4370-85b8-815f434924e1` 持续 73.4 秒，6 次 admitted calls，host observable 0；底层错误经本地 OpenCode 数据库确认是 HTTP 429 / `AccountQuotaExceeded` / `TooManyRequests`，provider 5 小时额度未恢复。
- [x] 无靶场请求、candidate 或 oracle submit；实际错误记录保存在[第五次 run 目录](../../gates/m1-web-validation/throwback-s3-retry4-20261022/)。不把它算作授权的能力验证，不再重试。

**后置项：** S4 的客户端执行/观察 Skill 随 Seizure-Cipher 独立切片实施；不作为 Throwback 当前方法修正的前置。S6 已有“遗漏线索/无信息重复”的停滞证据，但新方法尚未实际验证，仍不足以证明局部重规划不能解决；不预建 Critic。方法发布、真实使用、实际效果、整题成功分开记录。

### S4：Seizure-Cipher 执行、观察与候选闭环（后续，待授权）

**目的：** 让 Solver 能把客户端/坐标假设变为可核对的真实实验，并能处理由计算或画面得到的答案。

**修改档案：** `solveM1.ts`、`openCodeTask.ts`、`apps/opencode-plugin/src/index.ts` 的必要接线；按选定路径复用 `packages/runtime` 或 `packages/browser`；候选 resolver 仅补本题所需模式。拟新增 `skills/client-side-observation/SKILL.md`，沿用 S3 的受控加载方式，不引入领域库。

**实施步骤：**
- 依据现有公开材料与失败记录，比较受管脚本处理和受限浏览器执行的可行性/总成本，选择一条最小路径。不是先实现两套，也不由开发者预写本题求解脚本。
- 若走脚本，须支持模型创建必要实验脚本、执行并读取结果，而非只开放受历史 patch 限制的工具；若走浏览器，须保留必要页面状态、交互和可观察结果。两者均核实实际文件/网络边界，工作目录限制不等于安全隔离。
- 若依赖图片，先确认当前模型和接口可实际接收图像，且 trace 留有图像输入证据；不能只保存截图就宣称模型看到了。依赖或模型变化须在 run 前明确，新增成本另行授权。
- 候选绑定实际输入、执行过程及输出证据；按本题需要选择独立 replay/recompute/evidence_audit，不能继续要求解码/画面答案原文必须出现在 HTTP body，也不能只打印模型提交的字符串当复现。
- 通用 Skill 只说明何时执行客户端、怎样观察和验证，不写本题坐标解码步骤。工具、方法和验证必要链路检查后，另获预算运行一个真实批次。

**完成条件：** 模型自主完成可核对的执行/呈现实验，实际得到可消费的观察；候选若产生可走匹配来源的独立验证与 oracle。无候选时仅记录实验进展；实际求解结果仍按整题接受判定，不能把“已渲染”记成 solved。

### S5：将真实复盘固化为下一次可用的方法（随对应 run 收尾）

**目的：** 让方法有来源、有适用边界，并真正回到后续产品输入。

**修改档案：** 既有 `docs/gates/m1-web-validation/` 运行/复盘文件及本切片引入的 Skill；不新增报告系统、数据库或自动学习服务。

**实施步骤：**
- 在既有复盘中区分工程缺口、模型策略失败、已验证实验与未验证猜想；提炼方法草案，保留证据来源和反例，不把失败推测写成确定方法。
- 去除题号、flag、目标地址、专属 payload 和答案提示；开发者侧追溯原始记录，模型侧只见通用内容及适用条件。
- 按 spec §10，run 结束后经用户/自然人审核来源、事实、可复现性与许可，再发布新版本；不得同一 run 热更新共享知识。当前规划授权不等于批准未来未知知识内容。
- 下一次已授权且适用的 run 加载该固定版本；不为证明固化单独追加模型批次。可按任务/已声明能力加载少量方法，后续确需动态选择时再接公开按需接口。

**完成条件：** 区分“待审核草案”“已审核发布”“实际加载”“真实使用/效果”。只有后续 trace 有使用证据才宣称方法被复用；没有后续批次则如实保留未验证。原始同题复跑只能证明修复后的该题结果，不冒充陌生题泛化或无训练污染。

### S6：独立 Strategy/Critic（条件项，非当前实施任务）

**触发条件：** 必要工具和方法已实际可用，仍有持续无语义进展、重复被否定假设等 trace 证据，且同一 Solver 的局部重规划不能解决。工具缺失、超时或单次 404 不构成触发。

**后续方案：** 先提出一个通过 OpenCode 公开接口建立的有界独立复核任务，读取必要证据，给出被忽略的事实/不同判别实验，交回原 Solver；另行授权实现与共享预算，不恢复多角色流水线。具体修改位置在触发证据形成后写入本计划，不预建调度框架。

**完成条件：** 真实独立会话与有效反馈可证，区别于职责标签；评估是否改善实验选择及成本，不以派发成功冒充解题改善。未触发不阻塞本阶段其他切片。

## 5. 验证、授权与停止点

- 前次实施记录包括 S1/S2 会话与诊断能力、Skill v1。第一组三次 Throwback run 共用一个累计 10M observable-token 批次，末次响应结算后累计 10,085,285，越界 85,285；随后用户授权一个新的 10M-only 批次，第四次 run 在 8,746,368 tokens 时因 APIError 停止。两批均已结束；继续真实模型验证需新批次授权。observable 按响应完成后累计，可能越过阈值，不代表硬费用封顶。
- 后续改代码时对原始缺口作最小失败复现和定向回归，相关既有 `gate:m0`、`gate:m1` 按仓库规则验证一次；不新增 gate 或重复验证未改代码。不把确定性测试当模型能力证明。
- observable tokens 在响应完成后累计，可能越过阈值，不宣称硬费用封顶；usage 不可得记 unavailable。Verifier/复核与提交共用 run 剩余预算，无隐藏模型批次。
- 404、登录失败、脚本报错和候选 rejected 回同一会话修正，不自动终止或重开 run。整题完成、deadline/预算到达、整体不可用、隔离失效、无授权可行路线、提交结果未知时停止；未知提交不盲重发。
- 每轮保存失败、版本与真实结果，然后汇报停止。不要自动换题、追加批次、恢复冻结轨迹或启动 M2。遗留的 HTTP 取消能力限制未验证前仍如实保留。

## 6. 当前状态与下一步

| 项目 | 状态 |
| --- | --- |
| MFW 首题成功 | 已有 canonical 证据；不代表代码已合并 |
| Throwback / Seizure-Cipher | 均未解出，全部失败记录保留 |
| S1 | 已完成；`promptAsync` + status/message 轮询，本地 OpenCode 定向验证通过；未调用真实模型 |
| S2 | HTTP 会话/诊断已有无模型验证；候选子串保存、无 verifier 状态、POST/会话态拒绝盲重放、GET 独立重放、oracle 结果传播另经 16 个无模型集成用例验证。S3 重试已有普通登录证据；会话态/多步候选验证仍未验证；DVGA 不纳入 |
| S3 | Skill v1 输入加载已验证；v2 加入两项通用方法，输入/hash 集成测试与旧 trace 离线对照通过，草案待用户审核。第四次获授权真实 run 加载 v2 并读取第三次遗漏的管理模板，但在 8,746,368/10M tokens、111 次 admitted calls 后因 provider 429 停止；第五次是误启动记录，在 0 tokens、6 次 admitted calls 后因同一 429 停止，没有靶场请求，不计授权验证；均无候选/无 oracle。前一批 10M 累计越界记录保留；Skill 因果效果与解题仍未验证 |
| S3 后续修复 | 已实施；用本题原始附件完成受管列出/解包/读取/搜索，修正默认与显式目标、oracle 配置说明，整理真实失败复盘；typecheck、15 个定向集成用例与 diff check 通过。第三次真实 run 已实际使用受管解包，但未产生候选；附件理解与解题仍未证实 |
| S4 | 待前序结果与单独切片授权；未实施 |
| S3 方法固化 | Web Skill v2 两项方法已实施；旧 trace 对照与 OpenCode 输入/hash 定向检查通过；第四次 run 使用 v2 后因 APIError 停止，无候选；草案待用户审核，方法效果未证实 |
| 自动复盘 | run 收尾导出 canonical events、result JSON 与可读 Markdown；主文按工具间隔分段，段内按序只合并相邻同类操作，完整时间线可展开。安全化 query 命令分类；分离 HTTP 与 auth 业务状态；空集合仅作事实；同 ref 续读失败后的进度不套用 workspace 规则；traceback 只报关键字。第四次离线重生 305 条事件复盘：6 个活动段、96 项可展开操作；seq 77/92/224 的回馈、7 个 HTTP 500 独立证据、seq 189→192 同源续读进度、目录搜索失败及后续读取均可核对。用户复核 canonical hash 未变；我检查 393/393 个 seq/行号引用正确。8,746,368/10M observable tokens、provider 429 / AccountQuotaExceeded、无候选/无提交；canonical JSONL 与 result JSON 未改。typecheck、gate:m0 169 passed/1 skipped、gate:m1 3 passed、复盘测试 7 passed、diff check 均通过；未调用真实模型或靶场 |
| S5 | 优先方法及审核/复用条件已规划，尚无本次新增已发布/复用方法 |
| S6 | 条件未满足，不预建、不派发 |
| M2 / TSecBench | 未启动，非本轮范围 |

本阶段完成报告必须覆盖工具可用、方法实际使用、真实题目结果和剩余缺口。新增题目未解出就不得标“真实 Web 解题闭环全部完成”；也不以本阶段成功宣称通用解题率。届时再决定进入 M2 或另一个必要切片。

## 附录：本次修订前的自主首题计划快照（历史，不执行）

以下保留原始 A–E 范围及当时状态，含“待执行/待选题”等旧值；当前事实以本文 §2/§6 为准。未逐项勾选旧清单，避免将未用分支一并认定完成。

<details>
<summary>展开旧计划原文</summary>

# M1 自主首题实施计划

创建：2026-10-20。修订：2026-10-21。

**状态：实施计划待执行；本次仅修订文件，不代表任务已实现或真题已解出。** 实施按明确授权执行；真实模型调用另需逐批 token 预算，本文不是预算授权。

**Spec：** [权威设计](../specs/2026-10-14-general-ctf-agent-system-design.md)。**Roadmap：** [现行路线图](2026-10-16-ctf-agent-mvp-roadmap.md)（本轮不改）。

命名沿用 `日期-阶段-内容-plan.md`，保留原创建日期。这里的 M1 表示该阶段重新规划后的自主首题工作，不恢复旧 `m1-solver-loop`／M1B 轨迹，不新增 M1C 里程碑，也不重编号后续 M2。旧计划、历史成绩与未完成能力保留。

## 目标与实施边界

**让现有产品中的 Agent 只凭原始题面、入口和公开附件，自主解出一道现成真实 CTF 题。** 交付是一条可运行的产品路径和一次真实结果，不是一组新的 gate。

```text
现成单题 + 原始题面/公开附件
  → 产品 solve CLI → OpenCode 自主探索/试错
  → 真实 flag 候选 → 既有独立验证
  → Platform Service → local oracle 整题接受 → solved
```

首题选本地可部署、单 flag 的 Web 题，优先 NYU development。具体题号尚未核实，必须在 Task A 选定后再确定题目相关实现；本计划不虚构已选题或可运行的部署命令。不以人工做出解法来证明题目可用。

复用 OpenCode 的模型、会话、工具调用和内循环；复用现有候选、Verifier、Platform Service、LocalFlagOracle。旧 M1／M1B 轨迹全部冻结，不恢复①②或③–⑥，不扩充通用框架、fixture、gate、领域库或角色编排。不接 TSecBench、不搭伪平台 API、不做比赛网站操作 Agent。

## 当前代码基线与明确缺口

以下是 2026-10-21 只读核对的工作区状态，包含现有未提交实现，不是已合并交付声明。

| 位置 | 当前行为 | 首题需要的变化 |
| --- | --- | --- |
| `apps/cli/src/commands/solve.ts` | 已委派 `solveM1`，走 OpenCode | 保留入口，不另造求解循环 |
| `apps/cli/src/commands/solveM1.ts` | Web 指令写死 DVGA 查询，固定接 finding resolver；无权威 Web oracle | 原始题面驱动，按本地首题接候选与 oracle |
| `apps/cli/src/commands/openCodeTask.ts` | Web 候选必须等于最后一次 HTTP 200 的完整 body；结果固定 `candidate_only` | 登记从实际证据提取的 flag，并传播权威完成结果 |
| `apps/cli/src/commands/localHttpCandidateResolver.ts` | 已有独立验证和 oracle 组合，但依赖旧请求形状，只能 GET、完整 body 相等 | 复用服务组合，适配当前 OpenCode HTTP 证据及选题所需请求 |
| `apps/cli/src/commands/localHttpFindingResolver.ts` | DVGA 非公开 paste ID 专用，永不提交 oracle | 保留历史资产，不扩充为通用首题验证器 |
| `packages/local-oracle/src/index.ts` | `LocalFlagOracle` 已支持 accepted/rejected/completed | 绑定本次真实部署的答案来源，不使用轨迹示例 flag |

**删除 DVGA 提示只是起点：** 不修候选提取、验证适配和权威结果传播，即使模型取得真 flag，产品仍不能正确完成这一题。

## 任务顺序与改动归属

`A 选定并部署题目 → B 接入原始题面与必要工具 → C flag/验证/oracle 闭环 → D 一次真实运行 → E 记录与最小阻塞修复。`

B/C 只修源码已证明必然阻止首题闭环的缺口，不花模型预算重复证明已知必败；其余能力等真实运行暴露需要再做。每项实现都必须说明“不修它，这道题卡在哪里”。

实现前确认 checkout、分支与 dirty diff，保护已有 DVGA 及其他未提交工作。新切片需使用经核对包含所需基线的独立工作区，或先经用户授权收口现有切片；不能直接在旧切片 dirty 文件上叠加实现，也不能从 HEAD 创建后假装已带入未提交能力。这只处理实际改动归属，不建设隔离框架；不自行 commit、stash、reset 或删除。

## Task A：确定一道真实题目，部署并接好私有答案来源

**目的：** 让后续实现针对一个具体可运行目标，而不是先扩建工具再找题。

**Files / 产物：**
- 本计划的“执行记录”：填入选定题号、来源版本与部署方式。
- `docs/gates/m1-autonomous-first-challenge/<batch>/result.md`：沿用现有记录方式，记录目标和公开材料清单。
- 题目上游部署文件放在 Solver workspace 之外；公开附件单独导入。部署私有配置和 oracle 答案不写入上述公开记录。

**实现步骤**
- [ ] 从现成 development Web 题选一个有明确单 flag 判据的目标，记录上游版本、题号、原始题面和参赛者附件。只读选题/部署资料，不读 writeup 或预先构造 exploit。
- [ ] 按题目原有方式在本机启动服务，仅做启动和入口可达检查；保存实际启动、停止命令和地址。不自造漏洞题或演示 flag 页面。
- [ ] 确定 flag 与本次实例的可信对应关系：使用原部署支持的私有 flag 注入，或从可信部署配置由控制层读取；不得把开发者随写的字符串冒充该题答案。
- [ ] 分开公共附件、私有部署目录及 oracle 输入。Solver 只见原始题面、授权入口和公开材料；不能通过工具读私有目录、容器挂载或 oracle 配置。
- [ ] 记录本题实际需要的 HTTP 方法、公开附件处理能力及验证是否可安全重放。只确认环境需求，不把漏洞位置或请求解法写进 Solver 提示。

**完成条件**
- [ ] 有具体题号/版本、可访问入口、公开材料目录、可信 oracle 来源及实际部署命令；不是“以后再选题”。
- [ ] 若现成部署不兼容本机或答案无法隔离，写明具体原因；在首次模型批次前换一个现成候选，保留选择记录，不借此扩建环境平台。

## Task B：让产品以原始题面开始自主探索

**目的：** 去掉强制解法，让现有 OpenCode Agent 能针对 A 的真实目标开始做题。

**Files：** `apps/cli/src/commands/solveM1.ts`；仅在本题确需已有工具接入时改 `apps/cli/src/commands/openCodeTask.ts`、`apps/opencode-plugin/src/index.ts`。

**实现步骤**
- [ ] 删除通用 Web 路径中的 DVGA 查询、paste 字段限制和“完整 body 就是答案”指令。保留题面、入口、scope、材料、工具说明和成功须权威确认的说明。
- [ ] 继续使用既有 `--target`、`--description`、`--material` 与 OpenCode 配置；不新增必须由用户填写的 challenge manifest，不让模型维护 ID/hash/预算。
- [ ] 默认复用当前 HTTP 与 observation 工具。若 A 的公开附件处理确需脚本，才接已有 workspace patch/job 能力；确认实际命令限制能运行所需脚本，不能只改 allowlist 就宣称工具已支持。
- [ ] 接脚本时不开放私有部署目录、控制凭据或公共外网；不能满足现有 scope 时记录具体 blocker，不用 unrestricted shell 兜底。不预先加浏览器或新工具体系。
- [ ] 保持正常 HTTP 错误、脚本失败、候选拒绝作为工具反馈回到同一 OpenCode 会话；不因单次失败终止整个 run。不恢复旧模型 JSON 动作协议。

**完成条件**
- [ ] 产品给 Solver 的输入只有原始题面、入口、公开材料和通用工具规则，没有 DVGA 或本题解法提示。
- [ ] 已有工具可执行 A 所需的基本访问/材料操作；未用到的工具不扩充。
- [ ] 用现有 Web 集成测试中的定向用例核对改变的输入与反馈路径即可，不新增行为轨迹门槛。

## Task C：把真实 flag 接到独立验证和权威完成结果

**目的：** 解决“模型拿到 flag，产品却只能登记整页 finding 或固定 candidate_only”的实际阻塞。

**Files：**
- `apps/cli/src/commands/openCodeTask.ts`：`registerWebCandidate`、候选结果和 `finish`。
- `apps/cli/src/commands/localHttpCandidateResolver.ts`：当前 HTTP 证据适配、验证与 oracle 组合。
- `apps/cli/src/commands/solveM1.ts`、`apps/cli/src/main.ts`：本地 oracle 控制层输入与 resolver 接线。
- `apps/opencode-plugin/src/index.ts`：仅当已有 `candidate.register` 需要新增证据选择参数时同步。
- 复用、不预先修改：`packages/local-oracle/src/index.ts`、`packages/supervisor/src/candidate-control.ts` 及既有验证/提交服务。

**实现步骤**
- [ ] 为本地首题增加可选的控制层 oracle 输入（拟采用 `--local-oracle-file <private-path>`）；文件只存本次部署 flag，host 读取后构造已有 `LocalFlagOracle`。不把答案、文件内容或私有路径传给 OpenCode、工具 job、Solver artifact 或模型可读日志。缺该输入仍可探索，但不声称 solved。
- [ ] `candidate.register` 的 value 是模型从真实工具证据提取的 flag，不再要求等于整个 HTML/JSON。首题默认支持候选在完整 HTTP body 中的精确字节提取；不引入任意提取表达式或通用解析库。
- [ ] 复用现有 observation 引用定位本次 run 的实际响应；默认可使用最后一次 HTTP，只有需要选取此前证据时增加可选 observation 引用。host 解析并绑定 artifact/请求/身份，模型不手写 hash、内部 ID 或路径。响应未出现候选时返回可修正的拒绝，不制造证据。
- [ ] 将当前 Web 请求/响应封存记录适配到 `localHttpCandidateResolver` 的服务组合，不恢复旧 SolverAction/experiment 自报协议。按 A 的真实需要保留 GET 或 POST 的原 method/body/content type，不能把 POST 偷换成 GET。
- [ ] 复用既有 Engineer 发布、独立 Verifier task 与执行证据。对可安全重复的请求验证同一候选确实再次出现，不要求动态整页字节完全相等；不预设 endpoint、payload 或漏洞类型。验证脚本须实际取得并核对结果，不能直接输出待验 flag 冒充验证。
- [ ] 若题目需要会话、多步状态或一次性副作用，先核实已有机制能否安全验证；不盲重放、不重置后假装原 run 成功，也不在此建设通用 replay。A 优先选可复用现有能力的题；真实 run 才暴露的不兼容如实记录。
- [ ] 验证通过后仍经既有 VerifiedCoordinator/Platform Service 提交 oracle。将 resolver 的 `status`、`authoritative`、`completed`、验证信息写回 canonical 候选事件与工具反馈，移除 Web 分支固定返回 candidate_only 的覆盖。
- [ ] 只有验证通过且 oracle 权威确认整题完成才设置 accepted/solved；rejected 回到模型继续，缺 oracle 为 candidate_only，结果未知停止提交并如实保留。沿用既有 effect/预算机制计提交次数。

**完成条件**
- [ ] 在已有 `tests/integration/cli-m1-http-solve.test.ts`、`opencode-web-control.test.ts` 或现有 candidate 验证测试中，仅补改变路径所需的定向用例：从较长响应提取实际候选并传播 oracle accepted；无证据/裁判 rejected 不得变 solved。
- [ ] 真实题目的 oracle 输入停留在控制层；Solver 可见输入不含答案或 oracle 私有配置。
- [ ] 定向检查只证明接线行为，不能勾选 D 的真实自主成功。旧 DVGA finding resolver 和冻结轨迹不扩充；不创建新的 gate 命令或验证框架。

## Task D：运行一次自主解题并保存真实结果

**前置：** A–C 中这道题必需的任务完成、实现已获授权、用户已明确批准本批 token 预算。现有相关回归按仓库要求在代码变更后执行一次；不对未改代码反复跑全套，不为启动增加 gate 清单。

**Files / 产物：** 沿用产品输出目录与 `docs/gates/m1-autonomous-first-challenge/<batch>/result.md`，保存 CLI 配置、canonical 记录、工具证据、候选、验证与裁判结果，不建新报告程序。

**执行步骤**
- [ ] 在记录中填入 A 的实际题号/入口、代码基线、OpenCode 模型配置、公开材料与授权预算；保存可复用的实际启动命令。预算未授权时停在这里，不试调用 provider。
- [ ] 使用产品 CLI 启动一个 run。由产品中的 OpenCode Agent 自主做题；开发助手不代写 exploit、不手工提交 flag、不途中提示漏洞或 payload。
- [ ] 在同一 run 的 scope 和预算内允许模型读反馈、修脚本、换路线；404、登录失败、普通工具错误不是新的工程项目，也不自动创建下一 run。
- [ ] run 结束后依据 canonical 结果核对是否整题 accepted/completed；保存失败和实际 usage，随后停止汇报。

**成功条件**
- [ ] 无额外解法提示或人工解题介入；实际工具取得 flag，独立验证通过，可信 oracle 确认整题完成。
- [ ] 若未解出，D 的运行/记录可完成，但“自主首题成功”保持未完成。HTTP 200、verified finding、部分 accepted 或模型自述不替代 solved。

## Task E：只修本轮暴露的一个阻塞，然后停止

**Files：** D 的 `result.md`；只有与观察到的阻塞直接相关的代码文件，不预列新的公共基础设施。

**执行步骤**
- [ ] 回答三个问题：解出没有？实际卡在哪一步？不修哪一处就不能继续？附对应工具/错误/裁判证据。
- [ ] 区分环境故障、产品接线/工具缺口、预算停止与模型推理失败。路线被否定不自动等于产品 bug；没有确定工程阻塞就不改代码。
- [ ] 若当前实施授权覆盖修复，只修该阻塞并做必要定向回归；否则仅报告具体改动建议。不能修一个问题顺带加一套通用机制。
- [ ] 保存首次失败和代码变化，汇报并停止。新 run 须新批次 token 授权；不静默重试、重置计数、偷偷换题或续开旧 M1/M1B。

**完成条件：** 结果记录能指向一个具体阻塞或明确“没有已证实的工程阻塞”；任何修复能解释它与本题继续运行的直接关系。没有下一批授权就没有复跑。

## 预算与停止条件

通用待授权提案仍为 **300,000 observable tokens、900 秒、60 steps、40 tool jobs、最多 5 次裁判提交**。第四次 Throwback run 是用户授权的 10M-only 批次。第五次 run 是错误重启，虽 profile 也设置了 10M，但因用户已澄清无此运行意图，不计为授权批次；它在 observable 0、无靶场请求时被 provider 429 拒绝。每个授权批次一个 run，内部可有多次 provider 请求。observable 在响应完成后累计，可能越过阈值，不宣称硬费用封顶；usage 不可得记 `unavailable`。独立验证与提交沿用同一 run 的剩余预算，不另开隐藏预算。不得自动重试。

整次停止：整题完成、预算/deadline 到达、靶场整体不可用且无法继续、答案隔离失效、所有可行路线都超授权范围或缺必要能力、提交结果未知。一个 URL 或工具失败先回灌模型；未知提交不盲重发。截止后不继续求解/提交，只做允许的记录和清理。保留现有在途 HTTP 取消能力的实际限制，不宣称已经硬取消。

## 执行记录（由实际执行填写，不提前标完成）

| 项目 | 当前值 |
| --- | --- |
| 题号 / 上游版本 / 入口 | 待 Task A 确定 |
| 公开材料 / 部署命令 / oracle 来源说明 | 待 Task A；不得记录私有答案 |
| 实施工作区 / 改动基线 | 待实施时核对，保留现有未提交改动 |
| 模型批次 / token 授权 | 最近一次获授权批次是第四次 Throwback run，10,000,000 observable tokens；第五次误启动 run 实际 observable 0，不计授权验证 |
| A / B / C / D / E | 待执行；不得据文档更新勾选实现完成 |
| 自主首题成功 | 未证明 |

一题成功只证明该配置在该题上成功，不声明无训练污染或泛化通过率。结束后先汇报，不自动进入 M2。后续仍为 **API 接题 → OpenCode 自主解题 → 控制层 API 提交**；本地首题不冒充平台全流程完成，TSecBench 另需明确授权。

</details>
