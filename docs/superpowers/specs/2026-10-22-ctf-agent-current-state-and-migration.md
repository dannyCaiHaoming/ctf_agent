# CTF Agent 現狀、教訓與遷移記錄

記錄日期：2026-10-22（Asia/Tokyo）。

本文是 [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 的配套工程記錄：記錄 design v1 寫成時的程式現狀、與設計的偏離、已有成果與教訓、清理方向及開發指令的收斂對照。它不是設計依據；設計以 design v1 為準，本文只說明「從哪裡來、離目標多遠、清理時怎麼判斷」。本文不構成任何執行授權。

所列程式位置與行為是撰寫時的靜態觀察，其他會話仍可能修改未提交程式；正式實施前需重新核對基線。

## 1. 清理方向

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

現有規則與精簡方向的衝突集中在倉庫根目錄開發用 `AGENTS.md`：「設計與當前範圍」一節把舊 M1/M1B 軌跡凍結為「保留代碼和證據」，「驗證與結果」一節要求相關變更後運行 `gate:m0`／`gate:m1` 並沿用 `docs/gates/` 存放真實運行證據，「常用命令」也列出這兩個 gate。這些條文應在獲准實施清理時於同一變更內修改（對照見第 5 節），不能據舊規則把已否定的包袱留下，也不能藉清理恢復凍結的開發工作。

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

`packages/reference` 已有離線檢索實作，歷史領域方法資產也保留，但未接入目前 Web 入口。先按精簡目標判斷其是否有必要：原生能力已足夠或沒有明確用途的部分可刪除，有用知識可提取為文檔，不恢復凍結軌跡。

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

## 4. 已有成果與教訓

以下是舊記錄的摘要，本次未重跑，也不表示清理後原入口仍然可用。保存的是能力證據的範圍與工程判斷，不加入題目解法或源碼材料。

| 歷史內容 | 應保留的結論與對新設計的作用 |
| --- | --- |
| MFW 單題取得候選、獨立重放和權威整題接受 | 曾有一條真實自主單題鏈路；不能推導完整多 Agent、瀏覽器、Skill 效果或通用 Web 驗證已完成。是否保留可重驗主張取決於清理時留下的最小證據 |
| 後續 Web 與 Crypto 嘗試未解出 | 附件準備、工具接線或部分行為有效，不等於方法有效或整題成功；失敗不應被文件完成項掩蓋 |
| 長同步請求約 300 秒斷開，後改公開非同步提交與短狀態讀取 | 長模型工作與單個 HTTP 請求生命期分開；保持同一取消和 deadline。後續超過 300 秒未重現只支持此改法，不能證明所有連線問題消失 |
| provider 429／帳號額度耗盡；另曾把預算澄清誤當重跑許可 | 本地預算未耗盡也可能被供應商停止；區分額度、用量未知和真正零用量。後一次誤啟動不能算獲授權驗證，新的 run 需明確授權 |
| 已審核 Web Skill v2 與附屬 Reference | 保留通用方法和適用條件；文件已保存不等於原生按需載入已接通，行為出現也不證明因果效果或成功率 |
| 附件來源／解包、HTTP Cookie 與觀察續讀、候選封存 | 是可復用的能力經驗；按新接口保留必要部分，不為原有類別和包裝保留整套架構 |
| 舊獨立 Web 重放只覆蓋無 Cookie 同源普通 GET | session、POST、多步及其他領域尚無通用驗證證明；不能沿用窄實作宣稱完整 Verifier |
| 大量 fixture／gate／軌跡記錄 | 只能支持各自確定性範圍，不能替代真實解題。移除失去用途的軌跡與驗收儀式，不再用新增框架延後核心能力驗證 |
| 運行復盤與錯誤記錄 | 保留按實際事件區分工具錯誤、目標負向回饋、重複操作、基礎設施／供應商停止及候選結果的能力；避免秘密值與隱藏推理，無需保留所有輸出或舊報告生成層 |
| 舊設計 §12.5 的成功率門檻 | 有可信難度時 easy、medium 各需 `ceil(數量 × 60%)`、`ceil(數量 × 30%)` 解出，難度未知的子集或完全無可信難度時按 `ceil(數量 × 45%)`；缺少實測校準，舊路線圖當時已註明須先以真實基線確認。只作歷史目標，不直接繼承為新驗收線 |

不繼承的內容包括：M0–M6／M1B 六軌跡與 S1–S6 的固定順序、單 Solver 首題入口、題目專屬策略、TSecBench 作必經平台、逐切片審批習慣、全部歷史證據永久保留，以及為維持舊 gate 全綠新增的相容架構。

## 5. 開發指令收斂與歷史來源

開發用 `AGENTS.md`「設計與當前範圍」一節目前仍把下表三份舊文件列為架構依據、階段與驗收依據及當前任務入口。刪除或退役其中任何一份時，必須在同一變更內把 `AGENTS.md` 的對應入口改指向 design v1，不能留下失效鏈接，或讓開發指令繼續以已退役文件為依據。

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
| [舊系統設計](2026-10-14-general-ctf-agent-system-design.md) | 九項責任、OpenCode 邊界、驗證模式、候選有效性、預算／副作用／恢復、工具與資料隔離、ARM64 發布和結果證據 | 指定平台中心、過度服務拆分、完整 schema／gate／階段前置及未校準數字直接當硬門檻 |
| [舊路線圖](../plans/2026-10-16-ctf-agent-mvp-roadmap.md) | 真實能力與確定性檢查的區分、性能門檻需事前校準、避免基礎建設長期阻塞解題 | M0–M6、軌跡進度及舊階段順序 |
| [舊自主首題計劃](../plans/2026-10-20-m1-autonomous-first-challenge-plan.md) | 單題成果的有限證明、非同步請求、附件／會話／候選能力、供應商停止與誤授權教訓，見本文第 4 節 | S1–S6 排程、單 Solver 主線、題目專屬路線、全部 run 記錄永久保存 |

本地主要實作：

- `apps/cli/src/commands/solve.ts`、`solveM1.ts`：產品入口、角色與指令組裝、工具配置。
- `apps/cli/src/commands/openCodeTask.ts`：會話檢查、模型與工具控制。
- `apps/opencode-plugin/src/index.ts`：原生工具攔截與模型 hooks。
- `packages/opencode-bridge/src/server.ts`：固定版本 1.19.3、隔離配置與啟動。
- `apps/cli/src/commands/localHttpCandidateResolver.ts`、`packages/supervisor/src/candidate-verification.ts`：確定性候選處理與驗證上下文。
- `apps/cli/src/main.ts`、`packages/platform/src/index.ts`：目前 CLI 和平台能力。
- `packages/reference/src/index.ts`：已存在的離線知識服務。

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
