# design v1 C 詳細 design：控制服務、插件接線與會話綁定

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 2 節 C（含 C.1）與 H 的詳細 design 子文件；控制服務、插件接線、會話身份綁定、逐次預算准入與角色能力落地以本文為準。**既有前台綁定已定稿（2026-10-23）：採用原生 `task` 分支；G 異步生命週期採原生背景路徑，已完成聯合驗證、主 session 複核及主區接入（G §9.2）**。第 3 節既有前台綁定的證據見第 8 節；已定且驗證充分的部分可生成實現 plan，異步增量的固定映射與驗證邊界見 G §7.2.2。本文只定義設計，不構成執行授權；探針只驗證時序、權限與計量接線，不驗證多 Agent 協作效果或 provider 計費精度。

**前提：** [入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）已定：一次 run 由 `apps/launcher` 經 `startManagedOpenCode` 啟動 `opencode serve`，用 SDK 建立 Coordinator 根會話並送出一則啟動訊息；控制服務在 launcher 進程內，與 OpenCode 進程分開；權限不得使用 `ask`。[A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md) 已定：產品角色與 Skill 經配置目錄副本載入。

**修補狀態（2026-10-23）：** 原生 `task` 與會話綁定的設計決策維持不變。第 10 節記錄首題流程測試前的必要修補與推遲項目；第 10.1 與 10.3 節修補已整合主工作區並通過無模型回歸；第 10.2 節仍推遲。第 8 節的既有探針結果不代表已覆蓋這些失敗路徑。

---

## 1. 範圍

本文定義：

- 控制服務的組成與信任邊界；
- 產品插件與控制服務之間的接線；
- 根會話與子會話的身份綁定；
- 逐次模型調用的預算准入、用量計量與預算停止；
- design v1 H 角色權限的執行方式；
- 停止、撤銷與到期。

不在本文：受管工具的具體清單與參數（design v1 G）、題目接入工具（E）、候選固定與驗證流程本身（D）。本文只規定它們接入控制服務的位置與權限檢查方式。

## 2. 組件與信任邊界

| 組件 | 所在進程 | 持有 | 職責 |
| --- | --- | --- | --- |
| 控制服務 | launcher | 平台憑據、oracle 私有資料、RPC 傳輸憑據、SDK client | 綁定表、預算帳本、角色能力表、受管工具的實際執行、停止與回收 |
| 產品插件 `apps/opencode-plugin` | OpenCode | 只有 RPC 傳輸憑據 | 把 hook 事件與受管工具調用轉給控制服務；按控制服務的回覆放行或拒絕；不做任何判斷 |
| OpenCode | OpenCode | provider 憑據 | 模型調用、會話、原生工具循環 |

規則：

- 插件由 launcher 在運行時以 `plugin` 配置注入（與 provider 一樣屬運行時欄位，`product/opencode/opencode.json` 仍不得包含）。除產品插件外不載入任何插件；工作目錄邊界（design v1 1.5）保證題目材料無法注入插件。
- RPC 只監聽 `127.0.0.1`，每次 run 隨機產生至少 32 字元的傳輸憑據，經插件 options 傳入。該憑據與 provider 憑據同在 OpenCode 進程內可見；它只能調用控制服務的受限接口，不能取得平台憑據或 oracle 資料。
- **插件預設拒絕**：任何 hook 在 RPC 失敗、逾時或控制服務未回覆時一律拒絕（拋錯），不降級為放行。
- 控制服務查詢會話事實（`parentID`、實際 `agent`、子會話列表）只用 launcher 自己持有的 SDK client，不採信插件或模型傳來的值。
- `tool.execute.before` 的 input 不含 `agent`（只有 `sessionID`、`callID`、`tool`；探針觀察），因此工具層的身份一律以綁定表為準，不以 hook 參數判斷角色。

## 3. 會話身份綁定

2026-10-25 第一优先级收窄为[创建方式保存与续接漏参补齐](2026-10-25-design-v1-sync-resume-provenance.md)，细节以该子设计为准：host 保存创建 background，续接漏写时经 plugin 补入实际调用；显式值保留，不新增模式锁定或报错永久禁用。旧强制后台补丁已撤回，最小补参代码及无模型验收已完成并合回主区；结果／错误／停止机制不在本次改造。

**可信事實的來源：**

| 事實 | 來源 | 不採信的來源 |
| --- | --- | --- |
| 會話 ID | hook input 的 `sessionID`（由 OpenCode 提供） | 工具參數、模型輸出 |
| 實際角色 | SDK `session.get` 的 `agent`，與 hook input 的 `agent` 交叉核對 | `task` 工具參數、模型自稱 |
| 父子關係 | SDK `session.get` 的 `parentID` | 模型提供的任何 ID |

**根會話（已確定）：** launcher 用 SDK 建立根會話，在送出啟動訊息前取得其 ID，立即在綁定表登記為 `coordinator`、本次 run、全部授權範圍。根會話在第一次模型請求前即已綁定，不屬未知數。

**子會話（既有前台路徑已驗證，第 8 節 V1–V5；以下異步 pending 增量已在隔離原型聯合驗證，見 §6.2）：**

1. **分派登記**：已綁定會話調用原生 `task` 時，插件在 `tool.execute.before` 把 `{sessionID, callID, args.subagent_type, args.task_id}` 送給控制服務。控制服務檢查：
   - 該會話的角色是否允許分派該 `subagent_type`（第 5 節分派表）；
   - 若帶 `task_id`，它必須是同一父會話先前分派、同一角色、仍有效的子會話；否則拒絕。
   
   通過後登記一筆待綁定分派 `{父會話, callID, subagent_type}`。**同一父會話對同一角色同時只允許一筆未消費的待綁定分派**：已有一筆待綁定時，同角色的第二個 `task` 在 `tool.execute.before` 被拒，Coordinator 可在前一個子會話綁定後再分派。本片保留此保守限制；異步綁定另須原生父 tool part 的 callID→sessionId 精確關聯，不能只按父＋角色猜測。不同角色的並行分派不受限制（V6 已驗證）。

   **釋放（依 G 異步契約修訂）：** 由可信首次綁定消費；或在確認分派失敗、取消、父會話撤銷／停止或到期後釋放。父會話下一次 `chat.params` 不再構成釋放條件：背景分派返回後 child 仍可能正在建立。結果未知時保留 pending、拒絕同父同角色新分派；清除後到達且不能可信對應的 child 必須拒絕，不能配給後來的新任務。公開 task error 事件的按 callID 釋放、延遲綁定與遲到錯配拒絕已有 G §7.2.2 的確定性證據；保持同父同角色一筆限制，不以猜測擴大並行。舊「父下輪准入清理」僅為前台原型歷史行為，不能沿用為異步設計。

2. **首次綁定**：任何 hook 帶有未知的 `sessionID` 時，控制服務以 SDK `session.get` 取得 `parentID` 與 `agent`。僅當 `parentID` 是本次 run 已綁定且未撤銷的會話，且該父會話有一筆 `subagent_type` 與 `agent` 相同、尚未消費的待綁定分派時，才綁定並消費該分派；否則拒絕。異步新增條件：若存在已取消／釋放分派的遲到 child，不能僅憑父＋角色重用新 pending；必須有可信分派關聯或已確認舊建立流程不會再產生 child，否則拒絕並保留未知狀態，固定 runtime 已能由 SDK 查父 tool part 的可信 metadata 精確核對；讀取失敗或無匹配即拒絕，不釋放 unknown。
3. **綁定內容**：會話 ID、角色、父會話、run、題目 scope、工作區、到期時間。角色決定能力（第 5 節），不能由後續任何參數改變。
4. **未綁定的會話**：所有 hook 拒絕，因此不能發出模型請求、不能執行任何工具。子會話的第一個非 `event` hook 是 `chat.message`，綁定在其中完成；首次查詢 SDK 約 40–50 毫秒。
5. **審計關聯**：`task` 的 `tool.execute.after` 輸出 `metadata` 含 `sessionId` 與 `parentSessionId`，用來把 `callID` 與實際子會話對應並寫入證據。
6. **`task_id` 恢復**：帶合法 `task_id`（同一父會話先前分派、同一角色、仍有效）時，OpenCode 恢復同一會話並以原角色運行，已綁定的會話不再消費待綁定分派（探針 S3c）。

**历史G-V1题目绑定增量（当时为独立原型，主线尚未实现）：** 解題角色的 challengeId 來自 [G 詳細 design §2](2026-10-23-design-v1-g-solver-minimal.md)，不解析 task 自由文字。尚未消費的選題宣告跨模型輪保留，與本節的待綁定分派分開；當時原型「父會話下次准入清理」只清理已發出而未綁定的 pending；現已由上述異步釋放規則取代，舊驗證不證明新時序。恢復既有 task_id 不建立新 pending，宣告同題消費、異題拒絕且保留。G-V1 已以 14 項確定性回歸和 OpenCode 1.19.3＋loopback 替身的 T1／T5／T7／T8 驗證修訂協議；舊失敗與本輪 T5 首次失敗均保留。結論與證據已同步主工作區，見 [G-V1 報告](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md)。這是獨立工作區原型結果，非 C 舊身份探針推論；產品代碼未合併，当时正式插件/launcher接线与工作目录建立仍未验证；本轮结果见第6.1节。

G 的慢工具接线、取消与 RPC 时限以该子文件 §7.2、§7.2.1 为准。本轮独立工作区已完成产品 entry／launcher／C 的无模型接线：SDK 与外部等待不占状态队列，队列仅做存活复核、准入／分派／资源登记等短暂变更；保留第 10.1、10.3 节既有修补。绑定的私有目录在首次准入前准备，停止发生在任何异步等待中时，返回后再复核，不允许新启动。产品代码尚未合并主区。

## 4. 預算准入與計量

| 項目 | 做法 |
| --- | --- |
| 准入點 | 插件在 `chat.params` 向控制服務請求一次模型調用准入；拒絕時拋錯，該次模型請求不發出 |
| 拒絕訊息 | 使用固定文字（例如 `budget denied`），不得含 OpenCode 判為可重試的字樣：探針中含 `exhausted` 的拒絕使 OpenCode 對同一請求退避重試約 6 次、拖過時限。重試不會超支（每次重試都重新申請准入並被拒、不扣額度），但會延遲停止 |
| 帳本 | 每個 run 一份，所有會話共用；准入時扣減可用模型調用次數，並按剩餘可觀察 token 預算給出本次 `maxOutputTokens` 上限。准入序列化保證模型調用次數不重複扣用；目前不為在途請求預留 token，因此不同請求可能依據同一份尚未更新的用量取得輸出上限，不承諾 token 硬封頂（第 10.2 節） |
| 計量 | 從 OpenCode 的 assistant 訊息讀取 provider 回報的 usage，按會話歸屬；不可得時記 `unavailable`，不以 0 或估算代替。准入次數是精確計數；token 合計在正常結束時與 provider 回報一致（V8），**在停止路徑上會偏低**：停止時正在執行工具的訊息被 OpenCode 以中止錯誤取代，其 usage 歸 0。因此被中止的訊息標記為 usage 不完整，run 的 token 合計註明為下限，不當作精確值 |
| 預算停止 | 已觀察用量達到預算時，控制服務停止全部會話（第 6 節）。在途回應可能越過門檻，不宣稱精確硬封頂（design v1 1.4） |
| 時限 | 沿用 launcher 現有的時限停止，改為經控制服務統一停止 |

預算來源：運行配置中的模型調用次數上限、可觀察 token 上限與時限。預算說明或上限澄清不等於啟動新批次的授權。

## 5. 角色能力（design v1 H 落地）

**兩層約束，缺一不可：**

1. **可見性**：`product/opencode/opencode.json` 為每個角色明確 allow／deny 原生工具與受管工具（不用 `ask`），決定模型能看到哪些工具。
2. **執行許可**：每次工具調用在 `tool.execute.before` 由控制服務按「綁定的會話 × 角色 × run scope × 參數」核准。可見性設定錯誤時，執行許可仍會拒絕。

角色看不到的工具被模型調用時，OpenCode 將其轉為 `invalid` 工具並直接報錯，不觸發 `tool.execute.before`（探針 S2b）；因此執行許可層對越權調用的攔截只在可見性設定出錯時才會生效，實作時須以定向測試單獨驗證該層（第 8 節）。

**分派表**（原生 `task`）：只有 `coordinator` 可分派，可分派其餘八個角色；其他角色一律不可分派（design v1 H：Strategy 的分派交 Coordinator）。

**首版能力表**：工具名稱以現有或已規劃者為準；尚未存在的受管工具標明所屬章節，不在本文定義其參數。受管工具經產品插件註冊後，在 OpenCode 中的工具 id 為 `ctf_<名稱>`（`.` 換成 `_`，例如 `challenge.list` → `ctf_challenge_list`）；`opencode.json` 的 allow 鍵與 `tool.execute.before` 收到的工具名都是這個 id，插件轉給控制服務執行時用原名稱。

| H 能力 | 首版工具 | 授予角色 | 執行時檢查 |
| --- | --- | --- | --- |
| 知識讀取 | 原生 `skill`；原生 `read`（限本次 run 的 Skill 副本與共用知識目錄） | 全部角色 | `read` 路徑解析 realpath 後必須位於允許根目錄內 |
| 任務分派／交接 | 優先原生 `task`；G 背景交付映射已驗證（§6.2）；創建方式保存與續接漏參補齊見第 3 節子設計；結果接收沿用既有路徑 | `coordinator` | 第 3 節分派登記 |
| 任務狀態讀取 | 受管工具（待定） | 全部角色 | 只返回本 run、本角色可見的狀態 |
| 工作區讀寫 | 受管 `workspace.*`（待 G） | Recon、Domain Solver、Engineer、Verifier（獨立工作區）；Intake 最小版只用 E 唯讀接入 | 路徑限於該會話綁定的工作區；原始材料唯讀 |
| 實驗與作業控制 | 受管 `http.request`、`job.run` 等（待 G） | Recon、Domain Solver；Engineer 僅本地；Verifier 僅按驗證模式授予 | scope、句柄綁定題目與會話、資源上限 |
| 題目接入 | 受管 `challenge.list`、`challenge.read`（[E 最小版詳細 design](2026-10-23-design-v1-e-intake-minimal.md) 第 4 節） | Intake | 角色為 `intake`、題目屬本 run；讀取限於該題 `materials/` |
| 產物發布／讀取 | `artifact.publish`／`artifact.read`（已接入，細節見 D §3） | Recon／Domain Solver／Engineer 發布及讀取，Verifier 僅讀 | 同 run／題目授權，發布限本會話來源與背景 execution；固定產物不等於候選或 verified |
| 候選／解法包固定及讀取 | `package.publish`／`package.read`（已接入，見 D §4） | publish僅Engineer；read為Engineer及本次版本綁定Verifier | 一次固定整包、明確版本、同題授權；Verifier須先經assign與原生execution綁定，見D§5；不等於獨立驗證通過或可信提交 |
| 驗證結果登記 | 受管工具（待 D） | Verifier | 只接受綁定為 Verifier 的會話 |
| 平台操作請求 | 受管工具（待 D、E） | Coordinator | 由控制服務檢查驗證有效性後執行 |
| 任務停止 | 受管 task.stop 語義已選定，背景控制時序已在隔離原型驗證（G §7） | Coordinator | 核實本實例 dispatched 與 binding 的直接父關係；task_id 只用於選擇，不作授權 |

Reference、Strategy、Recovery Critic 只有知識讀取與狀態讀取（design v1 H 的「不授予」欄全部保留）。角色合併只能在分派時由控制服務明確綁定，不允許 Agent 自稱兼任取得權限。

**Verifier 獨立性**：Verifier 由 Coordinator 經 `task` 分派，以獨立會話運行；它的上下文只含分派時傳入的內容與經授權讀取的固定證據，不繼承 Solver 的推理上下文（第 8 節 V7 驗證）。

## 6. 停止、撤銷與到期

- **全局停止**（時限、預算、明確結束 run）：先標記 run／綁定停止並拒絕新准入，再於狀態隊列外取消歸屬 HTTP／job、以公開 SDK 列舉及 abort 子會話，保存各項確認／失敗／unknown。不得等 SDK 返回才撤銷，也不得以 abort 成功代替資源回收確認。
- **單一子會話撤銷**：採受管 `task.stop(task_id)`，只允許可信直接分派關係，核實 run、角色與有效期並在 execute 再核實。先撤銷，再於隊列外回收／abort；資源與 SDK 結果分開，重複停止冪等。局部接線有證據，後續原生背景路徑的自然停止已在隔離原型通過，條件及覆蓋以 [G §7](2026-10-23-design-v1-g-solver-minimal.md) 為準。
- **到期**：綁定帶到期時間；到期後的 hook 一律拒絕，由宿主取消歸屬資源，不等待 Agent 自願停止。
- **父 idle 不等於 run 完成**：存在活動 child、pending 或待交付結果時不得因父會話暫時 idle／assistant 訊息結束而全局停止。正常收束須可信確認任務處置、結果交付及資源結算；主動結束走全局停止。正常收束依 C 的 execution／pending／queued 交付與資源結算，固定公開接線證據見 §6.2。
- **異步交付與准入**：首次分派回覆交付可信引用，後續完成訊息關聯同一邏輯任務及該次執行，不改寫首次工具回覆。進度／完成喚醒仍經共享預算准入；停止後只保存遲到結果，不重啟模型。只提供授權任務的必要狀態／摘要，不擴大私有工作區權限。

### 6.1 G 慢工具与停止的本轮接口增量

本节记录原型验证；后续 G 已定接线已整合主区，当前验收状态见 G §9.2。

真实产品插件仅使用公开 `tool.execute.before` 的 session/call 与 output.args 私有 Symbol，将 callID 和宿主核准时限带到 execute；ToolContext 公开类型没有 callID，不依赖非公开字段。Symbol 不进入模型 schema／JSON，单次消费；并发同会话同工具与 runtime 均已验证。RPC 断开 signal 传到 C 与适配器；普通 hook 15 秒，等待型调用使用 C 核准的 min(等待上限,绑定剩余)+5 秒。

run/session/call 登记先于 HTTP／job 启动，旧短等待原型的 job 在句柄响应后保持登记直到程序组与输出结算；新契约同次等待终态，收尾 unknown 仍须保持登记；已停止或过期的会话不新增操作。stop/revoke 同时取消归属资源；HTTP 清理最多1000ms，C资源收尾最多4000ms，unknown保留状态和配额，不能写已释放。response 未 writableFinished 的断开取消并审计原call；旧短等待原型正常finish不取消已交付running job；新终态等待不正常提前交付running。finish不是客户端应用回执，交付未知不自动重发。

真实 OpenCode 1.19.3、plugin/SDK 1.19.0、loopback确定性替身在同一产品入口完成绑定、文件、HTTP16004ms、job16054ms、增量输出与统一停止。C的短串行/配额/停止及交付屏障有无模型回归。该批长job超过wait_ms的直接promptAsync恢复不能更新已结束父task，失败仍保留。后续同次终态等待已验可行；现已选定Solver终态等待＋Coordinator异步交付／停止契约，该批尚未验证父层公开接线；后续联合结果见本节6.2及G §7.1–7.2.2；OS机制与部署限制另见G §5.4，不拼接为同一次验收。本批无真实模型或D/oracle验证。完整条件和失败：[G本轮报告](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/REPORT.md)。

### 6.2 原生異步生命週期的固定映射（隔離原型）

採 OpenCode 1.19.3 的公開 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 與 `task(background=true)`。實際 flag false/true schema 對照已確認可用；不使用 SDK 備案。模型／工具內循環、child 執行與通知都由 OpenCode 完成，C 不增加調度／provider 循環。

- before 由 C 生成 run／parent／callID／role／challenge 關聯的執行 ref，覆寫原生 description 為固定標記；不由模型維護。首次綁定另以 SDK child parentID／agent 及父 tool part 的 callID／sessionId 核實，不以標記自由文字授權。父先下一輪不清 pending，unknown 保留，公開 task error 只釋放自己的 starting call。
- 原生 synthetic 完成通知攜帶固定標記，C 核對原父、child 與 ref；重複／遲到通知拒絕再次喚醒並留痕。已完成 session 再執行用新 ref，仍在執行的同 session extend 拒絕。queued 與經共享准入後 consumed 分開；預算／停止後為 suppressed，結果及不完整用量保留。首次 running 工具回覆單獨保存，不改寫。
- 早期 child 引用可在首個 child hook 前由父發 stop；C 先用 SDK 完成可信綁定，再撤銷與回收，遲到 hook 不得獲模型准入。停止後全局收尾復用同一停止 promise，不重發已確認或 unknown 的 SDK abort。完成先到則 task.stop 回報原終態；host revoke 仍撤銷會話。取消由 task.stop 關聯回覆交代，不依賴原生另發取消通知，亦不稱成功完成。
- 正常父 idle 收尾必須沒有 starting／running execution、pending、queued 結果或未結算資源。各等待在短狀態隊列外；unknown 繼續保額。

同一固定候選完成六個完整 runtime 情境及 86/86 定向、319/319 全套，typecheck/build 通過。原失敗與 runtime／確定性覆蓋界線見 [聯合報告](../../gates/g-solver-verification-20261023/joint-async-lifecycle/REPORT.md)。該批次當時尚未合併產品代碼，後續整合見 G §9.2；主 session 已獨立重跑六個 runtime 情境及 86 項定向測試，核對原始證據與來源 hash；見同目錄 parent-review.json。重複通知／啟動失敗／unknown 等故障為確定性覆蓋，不冒稱全部經 runtime 注入；跨重啟帳本、真實模型與 OS／網路隔離未驗。原型保留舊 direct-host 測試的顯式 wait/completion 內部路徑，模型工具 schema 只提供 job 同次終態等待；最終整合仍須按 G 固定外部契約。

## 7. 公開接口不足時的去向

沿用 design v1 C.1 的三個分支。**既有前台綁定採用第一個分支**；G 的背景分派／通知已以固定 runtime 原生公開接口驗證可行（§6.2）。SDK 分支的建立、綁定、執行及隔離原語曾有探針證據，但完整異步交付與停止契約未驗，不據此宣稱備案可用。只有原生公開接口不能滿足 G 契約時才評估有界 SDK，不另建通用排程、監工 Agent 或 provider 循環。

| 第 8 節驗證結果 | 去向 |
| --- | --- |
| 子會話在第一次模型請求與工具操作前可被綁定，且 V2–V9 成立 | 採用原生 `task`，即本文第 3 節機制 |
| 原生 `task` 不滿足綁定或 G 異步生命週期契約，但 SDK 能「先建立會話、綁定、再執行」並可隔離與取消 | 改為有界 SDK 接線：由 Coordinator 調用受管分派工具，控制服務經 SDK 建立子會話、完成綁定後才送出任務；決策仍由 Agent 作出，模型與工具循環仍由 OpenCode 執行 |
| 兩者都不成立 | 列為架構阻塞，報告缺失接口與可選的產品範圍調整；不自寫 provider 循環、不維護 fork |

## 8. 已驗證的前提

2026-10-23 無模型探針：真實 OpenCode 1.19.3、本地確定性替身 provider、token 0，經 `startManagedOpenCode` 同一隔離環境啟動 `opencode serve`，根會話由 SDK 建立並先綁定，載入只記錄並按控制服務回覆放行／拒絕的探針插件，綁定器按第 3 節機制最小照寫。報告見 [`docs/gates/c-binding-probe-20261023/REPORT.md`](../../gates/c-binding-probe-20261023/REPORT.md)。

| # | 結論 |
| --- | --- |
| V1 綁定時序 | 成立。子會話的第一個非 `event` hook 為 `chat.message`，帶子會話 ID；此時 SDK `session.get` 已返回正確的 `parentID` 與 `agent`；綁定早於該子會話的 `chat.params` 准入，准入早於其第一個模型請求；第一次工具操作的 `tool.execute.before` 在綁定之後 |
| V2 角色不可冒充 | 成立。模型以參數自稱其他角色時綁定不變；hook 的 `agent` 與 SDK 返回一致；不在分派表內的分派被拒且不產生子會話。保留：越權 `task` 被可見性層先攔，執行許可層未被單獨觸發 |
| V3 `task_id` 不可劫持 | 成立。他人或外來會話的 `task_id` 均在 `tool.execute.before` 被拒，目標會話其後無請求。合法 `task_id` 恢復同一會話（見第 3 節第 6 點） |
| V4 未分派會話被阻止 | 成立。經 SDK 直接建立、未經分派的子會話第一個 hook 即被拒，零請求、零工具執行 |
| V5 停止、撤銷、到期 | 在原探針時序下成立。先標記後 abort 後無新請求、在途工具未執行；撤銷或到期後該會話的工具與模型調用均被拒。未覆蓋准入等待用量查詢期間才停止、撤銷或到期的競態，見第 10.1 節 |
| V6 不重複花用 | 模型調用次數成立。不同角色並行子會話共用帳本，准入總數等於額度，模型請求數等於准入數；不證明並行 token 預留或精確成本封頂 |
| V7 上下文隔離 | 成立。子會話請求均不含父會話私有內容，SDK 先建的會話同樣成立 |
| V8 用量歸屬 | 正常結束時成立，遞迴列舉的全部會話 usage 合計等於 provider 回報；停止路徑偏低（見第 4 節） |
| V9 hook 覆蓋 | 成立。`chat.message`、`chat.params`、`chat.headers`、`tool.execute.before`、`tool.execute.after` 對根會話與子會話、對原生 `read`、`task` 都觸發；本文機制只依賴非實驗接口。`experimental.chat.messages.transform` 的 input 不含 `sessionID`，不能按會話判斷 |
| SDK 分支原語 | 成立：先建立後零活動、綁定後受閘門控制、abort 後無活動、建立時的會話權限生效且上下文隔離 |
| 無未准入請求 | 成立：每個模型請求之前都有同會話的准入；前提是內建 `title`、`summary`、`compaction` agent 已停用 |
| `permission.ask` | 全部運行未觸發；被拒的權限由 OpenCode 直接報錯 |

**真實模型下的確認（2026-10-23）：** 控制服務首版經 `apps/launcher` 以火山方舟 Coding Plan（OpenAI 兼容端點、`deepseek-v4-1-flash-261017`、適配器 `@ai-sdk/openai-compatible`）跑一輪：根會話與經 `task` 分派的 Intake 子會話都在各自第一次模型請求前綁定；8 次准入對應 8 條 assistant 訊息；provider 回報的 usage 完整（輸入 8,251、輸出 2,677、推理 1,059）；Coordinator 自行結束，無 provider 錯誤；證據中無憑據。單次輸出上限不越界依插件取「模型 `limit.output` 與剩餘額度的較小者」推斷，未記錄請求體中的實際值。報告見 [`docs/gates/real-model-smoke-20261023/REPORT.md`](../../gates/real-model-smoke-20261023/REPORT.md)。此運行沒有題目來源，只確認接線在真實 provider 下成立，不代表角色協作效果或解題能力。

**插件註冊的受管工具（2026-10-23，零 token）：** 真實 OpenCode 1.19.3、本地確定性替身 provider，經 `launch()` 跑一輪並註冊 Intake 的兩個接入工具：`opencode.json` 的 per-agent 權限對插件工具同樣生效（`intake` 的模型請求含 `ctf_challenge_list`、`ctf_challenge_read`，`coordinator` 與 `recon` 的請求不含）；調用觸發 `tool.execute.before`，工具名為 `ctf_<名稱>`，審計中依序為 `tool.before`、`tool.execute`、`tool.after`。因此第 5 節的兩層約束對受管工具成立，與原生工具相同。

探針未覆蓋、實作時以定向測試補上的項目：

- 角色可見性設定出錯時，執行許可層對越權 `task` 與其他工具的攔截（`task` 與 Intake 接入工具已有定向測試）；
- 載入產品插件後原生 `skill` 的 hook 覆蓋（`skill` 本身已在未載入插件的運行中驗證可用，見 [A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md) 第 5 節）；
- 同角色第二筆待綁定分派被拒（第 3 節第 1 點新規則）；
- 若日後啟用內建 `title`／`summary`／`compaction` agent，其模型請求是否經 `chat.params` 准入。

## 9. 與現有代碼的關係

- `packages/opencode-bridge` 的 `OpenCodeBridgeRpcServer`（loopback、Bearer 憑據、`/tool` 與 `/control`）與 `apps/opencode-plugin` 現有的 `tool.execute.before`、`chat.params` 轉發，是本文接線的起點；現行實作只認單一綁定會話，需改為按綁定表處理多會話，是否沿用原檔案在實現時判斷。
- `packages/supervisor` 的 `responsibilities`、`candidate-control`、`candidate-verification`、`long-job-watch` 等保留模組，按 design v1 D 接到控制服務；是否沿用其現有介面在 D 的實現時判斷，不以保留現有類別為前提。
- 現行插件的 `experimental.chat.messages.transform`／`experimental.chat.system.transform` 轉發只服務已退場的單一 Solver 入口；本文機制不依賴實驗接口（V9），實作時移除這兩個轉發。

## 10. 首題流程測試前的修補安排

本節限定 C 的修補範圍，不是整個首題流程已可運行的判定。 G 的首題前置與延後項以 [G §10](2026-10-23-design-v1-g-solver-minimal.md) 為準：保留結果交付、pending／idle 與停止的必要接線；不因此提前實作完整進度系統、跨重啟恢復或精細資源帳本。先完成 10.1 與 10.3 的最低要求；10.2 不作為首題測試的前置條件。修補使用無模型回歸，不新增 provider 求解循環、配套 gate 或完整恢復系統。後續實現 plan 從本節生成，每份只覆蓋一個可獨立驗收的能力；本節不引用 plan，也不把待做項目記為已驗證。

### 10.1 停止後仍可能放行模型請求——當前修補

**問題：** `ControlService.decide()` 先檢查會話有效性，`admit()` 隨後等待用量查詢。若等待期間 run 停止、子會話被撤銷或綁定到期，查詢返回後目前仍可能扣減調用次數並放行。這違反第 6 節的停止要求。

**要求：** 在非同步用量查詢完成後、扣減次數與返回准入之前，再核實 run 與會話仍有效。已停止、撤銷或到期的請求必須拒絕，不增加准入次數。已經放行的在途請求仍按既有 abort 路徑處理，不把這項修補描述成撤回已發出的請求。

**無模型驗收：** 用可控制返回時機的 SDK 替身暫停用量查詢，分別觸發全局停止、子會話撤銷及到期，再釋放查詢；三種情況均拒絕該次准入且計數不增。相同時序但會話仍有效時正常放行一次。測試必須覆蓋等待中的狀態變化，而非只測停止後才開始的新請求。

**整合結果（2026-10-23）：** `admit()` 在用量查詢返回後重新檢查 run 停止狀態及會話有效性，再扣次數。停止、撤銷、到期的等待中競態均被拒且不增加准入；有效會話對照正常放行。原始三項失敗與修補後記錄保留於 [停止准入回歸記錄](../../gates/c-binding-probe-20261023/stop-admission-regression.log)。整合驗證與第 10.3 節同批執行，結果見該節。

### 10.2 並行 token 預留、更精密的預算帳本——推遲

**目前承諾：** 共用模型調用次數與可觀察 token 門檻；已觀察用量達到門檻後不再准入，在途回應可能越過門檻。序列化准入不等於預留在途 token。

**安排：** 首題前不加入 token 預留、預估成本或結算機制。若後續確實需要更嚴格的並行成本約束，再確認所需保證與 provider 可提供的計量資訊，另行設計；目前不指定候選方案為既定實作。已有用量不能因中止而被抹掉、缺失用量不能冒充完整，屬於 10.3 的最低記錄要求，不以本項推遲為由略過。

### 10.3 異常退出的證據保存——當前只補最低限度

**問題：** launcher 的會話匯出位於正常執行路徑，SDK 查詢異常可能跳過後續匯出；關閉 OpenCode 若拋錯，也可能阻斷尾部記錄寫入。控制服務重新讀取訊息時，還可能用中止後的零值覆蓋已觀察用量。現有審計與狀態檔應繼續使用，不重建記錄系統。

**最低要求：**

- 正常或異常退出都嘗試保存已取得的停止／錯誤原因、綁定、准入、審計及用量；一項會話查詢或清理失敗，不應阻止其他已在記憶體中的證據落盤。沿用既有版本與配置記錄及憑據清理規則。
- 已觀察到的消耗不能因後續訊息被中止或清空而倒退，也不能重複累加同一訊息。usage 缺失記 `unavailable`；只取得部分用量時，合計明確標為下限／不完整，不以零值宣稱完整。此要求不新增 token 預留。
- abort 失敗要留下失敗或未知結果，不能記為已成功中止。證據寫入本身失敗時如實報錯，不宣稱保存成功。

**無模型驗收：** 在既有控制服務與 launcher 測試中注入：准入後 SDK 查詢失敗、單一會話匯出失敗、關閉 OpenCode 失敗及 abort 失敗；檢查仍保存可取得的記錄，並保留原始錯誤與清理錯誤。另以同一訊息「先有 usage、後被中止歸零」及 usage 缺失的樣例，確認已知消耗不倒退、不重複計算，完整性標記正確。

**本次不做：** 進程被強制殺死後的崩潰恢復、完整事件重放、自動重跑、供應商帳單對帳或所有失敗路徑的完整會話匯出。最低回歸通過即可結束本項，不以完善這些能力阻擋首題測試。本項已與第 10.1 節整合並完成以下驗證。


**整合結果（2026-10-23）：** 已將兩份隔離工作區的修補整合回主工作區；保留主工作區最新指令與設計內容，未覆蓋為隔離工作區的舊副本。此處記錄整合驗證時的狀態。

- 控制服務以 SDK session/message ID 保存已觀察用量，同訊息不重複累加，中止歸零或缺失不抹除已知消耗；缺失、讀取失敗與身份異常標為不完整。預算觀察與已綁定會話匯出共用用量快照。SDK 列舉但未綁定的子會話只合計可取得的匯出用量，不授予角色或工具權限。
- launcher 正常與異常退出共用收尾：各會話查詢、關閉及文件寫入分別捕獲錯誤，保留原始與後續錯誤；缺失資料不冒充空訊息或 idle，寫出的資料沿用憑據清理。abort 逐會話記錄實際結果，失敗不聲稱成功。
- 原始失敗與隔離工作區定向修補記錄保留於 [證據保存回歸記錄](../../gates/c-binding-probe-20261023/failure-evidence-regression.log)，此歷史記錄不代替下面的主工作區整合驗證。

| 主工作區整合驗證 | 實際結果 |
| --- | --- |
| 版本／條件 | 基線 `9fb3e01d1c72a25faf597e9546b0c9c032617af1` 加本次未提交修補；Node 26.3.0、npm 11.16.0、Vitest 2.1.9；SDK 替身、虛構憑據與本地 RPC，無真實模型／provider 呼叫 |
| 定向回歸 | `npx --no-install vitest run tests/contract/control-service.test.ts tests/contract/launch-evidence.test.ts tests/contract/run-prep.test.ts`：3 個文件，42／42 通過 |
| 類型與構建 | `npm run typecheck`、`npm run build` 均退出 0 |
| 全套回歸 | `npm test`：33 個文件，223／223 通過 |

**限制與收口：** 此次證明控制准入與異常記錄的確定性行為，不證明真實模型解題能力或真實 provider 的失敗路徑。從未取得的 usage 無法還原；磁碟不可寫時如實失敗，不保證保存成功。兩份實現 plan 的結論已轉入本文並移除；回歸測試源碼與最小失敗證據保留，臨時構建及調試產物清理。token 預留、完整恢復系統與 G 待驗證接口均不在此次修補內。

D第三接口已接入：Verifier的package.prepare在本次work準備固定材料，job.run綁定本次preparation及execution。宿主記錄實際命令、端點hash及真實輸出；持續完整性與未聲明依賴保持unknown，不能提升為verified。具體決策、主區回歸與限制以D詳細design§5為準。
