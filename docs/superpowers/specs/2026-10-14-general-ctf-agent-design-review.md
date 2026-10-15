# 通用 CTF Agent 設計評審

日期：2026-10-14

> 閱讀說明：本文按輪次保留歷史評審與後續決策。最新審計見文末「第五輪：流程能力優先、校驗成本與 TSecBench 接入審查」，基於 1713 行設計，只提出意見，未修改設計。第四輪的「可制定實施計劃」結論針對契約可實施性，不代表其複雜度或解題投入產出已獲驗證。各輪行號只對應該輪基線；舊建議不自動成為現行要求。

第一輪評審對象：`2026-10-14-general-ctf-agent-system-design.md`，798 行版本。以下行號均指該設計文件。

## 結論

建議 **Request changes：先修訂關鍵契約，再拆完整實施計劃**。

平台 adapter、獨立偵查、證據驅動的專家團隊、離線 Reference、得分優先調度和單一 Core 鏡像可以保留。主要問題是：若干「必須做到」尚未綁定可執行的機制，部分規則互相衝突，恢復與驗收還不足以證明比賽中可靠運行。

這不是已運行產品的漏洞判定。評審基於設計全文、兩個獨立領域評審、OpenCode 本地 plugin 型別與固定版本源碼、Playwright 和 Docker 官方文件；沒有進行實際靶場操作或鏡像構建。

嚴重度：P1 = 可能阻斷核心流程或推翻承諾，應在實施前決定；P2 = 會降低解題效率、可測量性或交付品質，應在相關階段前修訂。

## 可直接確認的文內矛盾

1. **Verifier 提交權限相反**：L285 允許平台提交工具，L303 明確禁止。
2. **驗證例外沒有流程入口**：L297 允許低成本直接驗證，L321–335、L382–387 的主要流程仍要求 Engineer／Verifier；沒有例外的觸發契約。
3. **知識抽取的時點不同**：L266 限定比賽結束後，L504 寫題目結束後。
4. **Scheduler 平分規則不同**：L694 是逐項優先比較，L695 則允許任一次級指標改善；兩者可能選出不同勝者。

這些不是需要使用者再選產品方向的問題，應直接統一。

## P1：實施前應補齊

### R01. OpenCode 的執行控制與資料出口缺少落地契約

**位置：L98–104、L268–303、L403–412、L653–662。性質：實作契約缺口。**

目前沒有決定如何把 OpenCode 的 session、subagent、tool call 對應到 `run_id / challenge_id / task_id / lease`，也沒有說明每題路徑權限、總截止時間、取消和資料 Gateway 在哪一層強制執行。

具體問題：

- 同一 `web-solver` 角色可能先後或並行處理兩題；靜態角色權限不等於每個 session 的工作目錄隔離。
- Worker 若自行在工具參數聲稱另一個 task ID，State Service 不能據此判定其身份。
- OpenCode 子會話、主會話、壓縮、標題／摘要、模型重試和圖片附件都可能產生模型請求；僅在 `exec_job` 脫敏不能保證所有出口經過 Gateway。
- Agent `steps` 上限不能替代牆鐘截止時間、外部命令取消和併發總預算。

**建議：** 明確選擇 OpenCode 原生內循環，加一個 session lifecycle supervisor／plugin 作產品控制層；用宿主產生的綁定而非模型參數識別任務。列出每條約束對應的 plugin、SDK 或 provider 接點。關閉繞過受控工具的原生入口。M0 用兩個子任務驗證工作區隔離、取消、恢復及所有模型請求的資料分類，包含 compaction 與多模態。

本地 plugin 型別確實有 tool before/after、chat transform、compaction hooks，證明有擴展接點，但不能據此宣稱每條路徑已覆蓋。

### R02. 單容器中的任意腳本，不能靠 argv 與過濾環境完成隔離

**位置：L284–286、L423–442、L455–468、L603–608、L705。性質：承諾與已描述機制不匹配。**

Core 同時具有 Python、Node、編譯器、網絡工具及控制面資料。`exec_job` 採用 argv 可減少 shell quoting 問題，但 Python 腳本仍然能讀文件、連網或直接發 API 請求。若工具進程與控制面共用 UID 和文件視圖，過濾環境並不能阻止它讀到可訪問的資料卷、瀏覽器 profile 或服務端憑證。原生 file 工具權限也不是進程級文件隔離。

同時，OpenCode 官方說明會自動載入專案 `.opencode/plugins/`；若直接在下載的題目源碼根目錄啟動，題目附帶的配置或插件可能成為執行入口。

**建議：** 保留單一鏡像選擇，但補一張進程／UID／文件目錄／網絡權限表。可信配置、控制面、瀏覽器認證資料與工具工作區分開；不能執行題目附帶的 OpenCode 配置。需要硬約束時驗證實際 OS 層限制與服務授權。核心驗收應包含：作業不能讀控制面 secret、不能改 canonical DB、不能越權調用平台操作。無可用隔離機制時，應明確列出支援輸入範圍，而非保留「所有惡意樣本不洩密或耗盡宿主」的絕對承諾。

### R03. UI 與 API 雙重證據的硬要求會阻斷 API-only 流程

**位置：L165–173；對照舊設計 L63–87。性質：具體相容性衝突。**

L168 規定只有 UI 和 API 兩項證據能綁定題目，才可自動接受新入口。但 TSecBench 已確認的標準流程是任務 Token + SDK/API，下發的 `container_addr` 不保證同步出現在瀏覽器 UI。合法的 SDK-only 運行可能因此一直 blocked。

UI 和 API 經常來自同一後端，也不是兩個獨立信任來源；多一次 DOM 對照並不能替代來源授權。

**建議：** 把這項規則改成 adapter 級的 `resource_origin_policy`。對已審核 adapter，可接受經認證的指定 endpoint 中與 challenge ID 綁定的地址字段；UI 對照作為可選加強證據。未知 adapter 維持只讀候選輸出。初始授權仍限定可下發的地址種類及用途。

### R04. 恢復沒有跨存儲提交與外部副作用的「結果未知」狀態

**位置：L291–301、L463–464、L520–565。性質：可靠性契約缺口。**

兩種直接會發生的中斷窗口：

- evidence 已寫入 SQLite，但 artifact 尚未完整封存；重啟後有引用，沒有完整證據。
- 平台已接受 submit/start/close，但本地尚未記錄響應；重啟後重試可能消耗嘗試次數、重置實例或操作新一代資源。

只寫「先對帳再重試」仍不夠：不是所有平台都提供 submission history、冪等鍵或唯一 instance ID。

**建議：** artifact 先封存與校驗，再於同一 SQLite transaction 寫 state、event 和 outbox；JSONL 可重放導出。平台操作在發送前持久化 operation ID、前置狀態和資源版本，狀態至少有 `prepared / sent / confirmed / unknown / failed`。依各 adapter 定義如何處理 unknown，不做通用自動重放。Ownership 需保存來源證據；無法辨識資源 generation 時，應明定同一任務的唯一寫入者及不確定狀態處理。

### R05. 題目進度、候選結果、資源狀態與暫停被擠在同一流程

**位置：L321–336、L388–389、L411、L525–532、L559–562。性質：狀態機缺口。**

`ACCEPTED | CHECKPOINT | BLOCKED | UNSUPPORTED -> CLEANUP` 沒有定義 cleanup 的語義。自適應切題若每次都關閉實例，可能丟失已建立的會話與利用進度；若全部保留，又會耗盡實例名額。收到一個正確 flag 也可能被誤映射為整題 ACCEPTED。

**建議：** 分開四個狀態維度：

- 求解：active、paused、blocked、finished。
- 進度：candidate、partial、completed、unknown-total。
- 資源：starting、ready、retained、closing、closed、unknown。
- 清理：not-needed、pending、succeeded、failed。

每個 candidate、證據、會話和 PoC 綁定 instance generation。定義 pause 時保留或釋放的成本、lease 與 TTL；全域 scheduler 決定哪些實例佔用名額。沒有找到解法應為 inconclusive，不等於永久 unsupported。

### R06. 工具清單存在，但互動式連線與在途作業沒有產品接口

**位置：L423–433、L459–464、L555–563。性質：解題能力缺口。**

目前只有啟動、讀輸出、取消。Crypto oracle 每次 TCP 連線生成新參數時，需要先讀、分析，再向同一連線發送下一次查詢；重開 netcat 會使先前分析失效。pwntools 可編寫整段自動腳本，但不能代替 Agent 跨回合的 stdin／session 契約。

長計算在 Worker 步數耗盡或換題後，也沒有明確的接管、完成通知和結果收割方式。

**建議：** 增加受控 `job.stdin` 或 TCP／PTY session 接口，明確二進制編碼、讀取游標、timeout、連線 generation、transcript 和 owner。持久化作業狀態及預期產物。進程仍存活時可轉交；容器重建後不能「恢復」已消失的 TCP 連線，必須使相依狀態失效。

### R07. 瀏覽器登入、隔離和人工交接尚未形成一致拓撲

**位置：L135–138、L283–285、L611–616。性質：已知能力差異及實作缺口。**

文件把「獨立 BrowserContext」與「上下文分組」當作二選一，兩者不能提供相同 Cookie/storage 隔離。Playwright persistent context 本身保存 profile；新 BrowserContext 不會自動繼承 noVNC 登入狀態。把平台登入 profile 直接交給求解角色，又會讓靶機操作和平台帳號混在一起。

**建議：** 固定平台控制用 persistent context，由平台服務獨佔；題目使用獨立 contexts，必要時另行處理題目登入。定義 `AUTOMATION -> HANDOFF_PENDING -> HUMAN_CONTROL -> RESUMING` 的排他控制權；人類操作時停止相關 Agent 的點擊、快照和憑證捕獲。交還後檢查頁面／登入狀態，再恢復 lease，不能只用 UI 按鈕切換提示文字。

## P2：降低成本並使品質可驗證

### R08. 角色池可以保留，但缺少快路徑和可交接的任務快照

**位置：L247–277、L382–408。性質：效能待驗證風險。**

簡單題若順序經過 Triage、Recon、Strategy、Solver、Engineer、Verifier，即使只並發兩個，也可能有很高的串行 token 和延遲成本。新鮮上下文若只有 delta，又可能漏掉已否定路線，重新做同一實驗。

**建議：** 保留獨立 Target Recon，提供小題快路徑與難題完整路徑；Strategy、Engineer、Critic 按交接價值調用。新 session 必須先讀 `snapshot@sequence`，包括已排除路線、前提、作業、腳本入口和餘額，再訂閱 delta。用同題對照測每個額外角色的解出收益、token 和時間；「角色更多」不是驗收指標。

### R09. 停滯、得分排序和 Hint 使用仍依賴沒有定義的估算量

**位置：L311–319、L378、L393–411。性質：效能待驗證風險。**

