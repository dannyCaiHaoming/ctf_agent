# design v1 C 詳細 design：控制服務、插件接線與會話綁定

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 2 節 C（含 C.1）與 H 的詳細 design 子文件；控制服務、插件接線、會話身份綁定、逐次預算准入與角色能力落地以本文為準。**已定稿（2026-10-23）：採用原生 `task` 分支**。第 3 節的綁定機制已經無模型探針驗證（第 8 節），可從本文生成實現 plan。本文只定義設計，不構成執行授權；探針只驗證時序、權限與計量接線，不驗證多 Agent 協作效果或 provider 計費精度。

**前提：** [入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）已定：一次 run 由 `apps/launcher` 經 `startManagedOpenCode` 啟動 `opencode serve`，用 SDK 建立 Coordinator 根會話並送出一則啟動訊息；控制服務在 launcher 進程內，與 OpenCode 進程分開；權限不得使用 `ask`。[A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md) 已定：產品角色與 Skill 經配置目錄副本載入。

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

**可信事實的來源：**

| 事實 | 來源 | 不採信的來源 |
| --- | --- | --- |
| 會話 ID | hook input 的 `sessionID`（由 OpenCode 提供） | 工具參數、模型輸出 |
| 實際角色 | SDK `session.get` 的 `agent`，與 hook input 的 `agent` 交叉核對 | `task` 工具參數、模型自稱 |
| 父子關係 | SDK `session.get` 的 `parentID` | 模型提供的任何 ID |

**根會話（已確定）：** launcher 用 SDK 建立根會話，在送出啟動訊息前取得其 ID，立即在綁定表登記為 `coordinator`、本次 run、全部授權範圍。根會話在第一次模型請求前即已綁定，不屬未知數。

**子會話（已驗證，第 8 節 V1–V5）：**

1. **分派登記**：已綁定會話調用原生 `task` 時，插件在 `tool.execute.before` 把 `{sessionID, callID, args.subagent_type, args.task_id}` 送給控制服務。控制服務檢查：
   - 該會話的角色是否允許分派該 `subagent_type`（第 5 節分派表）；
   - 若帶 `task_id`，它必須是同一父會話先前分派、同一角色、仍有效的子會話；否則拒絕。
   
   通過後登記一筆待綁定分派 `{父會話, callID, subagent_type}`。**同一父會話對同一角色同時只允許一筆未消費的待綁定分派**：已有一筆待綁定時，同角色的第二個 `task` 在 `tool.execute.before` 被拒，Coordinator 可在前一個子會話綁定後再分派。理由：待綁定分派按「父會話 + 角色」匹配，同角色並行時無法分辨哪個子會話對應哪個任務；身份與權限不會錯，但任務各自的工作區或 scope 會對調（探針未覆蓋此情形）。不同角色的並行分派不受限制（V6 已驗證）。
2. **首次綁定**：任何 hook 帶有未知的 `sessionID` 時，控制服務以 SDK `session.get` 取得 `parentID` 與 `agent`。僅當 `parentID` 是本次 run 已綁定且未撤銷的會話，且該父會話有一筆 `subagent_type` 與 `agent` 相同、尚未消費的待綁定分派時，才綁定並消費該分派；否則拒絕。
3. **綁定內容**：會話 ID、角色、父會話、run、題目 scope、工作區、到期時間。角色決定能力（第 5 節），不能由後續任何參數改變。
4. **未綁定的會話**：所有 hook 拒絕，因此不能發出模型請求、不能執行任何工具。子會話的第一個非 `event` hook 是 `chat.message`，綁定在其中完成；首次查詢 SDK 約 40–50 毫秒。
5. **審計關聯**：`task` 的 `tool.execute.after` 輸出 `metadata` 含 `sessionId` 與 `parentSessionId`，用來把 `callID` 與實際子會話對應並寫入證據。
6. **`task_id` 恢復**：帶合法 `task_id`（同一父會話先前分派、同一角色、仍有效）時，OpenCode 恢復同一會話並以原角色運行，已綁定的會話不再消費待綁定分派（探針 S3c）。

## 4. 預算准入與計量

| 項目 | 做法 |
| --- | --- |
| 准入點 | 插件在 `chat.params` 向控制服務請求一次模型調用准入；拒絕時拋錯，該次模型請求不發出 |
| 拒絕訊息 | 使用固定文字（例如 `budget denied`），不得含 OpenCode 判為可重試的字樣：探針中含 `exhausted` 的拒絕使 OpenCode 對同一請求退避重試約 6 次、拖過時限。重試不會超支（每次重試都重新申請准入並被拒、不扣額度），但會延遲停止 |
| 帳本 | 每個 run 一份，所有會話共用；准入時扣減可用模型調用次數，並按剩餘 token 預算給出本次 `maxOutputTokens` 上限。控制服務單線程處理，並行子會話不會重複花用同一份額度 |
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

**首版能力表**：工具名稱以現有或已規劃者為準；尚未存在的受管工具標明所屬章節，不在本文定義其參數。

| H 能力 | 首版工具 | 授予角色 | 執行時檢查 |
| --- | --- | --- | --- |
| 知識讀取 | 原生 `skill`；原生 `read`（限本次 run 的 Skill 副本與共用知識目錄） | 全部角色 | `read` 路徑解析 realpath 後必須位於允許根目錄內 |
| 任務分派／交接 | 原生 `task` | `coordinator` | 第 3 節分派登記 |
| 任務狀態讀取 | 受管工具（待定） | 全部角色 | 只返回本 run、本角色可見的狀態 |
| 工作區讀寫 | 受管 `workspace.*`（待 G） | Intake、Recon、Domain Solver、Engineer、Verifier（獨立工作區） | 路徑限於該會話綁定的工作區；原始材料唯讀 |
| 實驗與作業控制 | 受管 `http.request`、`job.run` 等（待 G） | Recon、Domain Solver；Engineer 僅本地；Verifier 僅按驗證模式授予 | scope、句柄綁定題目與會話、資源上限 |
| 題目接入 | 受管接入工具（待 E） | Intake | 來源固定於運行配置 |
| 產物發布／候選登記 | 受管工具（待 D） | Domain Solver、Engineer | 只產生未驗證候選 |
| 驗證結果登記 | 受管工具（待 D） | Verifier | 只接受綁定為 Verifier 的會話 |
| 平台操作請求 | 受管工具（待 D、E） | Coordinator | 由控制服務檢查驗證有效性後執行 |
| 任務停止 | 受管工具（待定） | Coordinator | 只能停止自己分派的子會話 |

Reference、Strategy、Recovery Critic 只有知識讀取與狀態讀取（design v1 H 的「不授予」欄全部保留）。角色合併只能在分派時由控制服務明確綁定，不允許 Agent 自稱兼任取得權限。

**Verifier 獨立性**：Verifier 由 Coordinator 經 `task` 分派，以獨立會話運行；它的上下文只含分派時傳入的內容與經授權讀取的固定證據，不繼承 Solver 的推理上下文（第 8 節 V7 驗證）。

## 6. 停止、撤銷與到期

- **全局停止**（時限、預算、Coordinator 結束後的收尾）：控制服務以 SDK 遞迴列舉根會話的全部子會話，逐一 `session.abort`，並在綁定表標記為已停止；之後這些會話的任何 hook 一律拒絕。
- **單一子會話撤銷**：Coordinator 經「任務停止」能力請求，控制服務只允許停止其分派的子會話。
- **到期**：綁定帶到期時間；到期後的 hook 一律拒絕。
- 停止順序：先在綁定表標記，再發 abort，使在途的工具調用在下一個 hook 即被拒絕。

## 7. 綁定機制不成立時的去向

沿用 design v1 C.1 的三個分支。**驗證結果：採用第一個分支**；SDK 分支的原語（先建立、綁定、再執行、可隔離）已在探針中成立，作為備案保留，不實作。

| 第 8 節驗證結果 | 去向 |
| --- | --- |
| 子會話在第一次模型請求與工具操作前可被綁定，且 V2–V9 成立 | 採用原生 `task`，即本文第 3 節機制 |
| 原生 `task` 不滿足時序，但 SDK 能「先建立會話、綁定、再執行」並可隔離與取消 | 改為有界 SDK 接線：由 Coordinator 調用受管分派工具，控制服務經 SDK 建立子會話、完成綁定後才送出任務；決策仍由 Agent 作出，模型與工具循環仍由 OpenCode 執行 |
| 兩者都不成立 | 列為架構阻塞，報告缺失接口與可選的產品範圍調整；不自寫 provider 循環、不維護 fork |

## 8. 已驗證的前提

2026-10-23 無模型探針：真實 OpenCode 1.19.3、本地確定性替身 provider、token 0，經 `startManagedOpenCode` 同一隔離環境啟動 `opencode serve`，根會話由 SDK 建立並先綁定，載入只記錄並按控制服務回覆放行／拒絕的探針插件，綁定器按第 3 節機制最小照寫。報告見 [`docs/gates/c-binding-probe-20261023/REPORT.md`](../../gates/c-binding-probe-20261023/REPORT.md)。

| # | 結論 |
| --- | --- |
| V1 綁定時序 | 成立。子會話的第一個非 `event` hook 為 `chat.message`，帶子會話 ID；此時 SDK `session.get` 已返回正確的 `parentID` 與 `agent`；綁定早於該子會話的 `chat.params` 准入，准入早於其第一個模型請求；第一次工具操作的 `tool.execute.before` 在綁定之後 |
| V2 角色不可冒充 | 成立。模型以參數自稱其他角色時綁定不變；hook 的 `agent` 與 SDK 返回一致；不在分派表內的分派被拒且不產生子會話。保留：越權 `task` 被可見性層先攔，執行許可層未被單獨觸發 |
| V3 `task_id` 不可劫持 | 成立。他人或外來會話的 `task_id` 均在 `tool.execute.before` 被拒，目標會話其後無請求。合法 `task_id` 恢復同一會話（見第 3 節第 6 點） |
| V4 未分派會話被阻止 | 成立。經 SDK 直接建立、未經分派的子會話第一個 hook 即被拒，零請求、零工具執行 |
| V5 停止、撤銷、到期 | 成立。先標記後 abort 後無新請求、在途工具未執行；撤銷或到期後該會話的工具與模型調用均被拒 |
| V6 不重複花用 | 成立。不同角色並行子會話共用帳本，准入總數等於額度，模型請求數等於准入數 |
| V7 上下文隔離 | 成立。子會話請求均不含父會話私有內容，SDK 先建的會話同樣成立 |
| V8 用量歸屬 | 正常結束時成立，遞迴列舉的全部會話 usage 合計等於 provider 回報；停止路徑偏低（見第 4 節） |
| V9 hook 覆蓋 | 成立。`chat.message`、`chat.params`、`chat.headers`、`tool.execute.before`、`tool.execute.after` 對根會話與子會話、對原生 `read`、`task` 都觸發；本文機制只依賴非實驗接口。`experimental.chat.messages.transform` 的 input 不含 `sessionID`，不能按會話判斷 |
| SDK 分支原語 | 成立：先建立後零活動、綁定後受閘門控制、abort 後無活動、建立時的會話權限生效且上下文隔離 |
| 無未准入請求 | 成立：每個模型請求之前都有同會話的准入；前提是內建 `title`、`summary`、`compaction` agent 已停用 |
| `permission.ask` | 全部運行未觸發；被拒的權限由 OpenCode 直接報錯 |

探針未覆蓋、實作時以定向測試補上的項目：

- 角色可見性設定出錯時，執行許可層對越權 `task` 與其他工具的攔截；
- 載入產品插件後原生 `skill` 的 hook 覆蓋（`skill` 本身已在未載入插件的運行中驗證可用，見 [A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md) 第 5 節）；
- 同角色第二筆待綁定分派被拒（第 3 節第 1 點新規則）；
- 若日後啟用內建 `title`／`summary`／`compaction` agent，其模型請求是否經 `chat.params` 准入。

## 9. 與現有代碼的關係

- `packages/opencode-bridge` 的 `OpenCodeBridgeRpcServer`（loopback、Bearer 憑據、`/tool` 與 `/control`）與 `apps/opencode-plugin` 現有的 `tool.execute.before`、`chat.params` 轉發，是本文接線的起點；現行實作只認單一綁定會話，需改為按綁定表處理多會話，是否沿用原檔案在實現時判斷。
- `packages/supervisor` 的 `responsibilities`、`candidate-control`、`candidate-verification`、`long-job-watch` 等保留模組，按 design v1 D 接到控制服務；是否沿用其現有介面在 D 的實現時判斷，不以保留現有類別為前提。
- 現行插件的 `experimental.chat.messages.transform`／`experimental.chat.system.transform` 轉發只服務已退場的單一 Solver 入口；本文機制不依賴實驗接口（V9），實作時移除這兩個轉發。
