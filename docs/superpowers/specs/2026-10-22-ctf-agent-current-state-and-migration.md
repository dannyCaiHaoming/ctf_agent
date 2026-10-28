# CTF Agent 現狀、教訓與遷移記錄

記錄日期：2026-10-28（Asia/Tokyo）。

本文是 [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 的配套工程記錄：記錄 design v1 寫成時的程式現狀、與設計的偏離、已有成果與教訓、清理方向及開發指令的收斂對照。它不是設計依據；設計以 design v1 為準，本文只說明「從哪裡來、離目標多遠、清理時怎麼判斷」。本文不構成任何執行授權。

所列程式位置與行為是撰寫時的靜態觀察，其他會話仍可能修改未提交程式；正式實施前需重新核對基線。

## 0. 當前主線狀態（2026-10-28）

本文現將當前主線與 2026-10-22 的歷史對照分開記錄。以下 main 合併狀態沿用本次已確認基線，工程與行為結論依各子 design 的既有記錄；本次只更新文檔，沒有重新執行 git、建置、測試、模型或靶場。第 1–5 節的原始判斷、約束與歷史結論逐字保留，當中的「目前／本次」按各節標明的歷史日期理解，不作 2026-10-28 的未完成清單。

### 0.1 已落地並合入 main：無模型檢查通過的範圍

| 能力 | 當前接入與已有工程證據 | 證明邊界與依據 |
| --- | --- | --- |
| 產品入口、角色與知識載入（A／B／C） | 由 launcher 啟動 Coordinator，產品指令、角色與 Skill 使用固定配置副本；原生 task 與真實父子會話綁定、角色權限、共享准入及停止已接線 | 不再是 solveM1 單 Solver 入口；不另建模型循環。載入與控制接線不等於模型遵循或協作有效，見 [A／B](2026-10-22-design-v1-ab-product-assets.md)、[入口](2026-10-22-design-v1-entry-local-debug.md)、[C](2026-10-23-design-v1-c-control-service.md) |
| E 取題與 Intake | 清單、題面／附件固定、Intake 唯讀 list／read 與 Coordinator 原生交接已落地合併；第 2–5 節的材料與權限判據已有無模型檢查 | 已運行靶場與直接附件可進題；平台 API adapter 並非全部完成。另有三題真實取題冒煙，但當時被分派的解題角色尚無工具，不能算三題解出，見 [E §7](2026-10-23-design-v1-e-intake-minimal.md#7-實作與驗證記錄) |
| G 解題工具與生命週期 | 題目 assign／unassign、三根工作區、HTTP、受管 job、RPC 等待／取消、原生背景交付及收束已合入；主區 typecheck／build、323 項全套與同入口無模型複跑通過 | 證明工具及控制接線；OS／作業網路隔離、持久總配額及跨重啟恢復仍有限制，見 [G §9.2／§10](2026-10-23-design-v1-g-solver-minimal.md) |
| D 候選 → 獨立驗證 → 可信完成 | 發布、固定包、獨立 Verifier、固定報告與可信完成五接口已接入合併；三層 Verifier 與受限自動嘗試亦已接入，定向 131 項、全套 591 項及 typecheck／build 通過 | 直接核實 → LLM 審閱 → 無法確定時依可信限制嘗試；保留 inconclusive，不把模型意見當裁判。新策略的自然交接與真實裁判接入未驗證，見 [D §5–8.1](2026-10-24-design-v1-d-candidate-verification-minimal.md)、[歷史問題與限制](2026-10-26-design-v1-d-evidence-to-completion.md) |
| 同步分派的可信執行身份 | 同步／背景共用本輪 execution；同步結算、同 child 續接、來源與 artifact／package 發布已修復並合入 main（merge `c120e143`）；原生 scripted 鏈覆蓋 r6 原失敗點，合併後全套 597 項通過 | 不更改顯式 background 值，不開放同步 Verifier，不擴工具／網路權限；Q5 promotion 未實作，見 [執行歸屬 §8](2026-10-25-design-v1-sync-resume-provenance.md#8-r6支持同步任务交付已实现并通过无模型验证promotion-为已知缺口) |
| A+D 收斂：未測線索注入＋有界交回 | 這裡 A、D 是收斂候選編號，並非核心設計 A／D 章節。Coordinator 分派／恢復帶入未測具體線索，Recon／Domain Solver 回報狀態，Critic 對照被忽略線索；角色 prompt 加入有界問題、停止條件及交回後停滯評估。兩片同批合入 main（merge `3ad11f48`，含 `862b85ee`／`6e282fd5`），tsc／build／555 項確定性檢查通過 | 僅角色 prompt，無新工具、接口、schema 或 host 喚醒機制；不忙輪詢，Critic 只建議、Coordinator 決定。裝配通過不證明先測線索或及時交回，見 [線索帳本 §7](2026-10-28-design-v1-b-lead-ledger-convergence.md#7-实现结果20261028候选-a-已落地)、[路線復核 §5.7](2026-10-25-design-v1-negative-evidence-and-route-review.md#57-实现结果20261028候选-d-已落地) |

上述檢查屬不同版本、不同批次的既有結果，不拼接為同一次全鏈驗收，也不是本次重跑結果。不能由「已合併、無模型綠燈」推定真實模型行為改善、完整產品發布或 solved。

### 0.2 真實運行的已知結果：r6 修復與 r7 未解分開記錄

- **既有成功證據不抹除：** 2026-10-24 本地 Docker mfw 第二批曾在同批完成獨立 recompute、可信 local judge accepted 並保存 solved；這只證明該次本地單題鏈路。首批因預算停止，不能與第二批拼接；亦不能替 r5、r6、r7 或 2026-10-28 新策略背書，見 [D §7.2](2026-10-24-design-v1-d-candidate-verification-minimal.md#72-真模型本地整链证据与限制)。
- **r5 保持歷史 inconclusive、無 completion。** 原件直引與 HTTP 來源交接已修復，三層策略不再讓證明不足一律禁止預算內嘗試；五類歷史 blocker 與原報告仍保留，不能追補 verified／solved，見 [D 證據到完成](2026-10-26-design-v1-d-evidence-to-completion.md)。
- **r6 的 artifact.publish 阻塞已修復；r6 本身仍未解出。** 原同步 Recon／Engineer 已綁定卻沒有 execution，11 次發布被拒；缺角色參數的兩次分派是另項正確拒絕。修復前後的原生無模型鏈已覆蓋同步發布、精確 bytes、Engineer 固定包與同 child 續接。原 run 另有 Recon 遲至約 24.8 分鐘才首次發布、30 分鐘 deadline 的效率問題，不被發布修復掩蓋，見 [執行歸屬 §8.1–8.4](2026-10-25-design-v1-sync-resume-provenance.md)。
- **r7 仍未解出，缺口是證據到行動與長程發散。** Recon 已發布具體路線線索，Domain Solver 已有相應操作能力，卻在 78 次 HTTP 中未測該線索，末段約 20 分鐘持續通用搜索；30 分鐘 deadline 到時仍無 Engineer／Verifier／裁判鏈。Recovery Critic 准入 0 次，長子任務未交回使 Coordinator 無 turn 評估停滯。這不能歸成靶場缺答案或 Recon 完全沒給線索；A+D 是此後的收斂修改，未經新真實 run 驗收，見 [路線優先級 §1–2](2026-10-28-design-v1-b-evidence-to-action-route-priority.md)、[路線復核 §5.1／§5.6–5.7](2026-10-25-design-v1-negative-evidence-and-route-review.md)。
- **r8-2（2026-10-29，含 A+D 的 main `60654f0d`）解出 throwback，r7 的失敗未重現。** 約 12 分鐘 `completed`：Domain Solver 確認 Pages SSTI 後**直接** POST `/admin/chal/new`→`/admin/chal/delete`（r7 從未請求的那條路線），回應 200、26-byte flag；完整鏈 Recon→Engineer→Verifier→Coordinator `completion.request`→本機 exact judge `accepted`，host `solved=true`。證據核對：delete 為真實 `ctf_http_request` 工具調用、「未測線索」詞彙在交接中在場。**但這是單題、單次、非受控樣本**——A+D 之外同批還有同步執行身份修復，加上 LLM 跑間方差，不能把解出單獨歸因到 A+D；**D 的 Recovery Critic 准入仍為 0、未觸發換路，故 D 尚未驗證**；Verifier 自身 `inconclusive`，`solved` 由 host exact judge 判定，非 Verifier verified。另 r8（2026-10-28）因 provider 連線錯誤在首次模型回應前中止，無效、不計。見 [路線復核 §5.7](2026-10-25-design-v1-negative-evidence-and-route-review.md#57-实现结果2026-10-28候选-d-已落地)。

### 0.3 仍未驗證／保留的缺口

**真實行為仍待有明確授權的 run。** 同步身份修復在真實模型下的效果、三層 Verifier／受限提交的自然行為，以及 A+D 是否讓 Solver 在通用深挖前先測未測線索、及時交回並由 Critic 提出 redirect，均不能由無模型檢查推定。需要另外明確目標、模型／provider、批次及 token／時間授權；本次文檔整理不授權 r8 或任何重跑，不把規則已寫、清單已注入或 Critic 次數當收益。

**Q5 promotion 是已記錄、現有證據支持在產品自身分派中很可能不可達的缺口，並未實作或證偽。** 若同步完成信封實際帶 `metadata.background===true`，execution 會保留 running、同 child 續接被拒並阻止正常收尾；不誤標 completed，最壞撐到 deadline。r6 長同步任務沒有 promotion，無頭產品也無 TUI／模型轉背景操作，但 OpenCode 核心來源無法在本倉庫靜態排除。維持 [§8.4 的限制與觀察點](2026-10-25-design-v1-sync-resume-provenance.md#84-实现与无模型验证结果2026-10-28)：真實出現該信號時再處理可信終態關聯，不把普通同步完成的通過寫成 Q5 通過，不恢復舊補丁、provider 旁路或 OpenCode fork。

發布鏡像、作業 OS／網路隔離、持久總配額、跨重啟恢復、平台 adapter，以及具體題目才需要的瀏覽器／PTY／TCP，仍按各子 design 的限制與依賴處理，不能由 E／G／D 已接通推成全數完成。Skill 載入與方法收益也分開：r4 曾載入而未解，r7 全 run 無 Skill 調用；路線優先級內容增量仍非已交付收益。這些限制不自動恢復歷史待辦或新增當前交付項。

## 1. 清理方向

**歷史語境（2026-10-22）：** 本節保留當時的清理決定與重建依賴，不代表目前仍停在清理或尚未接入 E／G／D；當前落地狀態見第 0 節。以下清理範圍不是本次文檔整理的刪除授權。

順序：先以 design v1 作為判斷依據，再執行精簡；清理時以 design v1 判斷刪除與保留，清理完成後依真實剩餘能力修訂 design。清理本身是第一個交付，不以保持舊 CLI、測試、gate 或調試入口可運行為前提，也不為維持它們新增相容層。

| 範圍 | 清理方向 |
| --- | --- |
| CLI 與架構程式 | 刪除錯誤職責分配、退役模型循環、過時軌跡專用流程、重複入口及只為舊設計服務的包裝；保留薄啟動、受管執行及控制邊界中確有新架構用途的部分 |
| 測試、fixture、gate | 隨被刪實作移除失去用途的測試、fixture、gate 命令與配置，不為歷史全綠維持已否定架構；仍有用途的測試按保留能力評估 |
| 設計與計劃文檔 | 合併有效決策和仍有用的教訓，移除過時、錯誤、重複或互相矛盾的設計／計劃及無效索引，不把全量舊文檔搬到另一個 archive 假裝精簡 |
| `docs/gates/` 資料 | 優先清除無決策價值的重複輸出、中間產物、日誌、資料庫及失效驗收記錄；只保留仍支撐重要結論或具體排障需要的最少證據 |
| 歷史資產與依賴 | 已有 Reference 服務、驗證服務、方法庫等也須按新架構需要判斷，不因「已存在」自動保留；同步移除無用途依賴與配置 |

實施時先核對引用、依賴與改動歸屬，以決定刪除邊界，而不是以「仍被舊程式引用」作永久保留理由。可連同失效呼叫者一起刪除；交付時如實列出尚未恢復的入口與能力，不把清理階段描述成可發布產品。

有用內容集中整理為少量工程記錄（即本文第 4 節）：已證實的能力、有效方法、關鍵失敗與教訓、仍有價值的證據位置。需要保留可驗證成功主張時，留下最小充分證據；若原始證據被刪除，就將相應記述標成歷史摘要，不能繼續宣稱可原樣重驗。不要求保存所有失敗 run 或整批資料庫。

清理對象不限於已提交內容，但不得把其他會話正在進行的工作一併誤刪；開始實施前明確其歸屬與是否納入清理。倉庫外 run-data、私有 oracle、憑據與使用者原始題目材料不因本節自動納入刪除範圍。

原有規則與精簡方向的衝突集中在倉庫根目錄開發用 `AGENTS.md`：「設計與當前範圍」一節原把舊 M1/M1B 軌跡凍結為「保留代碼和證據」，「驗證與結果」一節原要求運行 `gate:m0`／`gate:m1` 並沿用 `docs/gates/` 存放真實運行證據，「常用命令」也列出這兩個 gate。本次清理已在同一變更內按第 5 節收斂這些條文，不再據舊規則保留已否定的包袱，也不藉清理恢復凍結的開發工作。

### 1.1 重建工作的依賴

以下描述能力依賴，不指定唯一線性順序，也不自動授權任何執行。實施時可以合併互相依賴的修改；普通內部步驟無須逐次請求批准。清理只驗證刪除範圍、保留內容及引用一致性；恢復能力時再做對應的必要測試，不增加一套新的通用 gate 或歷史里程碑。

| 重建工作 | 必要依賴與完成證據 |
| --- | --- |
| 產品文檔與載入 | 角色、開發／產品指令分離、Skills／References 及受控路徑；無模型核對發現與讀取，與 Docker 目錄布局一起設計 |
| 多 Agent 控制接線 | 公開 OpenCode 接口能識別真實父子會話，及時綁定權限／共享預算；此可行性影響協作實作，不能用假的 session 記錄通過 |
| 取題能力 | 統一必要輸入與來源邊界；直接靶場和離線附件不依賴平台 adapter。平台來源按需求加入，無須成為所有發布工作的前置 |
| 做題與驗證能力 | 依已接通工具和會話組織角色，保留同一 Agent 修錯、反證換路、候選封存與獨立驗證；可連同相關工具一起完成，不強拆成機械流水線 |
| Docker 發布環境 | 從布局與依賴選擇起納入重建；可與工具接線同步完善，不等平台 API 做完才補容器。最後驗證乾淨啟動、ARM64、持久化和邊界 |
| 真實能力驗證 | 依可用產品能力、明確批次和 token 授權選題；覆蓋真實使用鏈路，不因無模型檢查通過自動開始，也不要求把所有可選功能完成才准驗證 |

## 2. 靜態對照結論（v1.19.3 源碼，未運行）

**以下是 2026-10-22 退役入口的原始靜態對照，逐字保留，不是當前接法。** 本節的「目前／現有」只指當時版本；當前入口為 launcher＋Coordinator、固定產品資產副本與按角色受控的原生／自訂工具，見第 0.1 節。固定版本的原生能力判斷與當時未運行的證明邊界仍保留。

本節依據當時程式、產品需求、官方文件及 OpenCode **v1.19.3 標籤原始碼**作靜態對照，沒有啟動 OpenCode、模型、測試或靶場。來源能力不等於本產品運行時已驗證可用。

主要問題不是 OpenCode 缺少 Agent／Skill／Reference 能力，而是目前產品接線把其中多項能力關閉或繞過。現有程式確實使用 OpenCode 的模型與工具循環，但產品入口仍是單一 Solver、硬編碼指令及宿主直接執行候選處理，尚未形成完整多 Agent 架構。

| 項目 | 原生機制 | 目前接法 |
| --- | --- | --- |
| Agent 定義 | 解析 `agents/*.md` 的設定與正文 | `solveM1.ts` 組裝 `ctf-solver` 並覆寫 prompt |
| 多 Agent | `task` 建立子會話、指定 Agent、取得結果 | `task` 未開放，宿主只綁定一個 Solver 會話 |
| 運行指令 | `AGENTS.md` 或明確配置的 instruction 文件 | 缺產品運行文件，多段指令寫在程式內 |
| Skill | 發現資訊，經原生 `skill` 按需載入正文 | 宿主讀 Web Skill，全文塞入初始輸入 |
| Skill 附屬 Reference | `skill` 返回基準目錄和部分附屬文件路徑，正文再按需讀取 | 文件留在倉庫，受管工作區讀取工具不可達 |
| 原生 `references` | 配置本地目錄與說明，供 Agent 查閱 | 啟動配置未接入 |
| 工具邊界 | 原生權限與插件共同約束 | 插件拒絕全部非自訂 CTF 工具，包括 `skill`、`read`、`task` |

兩項更正：不能把複製 Reference 當成完成接入；也不能把 `OPENCODE_DISABLE_EXTERNAL_SKILLS` 解釋成禁用所有原生 Skill。固定版本仍會掃描受控配置目錄和 `skills.paths`。目前 Web Skill 缺原生 metadata，直接搬入目錄仍不足。

## 3. 與 design v1 的偏離

**第 3.1–3.9 節保留 2026-10-22 的偏離診斷及對應方案。** 「尚未接入／未開放／待驗證」是當時狀態；目前已落地與仍有限制的對照見第 3.10 節，不將舊診斷當作未完成清單。

### 3.1 單一 Solver 取代產品入口

`apps/cli/src/commands/solve.ts` 直接進入 `solveM1.ts`；後者建立 `task_solver`，標記 `strategy + domain_solver`，預設 `ctf-solver`。這是首題切片，不是完整產品。Coordinator、Intake/Triage、Recon 等尚未以產品 Agent 形式接入，責任標籤不能替代實際角色工作。

### 3.2 Agent 行為混入宿主程式

`solveM1.ts` 存在硬編碼 Agent prompt、任務指令及 Web Skill 預載；配置提供的 Solver prompt 也會被覆寫。職責、方法選擇、協作及交付指令應遷到產品文件；題目入口、oracle 狀態、預算等可信動態事實仍由宿主提供。

### 3.3 產品 AGENTS.md 缺位

目前只有倉庫開發用 `AGENTS.md`。啟動器隔離 HOME／配置目錄並禁用 project config，有保護作用；沒有開發指令誤載的直接證據。應增加可信產品指令入口，不能為了載入文件撤掉隔離、任由開發倉庫或題目附件被掃描。

### 3.4 原生工具遭全面攔截

`apps/opencode-plugin/src/index.ts` 的 `tool.execute.before` 只接受自訂 CTF 工具，即使配置開啟 `skill` 或 `task` 仍會被拒絕。需改為按角色與能力允許必要原生／自訂工具，保留 scope、憑據與證據邊界。

### 3.5 子會話身份與資源未接通

`OpenCodeTask.control` 只接受最初綁定的 session ID；工具回呼集中到同一 task 物件。原生子會話需綁定真實 session、task、角色、工作區和共享預算，不能相信模型自報身份。

### 3.6 服務鏈路尚非多 Agent 協作

`localHttpCandidateResolver.ts` 已有候選封存、獨立 GET 重放和 oracle 控制，可作精簡時的能力參考，不要求保留原檔案或原包裝。重放腳本仍由程式產生，`candidate-verification.ts` 的驗證 session ID 是程式建立的記錄，提交由 `Coordinator` 程式類別發起；這不代表 Engineer、Verifier、Coordinator 的 OpenCode Agent 會話已存在。

### 3.7 取題入口未接入

CLI 目前直接接收 target 和 materials；平台服務主要是 local oracle 提交，缺發布後由 Intake/Triage 使用的平台接題入口。不能讓 Solver 猜平台操作填補缺口。

### 3.8 環境及工具仍屬切片能力

通用 Web 路徑只開放附件讀取、HTTP、觀察續讀和候選登記，未開放腳本建立／執行及瀏覽器；Misc／Crypto 完整產品入口未接通。非歷史區域未找到 Dockerfile 或鏡像構建入口；啟動依賴宿主 OpenCode binary 與現有 `node_modules`。

`packages/reference` 已有離線檢索實作，歷史領域方法資產也保留，但未接入目前 Web 入口（`packages/reference` 與領域方法資產已於 2026-10-22 精簡中刪除）。先按精簡目標判斷其是否有必要：原生能力已足夠或沒有明確用途的部分可刪除，有用知識可提取為文檔，不恢復凍結軌跡。

### 3.9 偏離與 design v1 方案的對應

| 偏離 | 承接方案（design v1 第 2 節） | 覆蓋情況 |
| --- | --- | --- |
| 3.1 單一 Solver 取代產品入口 | A（Coordinator 作 primary）、C（原生多 Agent）、E（統一做題入口） | 已覆蓋 |
| 3.2 Agent 行為混入宿主程式 | A（指令遷到產品文件）、B（移除 Skill 全文預載） | 已覆蓋 |
| 3.3 產品 AGENTS.md 缺位 | A | 已覆蓋 |
| 3.4 原生工具遭全面攔截 | B（原生知識載入）、C（會話綁定）、H（接口及角色權限） | 設計方向已覆蓋；原生權限與插件的實際執行點待驗證 |
| 3.5 子會話身份與資源未接通 | C | 已覆蓋，可行性待無模型驗證 |
| 3.6 服務鏈路尚非多 Agent 協作 | D | 已覆蓋 |
| 3.7 取題入口未接入 | E | 已覆蓋 |
| 3.8 環境及工具仍屬切片能力 | F（Docker）、G（工具集與領域入口）、H（可調用能力），另由 B 承接知識服務去留 | 工具方向及邊界已補入；具體工具版本、ARM64 可用性與執行隔離仍待實作驗證 |

### 3.10 偏離的當前去向（2026-10-28）

| 歷史偏離 | 當前主線 |
| --- | --- |
| 3.1–3.3 單 Solver、硬編碼指令、產品指令缺位 | 入口與 A／B 已由固定產品文件及 Coordinator 原生分派承接；舊 solveM1 路線不是當前架構依據 |
| 3.4–3.5 工具攔截、子會話身份未接通 | C／G 已接通角色可見性與宿主核准、真實父子會話、題目／工作區及共享預算；同步 execution 增量已合入，Q5 限制另列第 0.3 節 |
| 3.6 候選處理不等於多 Agent | D 五接口及獨立 Verifier 已接通；最新三層策略無模型通過，真實行為仍待驗證，不沿用舊「必須 verified 才能提交」前置 |
| 3.7 取題缺位 | E 最小接入與 Intake 唯讀工具已合併；平台 adapter 仍依具體來源需要，不能讓 Solver 猜平台操作 |
| 3.8 工具與環境只屬切片 | G 文件／HTTP／job 已合併，不再只有附件讀取與候選登記；發布環境與隔離等限制依 G §10 保留。舊 packages/reference 不恢復，知識載入沿用固定 Skill／Reference |

## 4. 已有成果與教訓

**本節以下保留 2026-10-22 的成果摘要、證據留存狀態與教訓。** 新入口的取題、mfw 整鏈以及 r5／r6／r7 結果已分別補在第 0 節，不能用任何一批成功抵銷另一批失敗。

以下是舊記錄的摘要，本次未重跑，也不表示清理後原入口仍然可用。保存的是能力證據的範圍與工程判斷，不加入題目解法或源碼材料。標註「歷史摘要」者，其原始證據（`docs/gates/` 運行輸出、舊 spec／plan）已於 2026-10-22 精簡中刪除，不再可原樣重驗；未標註者所依據的代碼與測試仍在倉庫中。

| 歷史內容 | 應保留的結論與對新設計的作用 |
| --- | --- |
| MFW 單題取得候選、獨立重放和權威整題接受（歷史摘要；其餘原始 run 輸出已刪除，保留的最小證據為 `docs/gates/m1-autonomous-first-challenge/task-a-20261021-mfw/result.md`） | 曾有一條真實自主單題鏈路；不能推導完整多 Agent、瀏覽器、Skill 效果或通用 Web 驗證已完成。是否保留可重驗主張取決於清理時留下的最小證據 |
| 後續 Web 與 Crypto 嘗試未解出（歷史摘要） | 附件準備、工具接線或部分行為有效，不等於方法有效或整題成功；失敗不應被文件完成項掩蓋 |
| 長同步請求約 300 秒斷開，後改公開非同步提交與短狀態讀取（歷史摘要） | 長模型工作與單個 HTTP 請求生命期分開；保持同一取消和 deadline。後續超過 300 秒未重現只支持此改法，不能證明所有連線問題消失 |
| provider 429／帳號額度耗盡；另曾把預算澄清誤當重跑許可（歷史摘要） | 本地預算未耗盡也可能被供應商停止；區分額度、用量未知和真正零用量。後一次誤啟動不能算獲授權驗證，新的 run 需明確授權 |
| 已審核 Web Skill v2 與附屬 Reference（審核與離線對照證據為歷史摘要；Skill 文件保留於 `skills/`） | 保留通用方法和適用條件；文件已保存不等於原生按需載入已接通，行為出現也不證明因果效果或成功率 |
| 附件來源／解包、HTTP Cookie 與觀察續讀、候選封存 | 是可復用的能力經驗；按新接口保留必要部分，不為原有類別和包裝保留整套架構 |
| 舊獨立 Web 重放只覆蓋無 Cookie 同源普通 GET | session、POST、多步及其他領域尚無通用驗證證明；不能沿用窄實作宣稱完整 Verifier |
| 大量 fixture／gate／軌跡記錄（歷史摘要） | 只能支持各自確定性範圍，不能替代真實解題。移除失去用途的軌跡與驗收儀式，不再用新增框架延後核心能力驗證 |
| 運行復盤與錯誤記錄（樣本輸出為歷史摘要） | 保留按實際事件區分工具錯誤、目標負向回饋、重複操作、基礎設施／供應商停止及候選結果的能力；避免秘密值與隱藏推理，無需保留所有輸出或舊報告生成層 |
| 舊設計 §12.5 的成功率門檻（歷史摘要；原設計文件已刪除） | 有可信難度時 easy、medium 各需 `ceil(數量 × 60%)`、`ceil(數量 × 30%)` 解出，難度未知的子集或完全無可信難度時按 `ceil(數量 × 45%)`；缺少實測校準，舊路線圖當時已註明須先以真實基線確認。只作歷史目標，不直接繼承為新驗收線 |

不繼承的內容包括：M0–M6／M1B 六軌跡與 S1–S6 的固定順序、單 Solver 首題入口、題目專屬策略、TSecBench 作必經平台、逐切片審批習慣、全部歷史證據永久保留，以及為維持舊 gate 全綠新增的相容架構。

## 5. 開發指令收斂與歷史來源

**本節記錄 2026-10-22 已執行的指令收斂及歷史來源，不是本次對 AGENTS.md 或其他文檔的新改動。** 原決定與約束保留；目前入口與責任位置另補如下。

開發用 `AGENTS.md`「設計與當前範圍」一節原把下表三份舊文件列為架構依據、階段與驗收依據及當前任務入口。本次清理已在同一變更內把這些入口改指向 design v1 與本文，並刪除三份舊文件；此後刪除或退役任一依據文件時，須在同一變更內更新 `AGENTS.md` 的對應入口，不能留下失效鏈接，或讓開發指令繼續以已退役文件為依據。

產品運行約定最終歸入產品 `AGENTS.md`（design v1 的 1.2、A），開發用 `AGENTS.md` 只保留倉庫開發所需規矩，兩者不重複全文：

| 開發用 `AGENTS.md` 一節 | 處理方式 | 依據 |
| --- | --- | --- |
| 設計與當前範圍 | 改寫：入口指向 design v1；舊 M1/M1B 凍結與「保留代碼和證據」改為按本文第 1 節精簡 | 本文第 1 節 |
| 架構與職責 | 改寫：由單 Solver 控制層改述為 OpenCode 原生多 Agent 加薄控制層；「候選驗證和權威提交復用現有控制層」改為保留能力而非保留現有實作 | design v1 的 1.2、C、D |
| 開發方式 | 基本保留；「優先復用現有實現」需補上精簡期可刪除已否定架構的例外 | 本文第 1 節 |
| 驗證與結果 | 改寫：移除 `gate:m0`／`gate:m1` 硬性要求與 `docs/gates/` 沿用規則；`solved` 判定和驗證陳述分層由 design v1 取代，開發指令只引用不複述 | design v1 的 1.3、1.6；本文 1.1 |
| 授權與停止 | 保留，與 design v1 一致 | — |
| 工作區與運行邊界 | 拆分：倉庫工作區規矩保留；Solver scope、`control_secret`、禁用公共搜尋、運行中不裝依賴等產品運行約定移入產品 `AGENTS.md` | design v1 的 1.5 |
| 常用命令 | 清理後按實際剩餘腳本更新，刪除已不存在的 gate 命令 | 本文第 1 節 |

| 歷史來源 | design v1 已承接的內容 | 不再繼承的部分 |
| --- | --- | --- |
| 2026-10-14-general-ctf-agent-system-design.md（已刪除） | 九項責任、OpenCode 邊界、驗證模式、候選有效性、預算／副作用／恢復、工具與資料隔離、ARM64 發布和結果證據 | 指定平台中心、過度服務拆分、完整 schema／gate／階段前置及未校準數字直接當硬門檻 |
| 2026-10-16-ctf-agent-mvp-roadmap.md（已刪除） | 真實能力與確定性檢查的區分、性能門檻需事前校準、避免基礎建設長期阻塞解題 | M0–M6、軌跡進度及舊階段順序 |
| 2026-10-20-m1-autonomous-first-challenge-plan.md（已刪除） | 單題成果的有限證明、非同步請求、附件／會話／候選能力、供應商停止與誤授權教訓，見本文第 4 節 | S1–S6 排程、單 Solver 主線、題目專屬路線、全部 run 記錄永久保存 |

當前主要責任位置（依上述子 design 記錄；本次未改程式）：

- `apps/launcher`：產品啟動、run 準備、控制服務與 RPC；`challenges.ts`／`run-prep.ts`／`intake-tools.ts` 承接 E。
- `apps/launcher/src/control-service.ts` 與 `workspace-tools.ts`／`http-tools.ts`／`job-tools.ts`：身份、題目、執行與 G 受管能力；`verification-results.ts`／`completion-tools.ts` 等承接 D 記錄與可信完成。
- `apps/opencode-plugin`：公開 hooks／受管工具接線；`product/AGENTS.md`、`product/opencode/agents/`、`product/skills/`：產品約定、角色與按需方法。A+D 收斂落在角色 prompt，沒有另建線索 registry 或調度器。

**下列「本地主要實作」是 2026-10-22 原始位置清單，逐字保留供歷史追蹤；不是當前可運行入口或檔案仍存在的承諾。**

本地主要實作：

- `apps/cli/src/commands/solve.ts`、`solveM1.ts`：產品入口、角色與指令組裝、工具配置。
- `apps/cli/src/commands/openCodeTask.ts`：會話檢查、模型與工具控制。
- `apps/opencode-plugin/src/index.ts`：原生工具攔截與模型 hooks。
- `packages/opencode-bridge/src/server.ts`：固定版本 1.19.3、隔離配置與啟動。
- `apps/cli/src/commands/localHttpCandidateResolver.ts`、`packages/supervisor/src/candidate-verification.ts`：確定性候選處理與驗證上下文。
- `apps/cli/src/main.ts`、`packages/platform/src/index.ts`：目前 CLI 和平台能力。
- `packages/reference/src/index.ts`：已存在的離線知識服務（已於 2026-10-22 精簡中刪除）。

官方文件與固定版本原始碼（僅為開發期設計對照時的查閱位置，不是產品運行依賴；正式做題仍按 design v1 的 1.5 不聯網查閱）：

- [Agent 官方文件](https://opencode.ai/docs/agents/)
- [Skill 官方文件](https://opencode.ai/docs/skills/)
- [References 官方文件](https://opencode.ai/docs/references/)
- [Rules 官方文件](https://opencode.ai/docs/rules/)
- [v1.19.3 Agent Markdown 載入](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/config/agent.ts)
- [v1.19.3 Task 工具](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/tool/task.ts)
- [v1.19.3 指令載入](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/session/instruction.ts)
- [v1.19.3 Skill 發現](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/skill/index.ts)
- [v1.19.3 Skill 工具](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/tool/skill.ts)
- [v1.19.3 Agent 權限及 Reference 目錄](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/agent/agent.ts)
- [v1.19.3 配置載入](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/config/config.ts)