不同 URL 的同類 404 都能成為 evidence delta，讓無效探索看似有進展；長計算連續三次查詢沒有新輸出，卻可能被判停滯。多 flag 題若已拿到大部分分數，仍按題目總分排序，會投入錯誤路線。

Hint 又只和切題比較，沒有和「不買 hint、繼續一個廉價試驗」比較。

**建議：** 定義語義進展事件而非輸出數量；在途作業等待不按普通失敗動作計數。優先級使用剩餘可獲增量分數、完整剩餘成本和不確定區間。Hint 與繼續、補偵查、Critic、切題比較邊際收益，納入扣分作用範圍和截止時間。

### R10. Tool manifest 與 Reference 尚未形成可執行的能力圖

**位置：L345、L360–374、L435–455、L484–500。性質：能力覆蓋缺口。**

工具名稱列表不能說明 Agent 何時該用哪個工具、需要哪些版本與架構、如何判斷輸出。Preflight 通過後，深入分析才發現需要 LLL/BKZ，也可能持續派發不可執行的實驗。

Reference 主要列出 Web 規範與寬泛資料來源，Misc、Crypto 的首發知識覆蓋尚不明確。

**建議：** 建立「題目能力 → 識別線索 → recipe → 工具版本／架構 → 預期產物 → 驗證」矩陣，直接對應 30 題能力分類。Hypothesis 記錄 required capabilities；缺失時標記可重評的阻塞條件。離線檢索對不相容版本硬過濾。首版可繼續用 FTS/BM25，但補中英同義詞、檢索測例和 recipe 執行測例，無須先增加向量資料庫。

### R11. 「刪除題目標識」不足以防止知識污染固定評測

**位置：L266、L480–514、L699–713。性質：評測污染風險。**

同一題的解法即使移除了 flag、題目 ID 和地址，仍然可能以「通用模式」進入 Reference。之後 30 題 gate 提分，測到的可能是解法記憶。人工批准不會自動消除這種污染。

**建議：** 分開開發／練習集與 30 題保留評測集，維護資料與解法衍生物的來源血緣。發布快照和開始評測時交叉檢查 manifest；已學習題只作回歸題，不能作泛化成績。統一賽後才啟動 distillation 的時點。保留使用者選擇的人工審核，不讓過濾規則取代審核。

### R12. Docker 的單命令啟動仍缺少兩套網絡與冷啟動規則

**位置：L571–622、L717–721。性質：部署契約缺口。**

- 範例使用 `-p 127.0.0.1:...`，VPN 卻優先 host network。Docker host 模式會忽略 `-p`，需要進程自己綁 localhost；bridge 模式則需要服務監聽容器可達地址。
- 非 root 不自動等於 Chromium sandbox 已開啟；Playwright 的 `chromiumSandbox` 預設為 false，需明確配置及檢查。
- noVNC、顯示服務、Chromium、MCP、OpenCode 和狀態服務的啟動順序、健康檢查與退出處理未定義；`--init` 只處理 PID 1／子進程回收，不替代服務 supervision。
- OpenCode 會在啟動時安裝某些配置依賴；只有 pin version，未必達成不臨時安裝的承諾。

**建議：** 保持一個 Core 鏡像，明確 `bridge`／`host-vpn` 啟動 profile、所有管理端口的綁定位置、`chromiumSandbox` 設置、服務 dependency 與退出順序。提供空白資料卷的冷啟動檢查，在僅允許模型和比賽必要網絡時驗證不訪問套件 registry。定義最低 RAM、磁盤、shm 和可用並發測量結果。

### R13. 已知平台族不等於所有版本、插件和能力都已驗證

**位置：L29–30、L139–144、L194–226、L679–685。性質：支援範圍與判定缺口。**

CTFd 自訂題型或 instancer 插件可以改變表單與 API；rCTF 的可用實例能力也取決於部署。只識別平台名字，不能據此授權全部 capability。未知平台的「只讀」也不能以 GET 判斷：既有 TSecBench 文檔已指出 hint GET 會扣分。

**建議：** 發布 `平台版本 × 插件／題型 × capability` 支援矩陣，信任和 drift 判斷落在 capability 層。未知操作保留 `unknown_effect`，不作協議試探。固定版本的已知能力可持續工作；單一可選能力漂移不必使整個平台永久失效，但相關寫能力應被隔離。

### R14. 30 題門檻可保留，測量方法需要修訂

**位置：L693–702。性質：已確認規則矛盾及測量缺口。**

15 題 easy 的 60% 是 9 題；15 題 medium 的 30% 要向上取整為 5 題。這是固定題組上的觀察門檻，不是母體解出率保證。單次最終 run 若可以反覆重跑挑最佳、放寬預算或刪除 needs_capability 題，成績不可比較。

**建議：** 在測試前鎖定 30 題 manifest、oracle、難度、快照、模型、預算、重跑規則和正式 run ID。失敗及不支援仍留在分母；平台故障另列。Scheduler 使用配對、乾淨狀態的重複試驗，公布各次原始數據。平分採明確的順位比較或 Pareto 規則，不混用。把「同題初始可見順序」與「策略自己選擇的求解順序」分開。

### R15. 里程碑先做編排、後交付工具與 Reference，容易產生假的早期通過

**位置：L729–735。性質：依賴順序問題。**

M3 要跑全部角色和三類代表題，但真正 Core 工具與 Reference 在 M4。實作者容易借用宿主工具或 Mock Reference 通過 M3，再於 ARM64 鏡像和真資料接入時大幅返工。

**建議：** M0 就做單題垂直切片：Core 鏡像、模型、瀏覽器／TCP、工具、最小 Reference、提交 oracle 和 checkpoint。之後擴到三類，再增加三平台和自適應調度。存儲故障注入放 M1，平台響應丟失放 M2，多 flag／pause 恢復放 M3；不要等 M6 才檢驗架構假設。

## 建議修訂順序

1. 統一 Verifier 權限、直接驗證、知識晉升時點和平分規則。
2. 補 OpenCode integration contract 與單容器進程／憑證／網絡邊界。
3. 補 operation ledger、instance generation、逐 flag 狀態及 pause/resume 契約。
4. 補互動式 Tool Runtime、能力 recipe 和瀏覽器 handoff。
5. 固定 30 題測量方式、開發／保留集及知識血緣。
6. 調整里程碑，先證明最小閉環，再擴大平台和角色調度。

不建議為解決上述問題繼續增加 Agent 數量，或先引入向量資料庫。這一版最需要的是可執行契約及故障場景，而不是更多角色名稱。

## 本輪核查來源

- 設計全文：`docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`。
- 既有 TSecBench 契約記錄：`docs/superpowers/specs/2026-10-13-ctf-solving-agent-design.md:53–111`。
- 本地 plugin 型別：`.opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts:173–321`，`tool.d.ts:1–60`。
- [OpenCode plugin 官方文件](https://opencode.ai/docs/plugins/)：自動載入、啟動依賴、tool／compaction hooks。
- [OpenCode permissions](https://opencode.ai/docs/permissions/)：工具權限與 external_directory 的作用範圍。
- [OpenCode v1.19.0 Task 源碼](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.0/packages/opencode/src/tool/task.ts)：子會話建立、恢復、繼承和取消。
- [OpenCode v1.19.0 LLM 源碼](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.0/packages/opencode/src/session/llm.ts)：provider 調用和 runtime 接點。
- [Playwright BrowserType](https://playwright.dev/docs/api/class-browsertype)：persistent context、profile 鎖定、Chromium sandbox 默認值。
- [Playwright BrowserContext 隔離](https://playwright.dev/docs/browser-contexts)：Cookie／storage 隔離和新 context 語義。
- [Docker host networking](https://docs.docker.com/engine/network/drivers/host/)：host namespace 及忽略端口發布的行為。

官方在線文件會變動；實施時仍需把 OpenCode、Playwright、平台版本及可用 hooks 固定到相同測試基線。本評審未把文件存在等同於實作已驗證。

## 第二輪：解題行為與可實施細節審查

本節評審對象為現行設計的 **1071 行版本**，以下 D01–D12 的行號指向該版本。前面的 R01–R15 是 798 行舊版的歷史評審；固定 30 題、角色快路徑等建議已被後續使用者決策取代，不能當作現行要求。

本輪目的：在既定產品方向內補齊實作者仍必須猜測的解題行為。保留單鏡像、每容器一個 run、固定完整角色流水線、離線 Reference、Coordinator 唯一提交與使用者靶場驗收。下面是待討論建議，不代表使用者已批准，也不代表功能已實測。

### D01. 角色有職責，但缺少可驗收的交接契約

**位置：§7.1–7.3，L346–395；§15.3，L962。優先級：高。**

現在能知道有哪些 Agent，卻不能判定「Recon 是否做完」「Engineer 可否開始」「Verifier 拿到的材料是否完整」。一份文字報告或沒有實際嘗試的 role-failure，也可能滿足流水線的形式要求。

建議每個角色定義 `input_refs / required_outputs / entry_conditions / completion_conditions / retryable_errors / budget / next_stage`，並給一份成功和一份失敗交接範例：

| 角色 | 最小可消費交付物 |
| --- | --- |
| Triage | 題目 ID、評測類別、可更新的 routing tags、輸入清單、能力需求、未知項 |
| Target Recon | 已觀察入口或文件結構、前置狀態、證據引用、下一步可執行試驗 |
| Reference | 精確查詢、命中／無命中、recipe ID、版本、適用條件與不適用原因 |
| Strategy | 排序假設、反證條件、最小實驗、預期產物、停止條件 |
| Domain Solver | 可重放試驗、原始輸出引用、結論／推測分離、候選或阻塞原因 |
| Solution Engineer | 腳本與輸入 hash、執行環境、命令、依賴狀態、預期產物 |
| Verifier | 所驗候選 hash、驗證模式、檢查項、有效條件、結論與失敗原因 |

role-failure 必須有真實 dispatch／attempt、錯誤來源與恢復處置；「未排程」只能是 coverage gap，不能用補一份文件冒充完整流水線。這是工程補全，不需要減少既定角色。

### D02. 獨立驗證不應被等同為每次重新利用

**位置：§7.1，L360；§8.7，L531–541；§9.1，L574。優先級：高；需確認產品取捨。**

一次性下載、剩餘查詢次數很少的 Crypto oracle、依賴原連線隨機數的題目，以及會改變遠端狀態的利用，都未必可以重新跑。Verifier 開新連線或重置實例，可能破壞已有候選；所有題又都必須經過 Verifier。

建議保留獨立 Verifier，定義分情境的驗證方式：

- `replay`：可以安全重跑時，獨立執行相同解法。
- `recompute`：使用保存的輸入，獨立重算方程、解碼或提取結果。
- `evidence_audit`：一次性或不可重放時，核對原始 transcript、候選 bytes、腳本和當時狀態，輸出明確的檢查清單。

這些只決定候選是否可交給 Coordinator 嘗試提交；任何模式都不能把 `verified` 提升成 `solved`，最終仍須平台／本地權威 oracle。應記錄 `valid_until`、connection generation、instance generation 和提交前置條件。

需確認：不可重放時是否允許 evidence-audit 通過候選檢查，或必須保持 inconclusive。

### D03. 得分／時間公式需要估算來源及截止前的收尾窗口

**位置：§8.4–8.6，L488–529；§13，L870；§15.4，L968–975。優先級：高。**

公式已清楚，但 `成功概率` 和 `剩餘牆鐘時間` 仍可能只是模型自報。若每次自報更樂觀就能提高優先級，容易反覆押注同一條失敗路線。三個 Worker 並行也不能等於三個任務的耗時簡單相加或相除。

建議補齊：

- 每份估算附 `as_of_sequence`、依據、區間、下一個里程碑和已消耗成本；舊估算到期或被新 evidence 推翻後重算。
- 預估時間包含排隊、平台限流、Engineer、Verifier 和 submission 往返時間。
- 保留驗證／提交／平台對帳的時間，不把最後一秒全部用於 Solver。
- 區分平台硬截止、停止新實驗時間與本地報告／清理窗口；結束後不再提交，但仍可生成報告或在平台允許時清理。
- 平台分數用快照或平台回傳的 cumulative score 對帳，不自行反覆累加。
- M0 無歷史資料時使用明示的初始估算；校準來自開發運行，不能把模型的自信當作經驗概率。

既有 TSecBench 契約記錄沒有足夠字段提前查到 Hint 精確扣分（舊設計 L105–111）。因此內建 adapter 必須標明成本來源與未知時的停用原因，不能承諾每個支援平台都會自動買 Hint。

### D04. 能力缺口應按可用解法判斷，而非缺某個工具就放棄

**位置：§8.2，L457；§9.3–9.4，L599–631。優先級：高。**

現行文件把「SageMath／LLL」一起寫成首版能力缺口，但 Core 已包含 SymPy。SymPy 1.14.0 官方接口已有 `DomainMatrix.lll()`；不能由沒有 SageMath 推論所有 LLL 問題都不可處理。

建議能力矩陣增加：`implementations[] / preferred_backend / fallback_backend / input_size_limits / precision / measured_cost / failure_modes`。

例如小型整數格基可先評估已安裝 SymPy 的 LLL，較高維或特殊演算法才標記缺少經驗證 backend。這不表示 SymPy 能取代 SageMath／fpylll，也不代表 ARM64 性能已通過測試。

同理，把「工具不存在」「替代工具可行但較慢」「已有工具但輸入規模超限」「只有這條假設缺能力」分開，不直接把整題設為 blocked。保持不得運行時安裝的既定要求。

核查來源：[SymPy DomainMatrix.lll](https://docs.sympy.org/latest/modules/polys/domainmatrix.html#sympy.polys.matrices.domainmatrix.DomainMatrix.lll)。

### D05. 混合題與重規劃需要階段依賴圖

**位置：§7.1–7.3，L346–395；§8.2，L451–457。優先級：中高。**

例如一題 Misc 附件內有加密流量，解密後才能打 Web 入口。目前單一 Domain Solver 節點、凍結分類和固定流水線，沒有說明怎樣串接不同專家，也沒有定義何時重新跑哪一段。

建議分開：

- `evaluation_category`：正式驗收前凍結，用於分母。
- `routing_tags`：依 evidence 更新，可同時有 Web／Misc／Crypto。
- `task_dependencies`：同一 challenge 內按產物派給多個專家，共用該題證據，不越過逐題隔離。
- `stage_revision`：只重跑受新證據影響的階段；Engineer／Verifier 綁定本次候選和解法版本。

固定完整流水線應保證角色責任都有履行，並不自然等於每次失敗都從 Triage 重跑。需確認是否採取「首輪完整、後續按依賴回退」的規則。

### D06. Reference 應細化檢索行為和首發內容覆蓋

**位置：§9.4，L629；§10，L633–670。優先級：中高。**

目前已有來源類別、FTS 和引用格式，但尚不能回答：遇到什麼線索查什麼、查不到怎麼辦、結果不適用如何停止追錯方向。

建議給三類題各一組最小 recipe 家族與檢索案例，例如 Web 的 HTTP／session／輸入面、Misc 的容器與轉換鏈、Crypto 的編碼／模運算／常見參數關係；每項帶適用條件、工具命令、預期觀察和反例。

另外分離：

- 版本中立的概念資料：不因缺某個工具而完全不可見。
- 可執行 recipe：按已安裝版本、架構和資源範圍過濾。
- 不可用 backend 的說明：可解釋缺口，但不能作 runnable 下一步。

記錄 query、改寫原因、命中、引用和採納結果。零命中可有限次改寫或直接推理，不能偽造引用，也不應每次重新查同一批資料。

### D07. 突然崩潰後，原 run 可能永遠進不了恢復入口

**位置：§4.4，L176–178；§8.1，L437–445；§11.5，L759–770。優先級：高。**

恢復第一步只接受 `interrupted`，但 SIGKILL／宿主斷電可能讓 SQLite 留在 `running` 或 `finalizing`，沒有機會寫 interrupted。現行文件未定義誰識別這個狀態。

建議 startup reconciliation 先取得唯一 run-owner lock，核對 owner incarnation／boot ID／lease，再把失去執行者的非終態 run 原子轉入 recovery。已完成、failed、invalid、aborted 仍不可恢復。不能僅憑 heartbeat 慢就接管仍存活的 owner。

驗證情境：在 running、finalizing、提交 response 回來之前與之後強制退出，重啟後可對帳，且同一份 `/data` 不會有兩個接管者。屬技術補全，無須變更不可逆終態選擇。

### D08. 不可變證據、進行中日誌和失效範圍需分開

**位置：§8.1，L447；§9.2，L591；§11.2，L701–709。優先級：高。**

長作業的輸出要能即時讀取，但 Artifact 契約要求文件完成封存後才可引用。若直接引用仍在增長的 stdout，hash／cursor 和後續重放就不穩定。另把所有 evidence 綁到 instance generation，會使純附件分析也因靶機重啟而被整體標 stale。

建議：

- 進行中日誌以有序、不可變 chunk 封存；每份 evidence 引用已封存 chunk 和 byte range。
- `input_bound`、`instance_bound`、`connection_bound` 分別對應附件 hash、實例版本、連線版本。
- 觀察歷史保持不可變；只把依賴已改變狀態的結論／候選標為需重驗。
- 同題並發 Worker 使用各自的 attempt workspace，發布時提交 script/artifact hash，避免一個 Agent 改掉另一個 Agent 正在驗證的腳本。

這既保留可靠恢復，也避免每次重啟都重新做靜態分析。

### D09. 尚存幾處可以直接統一的規則歧義

**位置：§5.2–5.3，L223–247；§8.1，L445；§15.3，L948。優先級：高。**

1. §5.2 把無法取得 oracle 列為 formal admission 不足；§15.3 又允許 oracle 缺失的題按 candidate-only 計未解。需分開「題面無法列舉」與「已確知這題沒有 oracle」，後者按已確認決策正常求解並計未解。
2. §5.3 允許 live 追加 grant；§8.1 卻說任何擴權都要新 run ID。應把後一句限定為 formal run／超出初始授權規則的變更，避免 live 正常平台下發入口被誤阻止。
3. §5.2 說類別或 oracle 的任何變動都 invalid，但 §8.7 又允許平台回覆補充多 flag 狀態。應區分凍結的 oracle 判定規則與正常觀察到的進度／slot 證據，否則第一次正確提交也可能誤報 drift。

以上應直接依既有決策修訂，不必讓使用者重選整個驗收模型。

### D10. 模型資料政策需分清帳號秘密與題目分析資料

**位置：§13，L872–881。優先級：高；需確認產品取捨。**

平台／provider 憑證不可外送已確認，但 Cookie／Authorization 的全稱禁止，沒有區分比賽帳號 Token 和題目刻意要求分析的 JWT、Cookie 格式、公開測試密鑰或加密樣本。過寬遮罩可能讓 Solver 看不見題目關鍵結構。

建議建立固定分類而非臨場例外：`control_secret / challenge_auth_reference / challenge_analysis_data / artifact_bulk / allowed_excerpt`，並把 byte 上限、圖片限制與來源 lineage 寫清。

需確認題目中的認證樣本是否只能由本地工具返回去識別後的結構，還是可作最小必要 challenge data。無論選哪一種，真實平台／provider 秘密仍禁止外送，也不新增 run 級人工豁免。

### D11. 未知平台探索可能因完全阻止資源而沒有可辨識內容

**位置：§5.1，L204–211；§5.5，L313。優先級：中高。**

單頁應用初始 HTML 可能只有 root node。JS、CSS 和資料請求全被攔截時，平台指紋、題目表單和 API schema 都可能沒有出現，而使用者面對的是多輪零散請求批准。

應增加具體 onboarding 場景：先展示一份頁面啟動／登入所需資源的批次預覽，再捕獲題目列表與操作映射；未能發現必要 schema 時明確輸出缺口。需要說清初始入口授權、資源載入授權和平台寫能力批准之間的關係，不把「只讀」等同 HTTP GET，也不承諾任意 SPA 一次就能生成可寫 adapter。

這是自治體驗與未知副作用之間的取捨，具體批准粒度應在修改產品行為前確認。

### D12. 需要失敗分類、可操作狀態與正向能力測試

**位置：§9.2，L587–597；§15.2–15.5，L909–989；§16，L991–1005。優先級：中高。**

現行驗收對拒絕操作很詳盡，但「環境完整、會解題、失敗可診斷」仍缺最小演示。需要把以下問題分開：

- 假設被反證：交 Strategy，不重試同一操作。
- 工具參數／解析錯誤：有限本地修正，不等於題目太難。
- 模型 429／5xx／輸出 schema 錯誤：按預先配置退避及修正，消耗原預算，不悄悄換模型。
- 平台限流／登入過期／unknown operation：分別等待、handoff 或對帳。
- 能力缺失／資源不足：展示可行替代 backend 或具體缺口。

運行狀態至少可回答：現在在解哪題、哪個角色、上一個有意義進展、還在等待哪個 job、剩餘預算、阻塞原因和下一步。CLI 查詢／事件輸出即可，首版不必增加完整 Dashboard。

正向案例建議包括：多頁題目清單完整匯入、Web 登入後提交閉環、Misc 多步轉換鏈、Crypto 同連線 oracle、混合題跨專家交接、容器突然退出後接回、一個只有候選但沒有 oracle 的本地題。這些是開發驗證場景，不是重新引入固定正式題庫。

### 本輪建議順序與決策邊界

1. 先補 D01、D02、D05：角色輸入輸出、驗證模式、階段回退，讓解題循環可落地。
2. 同步修 D07–D09：崩潰接管、證據生命週期及現存規則歧義。
3. 補 D03、D04、D06：可追溯的時間／概率估算、可執行替代能力及 Reference recipes。
4. 最後落定 D10–D12：資料分類、未知平台接入體驗、失敗診斷與正向測試。

可直接補全的工程契約：D01、D03、D04、D06–D09、D12。需要使用者確認的行為取捨：D02 的不可重放驗證、D05 的迭代回退、D10 的題目資料分類、D11 的未知頁面載入授權。這些決策應用選擇題逐項確認；本節不把建議視為批准。

### 本輪問答結果與候選設計落點

後續選擇題已確認：

1. Verifier 按情境使用 replay、recompute 或 evidence-audit；最終 solved 仍由權威 oracle 判定。
2. 首輪完整流水線，後續依依賴局部回退；新候選重新經 Engineer 與 Verifier。
3. 資料按用途分類；題目明確提供的分析樣本可最小化外送，真實控制面秘密與來源不明資料不可外送。
4. 未知平台先批准 bootstrap 資源批次，再批准 adapter capabilities。
5. Builder check 提出的正式測試基線問題：正式 run 要求可核實的未作答／未解鎖 Hint 狀態；Live 可接續進度，人工校準不計正式成果。

以上已原地納入現行設計；本表使用章節定位，前面的 1071 行引用仍指本輪開始時的版本：

| 項目 | 現行設計落點 |
| --- | --- |
| D01 角色交接 | §7.5 role envelope、完成條件、成功／失敗範例、真實 attempt 要求 |
| D02 驗證模式 | §8.8 三種模式、有效依賴、候選與 solved 分離 |
| D03 調度估算 | §8.4 可追溯估算與原子預留、§8.5 Hint 成本來源、§8.9 收尾時間 |
| D04 替代能力 | §9.4 backend／輸入規模／成本矩陣，LLL 不再被一概排除 |
| D05 混合與回退 | §7.6 evaluation category／routing tags、stage revision、attempt workspace |
| D06 檢索行為 | §10.3 concept／runnable recipe／gap note、零命中處理和三領域內容家族 |
| D07 異常接管 | §11.5 owner lock／incarnation、nonterminal recovery admission、終態拒絕 |
| D08 證據生命週期 | §8.1 lifetime dependencies、§11.2 immutable stream chunks、§7.6 腳本版本 |
| D09 規則歧義 | §5.2 正常觀察與 drift、§8.1 Live grants、§15.3 no-oracle 分母 |
| D10 題目資料 | §13.1 data classes、來源追蹤、固定大小限制與控制秘密優先 |
| D11 Bootstrap | §5.6 分階段批次批准、分頁完整性與 discovery budget |
| D12 診斷與正向驗證 | §9.5 failure taxonomy、§11.6 CLI 狀態、§15.6 正向場景 |
| Builder 基線問題 | §5.6 calibration_tainted、§15.3 clean baseline 與 run-specific attribution |

獨立 builder check 已完成，唯一需要使用者決定的乾淨基線問題已答覆；複查確認該問題已關閉，且與 candidate-only、使用者靶場驗收相容。文件仍待使用者批准；ARM64、OpenCode 接點、平台與實際解題效果仍依 M0–M6 實測，不由本次文件審查代替。

## 第三輪：單題解題策略深化

使用者選擇繼續深化解題策略。本輪在角色、驗證、恢復和平台接入已確定的基礎上，補上如何選路、如何試驗及何時停止。審查起點為 1315 行設計；以下使用章節定位，不依賴後續增補後的行號。

### 本輪明確選擇

1. **主線＋低成本反證**：資源集中在一條主線，允許針對關鍵前提的短小對照／反證試驗。
2. **可續期實驗窗口**：先聲明預算和可觀察里程碑，有有效進展且仍值得投入才續期。

### 缺口與細化結果

| 缺口 | 細化內容 | 設計落點 |
| --- | --- | --- |
| 假設只是工具清單或一個猜測 | 增加前置條件、替代解釋、反證、狀態依賴、route status；錯誤輸出不等於反證 | §8.3 |
| 主線和備選路線可能無限制並行 | 一條主線、最多一個低成本 probe、共有預算、全域並發與 mutation lease | §8.10 |
| 每個命令有 timeout，但整條路線仍可無限追加 | Experiment card、窗口 review／硬截止、續期證據、fingerprint 去重、合法 session 接管 | §8.11 |
| Web 只列漏洞類別，缺少觀察順序 | 正常基線、源碼／動態資料流、前提檢查、單變量對照、機制驗證與鏈式交付 | §8.12 |
| Misc 容易反覆解碼、掃遍工具或破壞來源 | 內容尋址轉換 DAG、格式／校驗驗證、hash 去重、展開限額、同題跨專家交接 | §8.13 |
| Crypto 易因解析、前提、backend 或連線不一致走錯 | 數學域與表示、便宜必要條件、受支持 backend、oracle query 計劃、原約束驗算 | §8.14 |
| 爆破／Critic 可能成為無限投入出口 | 有界搜尋空間、pilot 成本、具體下一試驗、無新證據不恢復 parked 路線 | §8.15 |
| 策略規則難以重現與驗證 | Window／experiment／decision canonical records、activity 綁定、決策級正反案例 | §9.1、§11.1、§15.4–15.6 |

### 工程初始參數

Shortlist 最多 5 項、同時最多 1 個 counterprobe、probe 暫以各窗口時間／token 額度的 15% 為上限；連續 2 個有有效試驗但無 semantic progress 的完整窗口，在 Strategy 重規劃後觸發一次 Critic。這些是設計者初始值，已放入 §20，須由開發場景校準，不能宣稱已證明能提高解出率。

這一輪補的是決策規則與驗證場景，保持單次使用者靶場正式驗收，沒有另設固定題庫，也沒有增加 Agent 角色或允許運行時安裝依賴。

## 第四輪：執行邊界、恢復與交付契約審查

日期：2026-10-14。

審查基線：[`2026-10-14-general-ctf-agent-system-design.md`](2026-10-14-general-ctf-agent-system-design.md)，**1470 行版本**；Git blob hash（`git hash-object`）：`d93ec378c63a176b9847cb7ebc585cea5df67d32`。以下 F01–F05 的行號均指此版本，後續修改時以章節和問題 ID 對照。

基線狀態：本輪審計意見與優化建議當時尚未納入設計，也未通過運行時驗證；文末保留後續處置記錄，「設計已修訂」不代表「實作已驗證」。

### 本輪結論與追蹤表

**Request changes：2 項 P1、3 項 P2。** 建議先確定兩個 P1 的執行契約，再拆完整實施計劃；P2 在對應階段前補齊。

現版已明確候選與 solved 的區別、Coordinator 唯一提交權、三種獨立驗證模式、不可逆終態及正式驗收基線。剩餘主要問題是：存活執行活動如何被接管，以及瀏覽器與原生工具的實際行為如何受到約束。

| ID | 級別 | 問題／優化目標 | 建議調整位置 | 驗證落點 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| F01 | P1 | 恢復前確認存活執行器的唯一接管或停止 | §9.2、§11.3.2、§11.5、§12.1.1、§15.2 | M0/M1 | 設計已修訂，待 M0／M1 實測 |
| F02 | P1 | 為每個 Challenge Browser process 建立可強制的逐題出站身份 | §4.5、§6.1、§9.6、§12.1.1／12.3、§15.2／15.5 | M0 可行性、M2 瀏覽器、M5 網絡 | 設計已修訂，待 M0／M2／M5 實測 |
| F03 | P2 | 將 request／query／connection 硬上限接到實際發送路徑 | §8.11、§8.14、§9.1.1、§11.3.2、§15.4／15.5 | M1 計量、M3 限次 oracle | 設計已修訂，待 M1／M3 實測 |
| F04 | P2 | 為 Runtime effects 補穩定調用身份、去重、順序與結果不明語義 | §9.1.1／9.5、§11.1／11.3.2、§15.2 | M1 | 設計已修訂，待 M1 實測 |
| F05 | P2 | 區分 noVNC 的宿主發布地址與容器內監聽地址 | §6.1、§12.2／12.3、§15.5 | M0 聯通、M2 handoff | 設計已修訂，待 M0／M2 實測 |

### F01. 恢復撤銷舊 lease，但未處理仍在執行的舊作業

**級別：P1。位置：§11.5，L1060–1078；關聯 §9.2，L819–826。**

**觸發場景與影響：** 只 SIGKILL Run Supervisor，容器、Tool Runtime、job shim 和修改遠端狀態的腳本仍然存活。新 Supervisor 取得 lock、撤銷舊 session lease 後恢復調度，舊腳本卻仍可繼續發送請求。新任務可能重新取得同一實例的 mutation lease，造成兩個執行者同時修改，或出現無人接管但持續消耗預算的作業。

**現有機制為何不足：** Owner lock 證明原控制者已消失，不證明其啟動的執行活動已停止。撤銷 lease 和拒絕晚到狀態結果，無法停止已啟動腳本的網絡行為。現行 `lost` 規則明確針對容器重啟；普通 Worker 的 lease transfer 也未定義異常恢復時的處理順序。

**建議補齊／優化：**

1. 在恢復 Scheduler 或重新授予 mutation lease 前，增加明確的 execution recovery barrier；先盤點存活 job、listener、互動連線及待發平台操作。
2. 對每項執行活動，確認原子接管其 owner、lease、原 deadline 和預算預留，或者確認已停止。接管不能重置已消耗成本或延長時間。
3. 無法確認接管／停止時，阻塞相關資源，避免以「舊 lease 已撤銷」直接放行新的修改者。
4. 舊 incarnation 的待發控制操作不能在恢復後繼續送出；可能已送出的操作沿用 Operation Ledger 對帳，不能靠本地取消推斷遠端未生效。

**驗收場景／關閉條件：** 舊 job 持續修改測試端計數器，只殺 Supervisor 並保留容器與 shim；恢復後對同一實例派發新任務。必須觀察到舊 job 被唯一接管，或已確認停止；不得與新 mutation owner 同時執行。再驗證無法確認停止時會保持阻塞，且預算與 deadline 沿用原值。

### F02. 共享 Challenge Browser 無法僅靠 UID／進程規則實現逐題網絡隔離

**級別：P1。位置：§4.5，L189–203；§6.1，L342–349；關聯 §12.2，L1142、§15.2，L1269。**

**觸發場景與影響：** A、B 兩道 Web 題同時運行，共用 Challenge Browser 進程，各自使用 BrowserContext。共享網絡身份需要允許兩題地址，A 頁面的普通跳轉、子資源或 fetch 因而可能觸達 B，違反「只能訪問當前題目、不能訪問其他題目」的承諾。

**現有機制為何不足：** BrowserContext 提供 Cookie／storage 隔離，不提供逐題獨立的 OS 網絡身份。瀏覽器請求經過共享網絡服務時，UID／進程級規則無法按 context 區分。§4.5 的 policy proxy 針對平台與靶機同 origin 的 Tool job，§5.1 的 interceptor 針對平台 discovery，均未形成逐 challenge context 的完整出站契約。

**建議補齊／優化：**

1. 明確每條瀏覽器出站請求如何可靠綁定 `challenge_id / context_generation / instance_generation`，並在發送前執行授權。
2. 選定並驗證可執行路徑，例如受信任的 context-aware 出站控制。若改採逐題進程方案，也必須有可區分的 OS 網絡授權身份；僅多開進程但共用相同網絡權限仍不足。
3. 覆蓋導航、重定向、子資源、fetch、WebSocket 與 Service Worker 等路徑，不能只檢查 Agent 主動輸入的 URL。
4. Context 關閉、generation 失效或 grant 撤銷時，同步處理其出站授權及存量連線；將該項可行性前移至 M0，不等 M5 才發現拓撲不能滿足約束。

**驗收場景／關閉條件：** A、B 同時運行，A 透過直接導航、重定向和頁面自行發出的請求訪問 B 均被拒絕，B 自身訪問仍正常；撤銷 A 的授權後，其存量連線也不能繼續執行已失去授權的操作。

### F03. Request／query 上限尚未約束原生工具的實際發送量

**級別：P2。位置：§8.11，L675–687；§8.14，L750；§8.15，L759–761；§9.1，L776–805；關聯 §20，L1468。**

**觸發場景與影響：** 實驗卡已設定 `max_requests`，Crypto oracle 也有剩餘 query budget，但一個腳本、HTTP client 或掃描工具可以在單一 job／持久連線內發出多次請求。工具內部的正常重試、批次與並發即可超額，提前耗盡限次 oracle 的剩餘機會。

**現有機制為何不足：** §8.14 已要求聲明按 HTTP 請求、協定消息或連線計次，這解決了計數單位，尚未解決實際執行時的可信計量。牆鐘、進程與 IP 限制不能約束應用層消息數；job 啟動前預留額度，也不能保證其內部發送量符合預留。

**建議補齊／優化：**

1. 在有硬 query 額度的 capability 中明示計數單位、計量／上界保證來源、重試與批次的計費規則，以及是否適用於當前 transport。
2. 使用可進行可信計量的發送路徑，或經驗證能保證最大發送量的工具／recipe。並發、重試與接管後的工作共用同一額度，在發送前扣減或預留。
3. 無法提供可執行上界的 native 路線，不用於該受限 oracle；返回具體計量能力缺口，讓 Strategy 選擇相容實現。
4. 結果不明的發送保留保守佔用，與 F04 的寫入語義一致，不能因缺少確認便自動退回額度。

此建議限定於承諾硬 request／query 上限的路線，不要求 Runtime 通用解析任意 TLS 或自訂協定。優化重點是讓 capability 聲明與可強制的執行能力一致。

**驗收場景／關閉條件：** 設定明確 query 上限，啟用工具內部重試、並發及多消息批次；以受控 oracle 實際收到的消息數驗證不超限。再測試無法計量／證明上界的路線會在發送前被拒絕，而非僅在事後報告超額。

### F04. 交互寫入缺少「可能已經發送」的恢復語義

**級別：P2。位置：§9.1，L781–805；§9.5，L879–892；對照 §11.3，L1012–1026。**

**觸發場景與影響：** Runtime 已向同連線 Crypto oracle 寫入查詢，但返回 OpenCode 的確認丟失；Worker 重試，或移交後重新發送。重複查詢可能消耗最後一次機會，或者讓交互協定進入錯誤階段。

**現有機制為何不足：** 讀 cursor、connection generation 和 transcript 不等於寫入確認／去重協定，仍存在「bytes 已發出，但記錄尚未持久化」的窗口。平台操作已有 `unknown` 和禁止盲重試規則，`job.write`／`listener.write` 尚無等價契約；experiment fingerprint 也不能判定同一次工具調用是否已經發送。

**建議補齊／優化：**

1. 為有副作用的交互寫入建立穩定調用 ID／發送序號，綁定 job、connection generation 和 payload hash；重試沿用同一身份，不重新生成一次新發送。
2. 明確區分確定未寫入、已寫入和結果不明，並說明確認代表本地 transport 已接收，還是遠端協定已確認，不能混為同一成功語義。
3. 同一調用的確認丟失後，可查詢既有結果；跨崩潰無法確認時保留不確定狀態和額度，只有協定或證據能證明安全時才重發。連線與 Worker 移交也必須帶上待確認寫入狀態。
4. 將這類錯誤從普通 transient retry 分離，接入 §9.5 的 failure taxonomy 及 CLI blocker，避免有限重試仍重複消耗一次性資源。

**驗收場景／關閉條件：** 在 oracle 收到 bytes 後、工具確認返回前斷開本地 RPC，再重試同一調用並移交 Worker。遠端應只收到一次，或系統明確阻塞為結果不明；不能在無證據時重發。另測試 payload 不同卻重用同一調用 ID 時會被拒絕。

### F05. noVNC 的 localhost 綁定未區分宿主與容器命名空間

**級別：P2。位置：§6.2，L365；§12.2，L1108–1138；關聯 §4.4，L180、§12.3，L1155。**

**觸發場景與影響：** 實作者按「noVNC 只綁 localhost」讓服務只監聽容器內 `127.0.0.1`，並使用文中的 Docker bridge 與 `-p 127.0.0.1:<novnc-port>:<novnc-port>`。宿主發布端口轉發到容器網絡接口，無法到達容器 loopback 上的服務，宿主與 SSH tunnel 都不能完成交接。

**現有機制為何不足：** 啟動命令中的 `127.0.0.1` 是宿主發布地址，與容器內進程的監聽地址是兩個不同設定。文案未將兩者分開，入站策略中的「localhost noVNC」也未說明對應哪個命名空間。這是按字面實作會失敗的部署歧義，尚非已構建鏡像的故障判定。

**建議補齊／優化：**

1. 在發布 profile 分別列出宿主發布地址、容器內監聽地址、端口與入站規則。
2. 宿主發布維持 localhost；容器內服務監聽 Docker 轉發可達的接口，或明確指定受控轉發層，並配套限制其可訪問來源。
3. Doctor 與端到端驗收從宿主／SSH tunnel 檢查 HTTP、WebSocket 和實際 handoff，而非只在容器內檢查服務進程存活。

**驗收場景／關閉條件：** `host-vpn` 與 `container-vpn` 都能從宿主及 SSH tunnel 完成 noVNC WebSocket 連接、人工接管和交還，且符合發布的管理端口可見性規則。

### 後續調整 plan 的建議順序

1. **先確定 F01、F02 的執行契約。** 前者決定恢復流程和資源所有權，後者決定瀏覽器出站拓撲；它們會影響後續 Runtime／Browser 實作方式。
2. **將 F03、F04 一起細化。** 發送身份、未知結果、額度預留和重試必須一致，避免解決重複發送後，預算帳本仍把未知操作視為未消耗。
3. **在 M0 聯通前消除 F05 歧義。** 將監聽／發布／firewall 寫成可直接執行和驗證的 profile 契約。
4. **同步更新正文與 Gate。** 每項修訂同時落到行為章節、接口／狀態、失敗處置及驗收案例，避免只在 §15 增加一條「必須通過」，執行機制仍缺失。

下列清單記錄設計修訂證據；勾選只表示正文與 Gate 已一致更新：

- [x] F01：§9.2、§11.1、§11.3.2、§11.5、§12.1.1、§15.2、§17 已補 systemd watchdog、host-authoritative owner token／epoch、空 root 的 control／executor cgroup、恢復屏障、接管／終止／hard-stop／recovery-only 分支及原預算／deadline 繼承。
- [x] F02：§3.4、§4.5、§6.1、§9.6、§11.1、§12.1.1／12.3、§15.2／15.5 已固定逐題 Chromium process、Linux UID、隔離 display、UI／proxy cgroup、policy proxy、存量 flow revocation receipt 與 Doctor slot profile。
- [x] F03：§8.11、§8.14、§9.1.1、§9.4、§11.3.2、§15.2／15.4／15.5 已定義 managed transport、request／query／connection unit、budget scope／counting point、發送前扣留、Browser request envelope、late metering transition 及不可計量時的拒絕行為。
- [x] F04：§9.1.1、§9.5、§11.1、§11.3.2、§11.5、§15.2 已以 Runtime Call Ledger 定義 `job.start`、browser action、open／accept／write 的穩定 `call_id`、single-dispatch claim、endpoint sequence、quarantine key、confirmation、`unknown` 與禁止自動重放。
- [x] F05：§6.1、§12.2／12.3、§15.5 已分開宿主 loopback 發布、per-run internal management bridge 監聽、獨立 data bridge、namespace firewall、隔離 display 與宿主／SSH tunnel 驗收。

每項可在正文與相關 Gate 完成一致性複查後標為「設計已修訂，待實測」；只有附上對應運行／故障注入結果，才標為「實作已驗證」。保留本輪問題描述與基線，後續追加處置記錄，便於比較每次 plan 調整。

### 第四輪處置記錄

日期：2026-10-15。

修訂後基線：[`2026-10-14-general-ctf-agent-system-design.md`](2026-10-14-general-ctf-agent-system-design.md)，**1713 行版本**；Git blob hash（`git hash-object`）：`451a535fc5d73609cd4d57d4465485834417f23e`。

本次只處理 F01–F05 及其必要一致性同步，沒有重開固定完整首輪、單一 ARM64 Core、離線 Reference、Coordinator 唯一提交或單次正式驗收等既定產品決策。正文、canonical state、failure taxonomy、部署 profile、正式驗收 Gate、里程碑和未驗證事項已同步更新。

最終獨立 builder check 以全新上下文閱讀完整 1713 行修訂版，逐項複查 host owner authority／cgroup、瀏覽器 flow revocation、Runtime Call Ledger／quarantine、budget、recovery-only、隔離 display 與 management/data 網絡；結果為 `nothing important left`。獨立 senior reviewer 在多輪回饋修正後的最終結論為 `No Critical or Important findings`、`Ready for implementation planning: Yes`。

上述結論只表示沒有阻止制定實施計劃的重要設計歧義；systemd／rootful Docker／ARM64、cgroup v2、UID／policy proxy、Chromium、Runtime Call Ledger、雙 bridge 與真實靶場行為仍須按上表里程碑實測。

### 審查邊界與核查來源

- 本輪基於現行設計全文、歷史評審對照、Runtime／恢復契約的獨立複核，以及 Playwright／Docker 官方資料；未執行 ARM64 鏡像或真實靶場測試。
- 固定完整首輪、單一 ARM64 Core、離線 Reference、Coordinator 唯一提交和單次正式驗收均按已確認決策評審，未將歷史的角色快路徑、固定 30 題等建議重新列為要求。
- Artifact GC 的候選疑點未列入正式 finding：§11.2，L1001 描述 transaction 失敗後的孤立產物回收，L1008 也未把「未引用」定義成可刪除的充分條件；現有文本不足以斷言會刪除發布中的文件。
- [Playwright BrowserContext 隔離](https://playwright.dev/docs/browser-contexts)：核對 context 的 Cookie／storage 隔離語義；逐題網絡身份仍須按固定 Chromium／Playwright 版本實測。
- [Docker Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/)：核對宿主發布地址、bridge 端口轉發與容器可達接口的區別。

## 第五輪：流程能力優先、校驗成本與 TSecBench 接入審查

日期：2026-10-15。

審查基線：[`2026-10-14-general-ctf-agent-system-design.md`](2026-10-14-general-ctf-agent-system-design.md)，**1713 行**，Git blob `451a535fc5d73609cd4d57d4465485834417f23e`。本節的 **D:Lx–Ly** 均指該設計版本。

本輪依使用者新要求，以「系統能順暢接題、持續試驗、修復、改路並取得平台接受」為第一優先，審查校驗／hash 成本、TSecBench 接入及開源 CTF Agent 的循環。**本節全部是審計建議，未寫回設計，也不表示實作或真實平台測試已完成。** 涉及固定完整首輪、存活執行器接管優先等歷史決策的建議，明確列為產品取捨重審，不作已批准變更。

### 本輪結論

1. **存在過度前置和過度泛化的控制設計。** 最突出的是把存活執行器接管、宿主 owner token／雙端 epoch 提交、逐動作 durable ledger、逐題圖形／代理／雙網絡完整組合列為首個解題閉環階段的共同要求。它們有各自的可靠性用途，但目前沒有成本／收益證據證明全部都應是首版入口條件。
2. **Hash 本身不是主要問題，hash 所綁定的同步等待、失效與重新驗證才是。** 保留原始輸入、已發布腳本和候選的內容身份有直接價值；把每個中間輸出、控制 receipt 或調試變化都變成決策前提，會擠壓解題流程。尚未實作，不能聲稱 hashing CPU 已成為性能瓶頸。
3. **TSecBench 尚未形成完整的現行專項接入契約。** 設計具備通用能力框架，但 2026-10-13 舊設計中的具體 API 映射沒有完整帶入現行文檔。任務憑證／計時、ready 等待、3 個活躍題目名額、稀疏 metadata、逐 flag 結果和恢復對帳都需要一份薄的內建 profile。
4. **高層做題循環已足夠，下一步應落實執行循環。** §7–9 已有假設、試驗、反證、局部修復、重規劃、長作業和驗證。開源實作最值得借鑑的是連續工具操作、真實錯誤回灌、可讀取的工作記憶和候選反饋，不是增加更多 Agent 或 hash。

優先級：**P1** = 優先於繼續加控制機制處理，會影響基本閉環或可用性；**P2** = 影響成本、兼容性或可靠接續，宜在對應功能落地時處理。以下是設計判斷，不把尚未實測的性能風險稱為已發生故障。

### A. 校驗與控制：保留什麼，縮減什麼

#### W01 · P1：恢復接管方案過重，M0 同時承擔了過多交付前提

**位置：D:L22、L80–90、L1206–1225、L1261–1286、L1290–1343、L1609–1615。性質：首版範圍與投入順序；涉及已確認的接管優先決策。**

為保留 Supervisor crash 後的存活作業，現版引入 host Fence Helper、systemd watchdog、pidfd 轉交、host journal、owner token、State mirror／commit-owner、cgroup 重新分層、proxy drain receipt 和 recovery-only 進程。M0 還同時要求兩種 VPN、雙 bridge、逐題 display／proxy、回連及受管通道。這已超出「復用 OpenCode、單容器交付、非敵對 sandbox」直覺下的薄產品層；單一鏡像也不再意味著單一部署依賴。

這些機制不能改善模型選路、腳本正確性或題目資料取得，卻都可能先阻斷啟動。尤其是保留存活 TCP／長計算的收益，需要用實際題型和中斷頻率證明，不能由恢復契約越完整就推定越值得。

**建議：** 把「安全停止舊執行活動＋保存已提交進度＋平台副作用對帳」與「跨 Supervisor incarnation 原地接管存活執行器」分開排序。首個垂直切片先驗證前者和一種已可用 VPN 路線；後者作高級恢復能力候選。若選擇簡化為 fail-stop／新 Core 恢復，必須明示原 TCP session 會 lost，且舊進程確實停止後才能開始新工作；不能只刪 fence 而保留原地接管承諾。雙 bridge、多 display 並發和第二種 VPN 可保留為後續交付要求，無須全部先於第一題的真實執行。

#### W02 · P1：將高風險副作用的 ledger／quarantine 泛化到所有 Runtime 動作

**位置：D:L846–879、L981、L1164–1174。性質：處置粒度過粗。**

`job.start` 去重有用，但現版把所有 job、browser navigation／fill、open／accept／write／close 都放入相同的 durable claim／unknown 模型。確認丟失即禁止後續調用，解除又依賴協定證據或權威 counter。對一次性 oracle、付費 Hint 或提交，這種保守處置合理；對可重建的本地計算、經 `http_session.request` 表達的已知無副作用查詢或已知可重做的表單填值，可能把一次普通工具錯誤升級成長期 `blocked_runtime`。現有 `job.status/read` 本身已是讀取例外，本項不把它們誤列為必須取得 dispatch claim 的操作。

**建議：** 保留同一次 RPC 的穩定 ID／job handle，按已知 effect 分配處理強度：

- 本地可重建任務：確認舊 job 已退出後，可用新 attempt 重跑；普通輸出和狀態記錄不必都走外部副作用式對帳。
- 已知可重試的觀察：有界重試並將錯誤交回 Solver；不能僅按 HTTP GET 或工具名稱推斷無副作用。
- 提交、Hint、實例變更、一次性狀態或硬遠端額度：保留發送前記錄、必要去重、unknown 和預算保守佔用。

共享 scope、deadline、身份檢查仍保留。改的是普通動作被卡住的機率及持久化粒度，不是讓任意腳本繞過已知限次規則。沒有已知硬額度的正常 Web 流程，也不應因尚未具備 metered Browser envelope 而不可用。

#### W03 · P2：Hash 應服務內容身份，不能成為每一步語義判定和重做的理由

**位置：D:L219、L465–503、L660–679、L741、L760–771、L1078–1099、L1130–1140、L1280、L1412。性質：資訊重複、失效粒度和實作成本。**

現版同時有 `stage_revision`、input refs／hashes、candidate／solution hash、call payload hash、policy hash，以及 flow set／cgroup identity／inflight result／resource set hash。這些字段用途不同，不能因都是 hash 就全刪；也不宜要求 Agent 重複產生、核對和傳遞全部摘要。§8.11 已明確 hash 不證明自然語言主張，應沿用這一界線。

**最值得縮減的是 D:L502：解法內容 hash 變化就新建 Engineering／Verification revision。** 調試副本加日誌、註釋或重排輸出，不應自動失效已發布且未變的候選／解法。簡單做法是保留原已驗證版本供提交；只有真的改用新產物或依賴失效時再驗證。無須另造「語義 hash」來猜兩段程式等價。

| Hash／校驗用途 | 本輪判斷 | 最小處理建議 |
| --- | --- | --- |
| 原始附件、已發布腳本、Verifier 使用的證據版本 | 保留 | 下載／發布時由 Runtime 計算一次，以 immutable artifact ref 傳遞；不要求每個角色重掃整份內容 |
| Candidate bytes／提交去重 | 保留 | 保留精確值引用、題目與必要 generation；模型不手算 hash |
| 同一 call ID 的 payload 衝突 | 保留必要用途 | 用於防止重試被誤認為另一個 effect，不擴張為每次推理前置證明 |
| Misc 轉換 DAG 和循環去重 | 保留 | Hash 真正被保存／後續消費的產物；避免為每個純記憶體中間值另建封存流程 |
| 同時記 stage revision、artifact ID、完整 input hash 清單 | 可合併表示 | 引用已有 immutable artifact 和依賴版本，由服務解析，避免模型重複搬運 metadata |
| Flow set／cgroup identity／inflight result／resource set hash | 後置審計資料 | 首版判斷依據應是實際停止／socket 狀態、owner 與 generation；對狀態清單取 hash 不會額外證明其真實性 |
| Supervisor executable hash 作 bootstrap 前提 | 與高級 host helper 一起重估 | 在明確非敵對、固定鏡像部署中，先論證是否需要此產品層驗證，不能用它替代真實 process identity |
| 每次 excerpt／分類轉換的 hash | 優先復用引用 | 使用已知來源 artifact＋byte range＋規則版本；必要時再封存輸出，避免重複同步 I/O |

目前沒有證據顯示現版一定逐次重新計算所有 hash；本項是防止實施把「保存內容身份」誤做成「每一跳重算和阻塞」。真正要量測的是額外 I/O、交易等待、上下文 metadata 和重新跑角色的成本。

#### W04 · P1：把工具即時觀察綁到證據封存，會使交互能力受非求解流程支配

**位置：D:L911、L1130–1140、L675–677。性質：讀取路徑和持久證據混用。**

`job.read` 只返回已封存 prefix，artifact transaction 成功後才對 Agent 可見。這能保證引用一致，但 PTY 提示符、TCP banner、小段 stderr 和長作業進度也是 Solver 決定下一步的必要輸入；它們不是每次都要成為 Verifier 證據。若 flush／封存延遲偏大，Agent 會以為仍在等待，甚至錯過協定時限。

**建議：** 普通工具觀察可直接用 job ID＋cursor 返回當前可讀 bytes 和明確狀態；只有被交接、用於候選驗證或 checkpoint 的部分才要求固定版本封存。未封存觀察不能冒充可恢復 evidence，兩者的區別由 Runtime 處理，不新增模型審批回合。若維持 chunk 模型，至少應證明交互讀取可立即 flush 所需片段，不被完整 artifact 打包和其他題的狀態提交阻塞。

#### W05 · P2：完整角色覆蓋與重驗要求的優先級，可能壓過得分和繼續探索

**位置：D:L38–43、L400–412、L485–503、L595–631、L657–681、L1524。性質：產品取捨，並非現行規則自相矛盾。**

無候選也必須安排 Engineer／Verifier，每道 Hard 題也要預留完整 coverage；即使已達得分門檻，缺角色執行仍令 Gate 失敗。這保證流程一致性，但也明確消耗可用來做下一個有效試驗的模型時間。多 flag 或小型解碼題可能在每個候選後反覆排隊驗證，而平台才是最終答案 oracle。

**建議：** 先量測首個有效實驗延遲、各角色時間／token、候選到 accepted 延遲和重驗次數。優先落實既有的結果復用、局部回退和 evidence-audit；把 Engineer 定位為整理 Solver 已有可運行成果，不是普通腳本修錯的中轉。若成本顯著，再重審是否要求「無候選也必須獨立 LLM 驗證」和「所有題完整覆蓋比得分更優先」。可以保留責任與可追溯輸出，而不必把每個責任永久綁成每題一次獨立模型會話；這一變更須作為產品決策，而非實作者偷偷跳過既定角色。

### B. TSecBench：具體接入完整性

核查了官網公開接入文檔／前端與 `tsec-benchmark 0.1.2` 發布包。現行設計 D:L7 明確取代舊稿，因此不能把舊稿 §3、§4.3 已寫過的具體 TSecBench 映射，默認算作現行專項規格。以下以公開的 **Challenges API** 為準；網頁控制台 API 使用不同登入身份，不能自動視為任務 Token 可用能力。

#### 接入覆蓋表

| 項目 | 已核實的公開契約 | 現版覆蓋／需要補足 |
| --- | --- | --- |
| 任務入口 | 使用者先建任務，取得 `BENCHMARK_TOKEN`、`BENCHMARK_BASE_URL` 和 VPN；SDK 不建任務、不連 VPN。[TS1]、[TS2] | D:§5.1／5.3 是通用入口，缺已有任務的 API-only 分支和 task identity 匯入 |
| 認證／路徑 | Header `BENCHMARK_TOKEN`；五個端點使用 `/openapi/v1/challenges`；無效／缺失 Token 為 `404 task_not_found`。[TS1] | 需要具體 profile；不能用網頁 Cookie 或抄 PyPI README 的舊 `/api/v1/challenges` |
| VPN 預檢 | `GET http://10.0.100.58`，HTTP 200 且 `status == "ok"`；SDK context 默認先做檢查。[TS1]、[TS2] | D:L551、§12 有通用 Doctor，缺此平台檢查在真實執行網絡的明確落點；不應將 HTTP 改成 HTTPS |
| 進度列表 | 單次 GET 返回當前任務全部題目，無分頁參數；主鍵 `unique_code`。[TS1] §5.1 | 從 list 合成本地 `challenge.get/instance.status` 即可，不需虛構新的查詢端點或通用分頁 |
| 題目材料 | `description` 可 null；`difficulty` 是字串，`level` 是整數關卡；無 category／附件清單字段。[TS1] §5.1 | D:§8.2 可 Triage，但缺題面稀疏時的材料取得順序；不能由 ID 前綴或 level 猜可靠類別／難度 |
| 容器狀態／入口 | `pending/available/stop_pending/stopped`；列表僅 available 有有效地址；`container_addr` 是多個 `IP:port`。[TS1] §5.1–5.2 | D:§8.1 有抽象狀態，需明確映射、等待 ready、交付全部地址及辨識協定 |
| 活躍名額 | 公開文檔規定最多同時啟動 3 題；超額 start 為 `409 invalid_state`。[TS1] §5.2 | Worker 上限、browser slots 和平台實例名額是不同資源；pending／stop_pending 如何佔額須 fixture 確認 |
| 提交／完成 | JSON `{unique_code, flag}`，長度 1–4096；200 仍可能 `correct=false`；回傳 matched index、正確數／總數；全數正確或列表 `is_completed` 才是整題完成。[TS1] §5.4 | D:§8.7 已有正確框架，需要字段歸一化及拒絕後繼續求解路徑 |
| 分數／重複 | `awarded` 為本次分，`cumulative_score` 是該題累計分；`total_score` 是該題滿分；重複已正確 slot 回 `409 duplicate`，不再次加分。[TS1] | D:L645 已禁止重複累加；需明示作用域，duplicate 不自動算本 run 新成果 |
| Hint | GET 有扣分副作用，影響該題後續正確 flag；響應只回 `unique_code/hint`，hint 可 null；通關後拒絕。[TS1] §5.3 | D:L643–645 對成本未知不自動取 Hint 已合理；缺比例／已查看查詢不是要求另造控制的理由 |
| 任務時間 | 公開運行頁顯示 pending 接入倒計時，並說明收到 API 調用後轉 running；頁面用 duration／elapsed 計時。[TS3] | 五個公開題目接口未提供截止時間；D:L356、L685 的 deadline 原則需接到真實任務時間來源 |
| 關閉／恢復 | `POST …/close` 關閉題目容器；SDK client `close/aclose` 只關閉客戶端。公開題目 API 無任務 create/resume、instance extend、submission history 或 operation-ID 查詢。[TS1]、[TS2] | 缺的 capability 標 unsupported／unknown；不能讓所有求解都等待不存在的接口 |

#### T01 · P1：任務接入與首次調用計時未閉環

**位置：D:L235–245、L356、L551、L685–687；來源：[TS1]–[TS3]。**

現版把從 URL 的瀏覽器探索作為總流程，雖然 D:L283 已允許 API-only 資源授權，仍沒有說明已持有 TSecBench Token 時如何直接接入。更重要的是，首次 list 可能就是平台開始計時的接入動作；在此之前／之後安排大量 Doctor、頁面 bootstrap 或全題分類，會佔用接入等待時間或正式任務時間。

**最小建議：** 以現有 Platform Service 包裝固定 SDK 或五個 HTTP 接口，明確「環境／工具準備 → 匯入已建立任務的憑證與 VPN → VPN 預檢 → 首次 list → 啟動／解題」的順序。任務頁面或使用者提供的可靠時間資料補足公共 API 缺失的 deadline，始終沿用平台已消耗時間。任務創建／結束先由使用者處理即可，無須先做網頁控制台全自動化。計時觸發的精確伺服器規則仍待實測，前端文案不能替代後端保證。

#### T02 · P1：正常啟動、就緒、換題和業務錯誤尚無固定映射

**位置：D:L294–311、L524–525、L649–655、L969–990、L1434；來源：[TS1]、[TS2]。**

SDK 的 start 方法不包辦 ready 輪詢；單有 `resource_state` 與功能測試清單，不能決定遇到 pending、沒有地址或名額滿時下一步怎麼走。`invalid_state` 同時用於任務已結束、活躍名額滿、通關後取 Hint，若一律終止整個 run，正常調度也會中斷。官網 Agent Prompt 的簡化終止說明亦有「任意 invalid_state 即結束」的過寬表述，不能直接抄成程式規則。

**最小建議：** 在 TSecBench profile 中以操作＋code＋已知 message／狀態，映射 wait-ready、釋放自有名額後 start、跳過 Hint、參數修正、換題或全 run 結束。start 後由 list 觀察 available，向 Solver 交付全部地址；完成、放棄或為名額切題時 close，並確認停止狀態。這是正常業務路徑，優先級高於增加通用防繞過證明。

#### T03 · P2：Metadata 和可選查詢缺失，不應變成所有題無法開始的前提

**位置：D:L254–256、L294–309、L547–554、L1499–1509；來源：[TS1] §5.1、[TS2]。**

TSecBench 合法響應可以沒有題目描述、category、附件列表、Hint 狀態或已得分快照。現版正式 admission 要求完整題面／分類和可核實乾淨基線，卻沒有把這些資料不足接到可執行接入流程。把通用 `attachment.download/score.status/submission.history` 當作平台必備接口，會使缺失的可選能力拖住整個 run。

**最小建議：** 用描述中的明確鏈接、已授權題目入口的有界前置觀察或使用者附件取得材料；資料足夠後再分類。`challenge.get/instance.status` 從 list 合成，其餘不可查部分明示限制。新任務的創建證據可用於乾淨基線，不能因 API 沒字段就當零；仍無法證明時可走已有 Live 流程，而不是宣稱 TSecBench 不可解。Hint 成本未知按現有規則停用該功能，不阻斷正常解題。

#### T04 · P2：判題與恢復需適配「進度快照可查，完整歷史不可查」

**位置：D:L645、L660–681、L1154–1162、L1232、L1503–1509；來源：[TS1] §5.1／5.4、[TS2]。**

公開列表能恢復完成計數與容器狀態，不能完整重建 Hint 購買、錯誤提交次數、逐 slot 歷史或精確已得分。現版通用 unknown 對帳原則正確，但尚未說明每種操作具體能恢復多少。容易出現兩種錯誤：用正確 flag 數推算扣 Hint 後得分，或因一項歷史不可查而放棄所有仍可進行的工作。

**最小建議：** 按 task identity＋`unique_code` 保存服務端結果；`cumulative_score` 覆蓋該題快照，跨題再求和，`awarded` 不因 response 重放再次累加。submit 200 必須看 `correct`，部分接受後繼續找剩餘 flag。start／close 用 list 對帳可見狀態；submit／hint 只對未知副作用隔離，不能假裝所有操作有通用冪等鍵。`duplicate` 能證明已計過該 flag，不能單獨證明本 run 的新得分或允許盲重試錯誤候選。

**接入邊界補充：** 官網目前將本地模式標為開發／調試及自行參考成績，官方認證打榜使用托管模式，部分活動只允許托管。[TS4] 現有 ARM64 Core 對接更直接對應本地模式；自家的 `formal_gate` 不等於 TSecBench 官方認證。托管包規範、宿主 helper 權限及運行環境未核實，不能把它們算作已支援，也不需要為先跑本地閉環立即擴建托管部署。

### C. 開源 CTF Agent 對照與循環完整性

核查 **3 個開源倉庫中的 4 套實作**，固定下列提交；EnIGMA 使用官方項目指向的 SWE-agent `v0.7` 分支。NYU baseline 與 D-CIPHER 共用倉庫，不能當作兩個獨立來源的重複實證。研究是靜態源碼比對，未執行它們的 benchmark。

| 實作／固定提交 | 實際循環與工具機制 | 對當前設計的啟示 |
| --- | --- | --- |
| EnIGMA／`SWE-agent/SWE-agent`，`084d5d164729ddcbe8fbc05877ead403549ef669` | Agent 執行 action 後把 observation 放回對話；`InteractiveSession` 保存 connect／gdb 進程，處理讀寫、超時和中斷；編輯工具可返回 lint 錯誤並回退失敗修改。[OS1a]、[OS1b]、[OS1c] | 保留可用的互動工具與低摩擦改碼—執行—錯誤回灌。不要把專用互動進程誇成通用 durable job／跨 Worker 接管 |
| NYU CTF baseline／`nyuctf_agents`，`612190f298ae9e604f00370019beed4ba1f372f6` | 單 Agent 多輪工具循環；命令回 stdout／stderr／returncode／timeout；建立腳本、檢查 flag；未知工具和參數／工具異常回傳模型下一輪。[OS2a]、[OS2b] | 第一優先是工具錯誤真的回到 Solver 並被修正；容器持久不等於持久 shell／PTY |
| D-CIPHER／同一 `nyuctf_agents` 提交 | Planner 委派任務，Executor 在共享環境內自主做多輪工具操作，結束才把 summary 回 Planner；新 Executor 對話不等於靶機 reset；可裁剪較舊 observations。[OS3a]、[OS3b]、[OS3c] | 借鑑任務級委派、任務內連續執行；不要每條命令都重新跑 Strategy。需要短工作集，而非新增記憶 Agent |
| Cybench `SimpleAgent`／`andyzorigin/cybench`，`ca483c6443f17a20ba7d6bac3d274859a1721e51` | Prompt 維護計劃／狀態和下一命令；程式解析 shell 命令、同步執行、追加 observation，保留有限歷史；輸出 ANSWER 後計分並結束子題。[OS4a]、[OS4b] | 借鑑明確下一動作與上下文裁剪；其人工 prompt 交互模式不是 PTY 工具，也不能把一次 ANSWER 結束當作真實平台拒絕後的完整循環 |

以上實作的默認路徑未要求每條候選都獨立跑完整 Engineer／Verifier 流水線，但不能據此證明刪角色必然提高解出率。它們也存在已知 flag 檢查、引導子任務、同步命令 timeout 等 benchmark 特有條件：例如 D-CIPHER 會檢查工具／消息中是否包含已知 flag，[OS3d] 不能移植為未知答案比賽中的 solved 判定。EnIGMA 底層錯誤 flag 和上層 submit 終止邏輯亦不能僅憑提示詞推斷會持續重試。[OS1d]

#### L01 · P1：高層循環已齊全，缺的是低摩擦的單題執行路徑

**位置：D:L483–503、L705–741、L807–848、L956–990、L1578–1613。**

現版已有一張實驗卡多個有序工具步驟、局部修復、語義反證、長任務 completion event 和 Critic，不宜再報成「沒有 retry/replan」。但具體工具接口主要列出 job／channel 控制，文件讀取／搜索／局部改碼、錯誤輸出的返回形狀、完成事件怎樣喚醒原實驗，以及 Solver 何時必須交 Strategy，仍比控制層契約模糊。

**建議將既有流程落到以下最小執行粒度，無須新增角色：**

```text
選題／取得材料／ready
  -> 已有 Triage、Recon、Reference、Strategy 交付一個可執行任務
  -> Solver 在同一任務內循環：讀／改腳本 -> 運行 -> 消費真實觀察
       工具或表示錯誤：本地有界修復後繼續
       前提被否定／修復耗盡／窗口結束：把結論交 Strategy 改路
       長作業：保存 job handle／下一動作，完成事件喚醒後續跑
       候選：封存必要產物 -> Engineer／合適的 Verifier 模式 -> 提交
  -> accepted/partial 繼續剩餘目標；明確拒絕返回診斷；未知結果走對帳
  -> 無路線或預算用盡才 checkpoint／切題
```

文件工具可復用 OpenCode 已有能力並保留 workspace 限制；參數／語法／解析修正不應每次重新派發完整角色流水線。M0 已有單題閉環要求，應先用真實工具與模型展示一次失敗修腳本、一次前提反證改路及一次平台接受，而不只以角色 JSON 齊全通過；完整 portfolio 調度再留到 M4。

#### L02 · P2：上下文壓縮和提交拒絕後的接續，需少量實證而不是更多狀態種類

**位置：D:L437–446、L461、L500–503、L679–681、L1234、L1396–1416。**

Snapshot 已包含主線、失敗 fingerprint、作業、預算和下一步，方向正確。現有 compaction 測試主要關注資料是否經 Gateway，尚未直接驗證「壓縮後還會做對的下一步」。同樣，平台拒絕被記為新事件，但拒絕之後回到哪個診斷／修正層，缺少一條實際軌跡。

**最小建議：**

- 用既有 snapshot 保存／引用最新腳本及命令、已否定路線、關鍵中間結果、active job/channel/cursor、剩餘預算和下一動作；強制 compaction／新 session 後驗證能續跑、不重做失敗路線。摘要要能回取原始輸出，不能只剩各角色互相摘要。
- 明確拒絕候選時先檢查提取／編碼／題目／slot／generation，保留仍有效的機制證據；不要把 `verified` 當成不能再修改的解題結論，也不要把「新 session」誤作「靶機已 reset」。
- 在受控 fixture 測一次錯誤候選反饋、一次同連線 oracle 跨多輪及一次長作業完成後續跑即可。這些補到既有正向場景，無須另建重型測試框架。

固定 excerpt 上限、禁止 bulk 外送和資料分類也是流程能力的取捨：保護控制憑證與避免整包附件外送有價值，但 byte 上限不證明資訊相關性。應先測試源碼、數學參數和原始錯誤是否仍可按需讀回；若大量題因缺關鍵上下文而 `blocked_data`，再重審大小策略，不能以增加 hash 掩蓋資訊不可見。

### D. 建議的收斂順序與最小保留集

後續若調整設計，建議按以下順序，不把本輪每條意見再轉成一套新的全域 Gate：

1. **先形成一條 TSecBench 薄適配閉環。** 已有任務＋VPN 預檢＋list/start/ready＋單題求解＋逐 flag submit＋close／切題；正常業務錯誤能回到正確分支。
2. **先讓 Solver 連續工作。** 明確文件工具、腳本編輯執行、stdout／stderr、交互讀寫、完成事件、局部修復和壓縮後工作記憶；用真實執行軌跡驗證。
3. **縮減 hot path。** Hash 在產物發布邊界計算；普通觀察不等待完整證據封存；局部可重建動作不套用一次性遠端副作用的全部隔離規則。
4. **以成本決定高級能力的先後。** 比較第一個有效實驗耗時、候選到 accepted 耗時、角色／控制開銷、無謂 blocked、實際錯誤恢復和得分；再決定完整角色覆蓋與存活 executor adoption 的範圍。
5. **最後擴展交付矩陣。** 完整多題 portfolio、多 display 並發、兩套 VPN／雙 bridge 和高級 host helper 恢復按已確認取捨逐步驗證，不搶在單題正向循環前。

建議始終保留的最小正確性能力：正確題目／任務綁定、必要 scope／憑證保護、deadline／真實硬額度、作業 timeout／取消、平台副作用去重與未知結果對帳、不可變的關鍵輸入／候選版本、平台權威 solved 判定。**精簡不等於關掉這些能力，也不等於允許未知副作用盲重試。**

### 本輪來源與證據邊界

- 設計及歷史：現行 1713 行設計全文；本 review 前四輪；舊設計 `2026-10-13-ctf-solving-agent-design.md:53–111,140–166`。舊設計僅作接入細節沿革，不重新宣稱其所有產品決策有效。
- TSecBench：2026-10-15 公開官網接入文檔、運行／模式頁靜態來源及 PyPI `tsec-benchmark 0.1.2`。SDK 包內核查 `client.py:38–46,63–203`、`models.py:13–113`、`errors.py:89–116,154–182`、`sync.py:101–129` 及公開 mock tests；未安裝／執行 SDK。PyPI 未提供可確認的官方源碼倉庫 URL，故以發布包版本標識，不虛構 commit。
- TSecBench 文檔存在版本差異：PyPI README 仍出現 `/api/v1/challenges`，SDK 說明中的 `level: str`／description 非 nullable 亦與 API schema 不一致；發布源碼與官網 Challenges API 為 `/openapi/v1/challenges`、`level: int`、description 可 null。實作應參照具體版本和實際響應，不能只複製 README。
- 任務首調計時、各狀態佔用名額、重啟後 flag／地址／進度、重複 start/close、Hint 重複／null 的計費、錯誤提交是否計次、VPN 在 ARM64 的實際兼容性仍待官方確認或真實 fixture。前端下載 `.ovpn` 是格式線索，不是 VPN 已可運行的證據。
- 開源比較固定以下 commit；版本日期／star 數和 README 描述都不能替代源碼行為。沒有在不同題集、模型、預算、在線依賴或已知答案條件下比較解出率，也沒有把靜態審查當作能力實測。
- 本輪沒有建立評測任務、調用私有題目接口、連接靶場 VPN 或執行利用；沒有改動系統設計。

[TS1]: https://tsecbench.zc.tencent.com/assets/IntegrationGuide-D1tNIJQj.js "官網內嵌 Agent Prompt、SDK 及 Challenges API 文檔；重點 API §1–5.5"
[TS2]: https://pypi.org/pypi/tsec-benchmark/0.1.2/json "SDK 0.1.2 發布元資料；含 wheel/sdist 下載來源"
[TS3]: https://tsecbench.zc.tencent.com/assets/BenchmarkRunningView-CaR-63bG.js "公開前端：pending_remain_seconds、duration_seconds、elapsed_seconds 與 API 接入提示"
[TS4]: https://tsecbench.zc.tencent.com/assets/BenchmarkModeView-B30HkZ3R.js "公開前端：本地／托管模式及活動限制"
[OS1a]: https://github.com/SWE-agent/SWE-agent/blob/084d5d164729ddcbe8fbc05877ead403549ef669/sweagent/agent/agents.py#L964-L1067 "EnIGMA action-observation 循環"
[OS1b]: https://github.com/SWE-agent/SWE-agent/blob/084d5d164729ddcbe8fbc05877ead403549ef669/sweagent/agent/interactive_commands.py#L114-L211 "持久交互會話的讀寫、超時和中斷"
[OS1c]: https://github.com/SWE-agent/SWE-agent/blob/084d5d164729ddcbe8fbc05877ead403549ef669/config/commands/edit_linting.sh#L49-L129 "腳本編輯、lint 及回退"
[OS1d]: https://github.com/SWE-agent/SWE-agent/blob/084d5d164729ddcbe8fbc05877ead403549ef669/sweagent/agent/agents.py#L942-L955 "上層 submit 終止處理，不能由底層 Wrong flag 提示推斷重試"
[OS2a]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/nyuctf_baseline/conversation.py#L49-L150 "Baseline 工具循環和錯誤回灌"
[OS2b]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/nyuctf_baseline/tools/tools.py#L14-L128 "命令、腳本及 flag 檢查工具"
[OS3a]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/nyuctf_multiagent/agent.py#L481-L562 "D-CIPHER 委派與 Executor 內循環"
[OS3b]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/nyuctf_multiagent/conversation.py#L33-L99 "Observation 裁剪與輸出限額"
[OS3c]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/configs/dcipher/base_planner_executor.yaml#L1-L39 "Planner/Executor 配置與工具集"
[OS3d]: https://github.com/NYU-LLM-CTF/nyuctf_agents/blob/612190f298ae9e604f00370019beed4ba1f372f6/nyuctf_multiagent/agent.py#L33-L61 "Benchmark 已知 flag 判定"
[OS4a]: https://github.com/andyzorigin/cybench/blob/ca483c6443f17a20ba7d6bac3d274859a1721e51/agent/prompt.py#L12-L27 "Cybench SimpleAgent 工作計劃與下一命令"
[OS4b]: https://github.com/andyzorigin/cybench/blob/ca483c6443f17a20ba7d6bac3d274859a1721e51/agent/agent.py#L472-L679 "上下文裁剪、工具循環及 ANSWER 計分"
