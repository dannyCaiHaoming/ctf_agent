> 🟢 **权威设计 spec（current）** · 一切以本文为准。配套路线图见 [`../plans/2026-10-16-ctf-agent-mvp-roadmap.md`](../plans/2026-10-16-ctf-agent-mvp-roadmap.md)，文档索引见 [`../README.md`](../README.md)。

# 通用 CTF 解題 Agent 系統設計

建立日期：2026-10-14
本輪修訂：2026-10-20（API 主線與自主首題計畫同步；無實作或執行授權）

狀態：**已確認設計；歷史交付與當前切片以 roadmap／各 plan 的證據為準。** 本文描述要建造的系統，不代表功能已實現、Docker 鏡像已構建或真實比賽成績已取得。

本文取代同名文件的 1713 行版本，吸收 `2026-10-14-general-ctf-agent-design-review.md` 第五輪審查及後續 brainstorming 決策，作為後續實施規劃的唯一現行設計依據。舊設計和 review 保留為決策歷史，不自動構成現行要求。

## 1. 意圖與設計摘要

本系統是一個通用 CTF 解題 Agent。使用者提供已授權的平台或本地靶場入口、必要登入引用和運行邊界；系統自行取得題目、管理平台實例、分析附件、執行解題試驗、驗證候選並提交 flag。首批解題範圍為 Web、Misc、Crypto。

首要目標是讓 Agent 能順暢完成以下真實循環，而不是先建造完整容器控制平面：

```text
取得題目與材料
  -> 建立可反證假設與最小試驗
  -> 同一 Solver 連續讀／改腳本、執行、觀察、局部修復
  -> 前提被否定時改路
  -> 產生候選、獨立驗證、平台提交
  -> accepted／partial／rejected 後繼續正確分支
```

開發採 **host-first** 路線。第一階段在 macOS／Linux 工作區直接運行 OpenCode、Supervisor、State、Platform Adapter 和 Tool Runtime，先用 fixture 和真實 TSecBench 任務驗證 Agent 能力；完成多題功能軌跡後，才用一鍵腳本封裝為 Ubuntu ARM64 Docker Core 並重跑相同契約。Docker 是交付和隔離 profile，不是解題能力開發的前置條件。

系統復用 OpenCode 的模型、會話、工具調用和 Agent 內循環，不另造通用 Agent framework。本專案增加薄的產品控制層，負責：

- 綁定 run、challenge、task、workspace、scope、deadline、預算和權限。
- 將平台 Token 和平台副作用隔離在 Platform Service。
- 提供可交互的工具作業、即時輸出、長作業和必要的受管限次通道。
- 保存可恢復的 canonical state、不可變發布產物和候選證據。
- 在多題之間按預期剩餘得分／時間調度。
- 在 Agent 能力通過後，一鍵封裝並驗證 Ubuntu ARM64 Core。

## 2. 已確認的產品決策

| 主題 | 決策 |
| --- | --- |
| 開發順序 | 先在 macOS／Linux `host-dev` 驗證 Agent 能力；多題功能 Gate 通過後才首次構建 Docker 鏡像 |
| 第一平台 | TSecBench 本地/API 模式先行；之後依序加入 CTFd、rCTF，未知平台最後 |
| TSecBench 任務 | 使用者先建立任務並提供 `BENCHMARK_TOKEN`、`BENCHMARK_BASE_URL` 和宿主 VPN；首版不自動化網頁任務建立 |
| TSecBench 計時 | 本地準備完成後由明確 `start` 首次調用 Challenges API；正式模式需另有任務頁提供的 duration／elapsed／deadline 證據，因 Challenges API 本身不返回時間 |
| TSecBench 模式 | Host 與自建 Core 的本地運行只算本產品結果，不宣稱支援官方托管認證模式 |
| 輸入方式 | 使用者提供平台或本地靶場入口；本地模式不要求另寫 manifest |
| 本地 Oracle | 沒有權威提交／完成接口時仍解題和驗證候選，但不能計為 solved 或正式通過 |
| 解題範圍 | Web、Misc、Crypto；其他類別列出但不納入首版求解承諾 |
| Agent 編排 | 職責固定、會話自適應；不要求每題每項職責都建立獨立 LLM session |
| Solver 循環 | 普通文件操作、腳本修正和工具錯誤留在同一 Solver 任務；前提反證或 repair budget 耗盡才交 Strategy 改路 |
| Engineer／Verifier | 只有 candidate path 強制 Engineer 發布與獨立 Verifier 核對；無候選的部分成果整理是可選工作，不影響 Gate |
| 提交 | Solver 產生候選，Coordinator 是唯一提交提出者，Platform Service 是唯一執行者 |
| Runtime 強度 | 本地可重建、可重試觀察、受保護副作用三類分級，不把所有動作放入相同 unknown/quarantine 模型 |
| 工具輸出 | 即時 observation 可由 cursor 直接讀取；只有 handoff、checkpoint、candidate、verification 所需內容必須封存 |
| Hash | 用於原始輸入、已發布腳本、候選、證據和受保護 call identity；不作每一步自然語言真偽或流程完整性的替代證明 |
| 異常恢復 | 首版採整體 fail-stop/checkpoint；確認舊進程樹或舊 Core 已停止後才以新 incarnation 續跑 |
| 存活執行器接管 | 不屬首版承諾；只有實測中斷頻率和重算成本證明收益後才另立設計 |
| VPN | Host-first 與首批鏡像先驗證宿主 VPN；容器 VPN 後移 |
| 瀏覽器 | 首個閉環只需一個按題啟動、受 scope 限制的 Playwright Challenge Browser；多 display、noVNC 和多題瀏覽器並發後移 |
| 多題 | TSecBench 最多三個活躍實例作獨立平台預算；Worker、Browser slot 和 instance slot 不混為同一資源 |
| 打包 Gate | Fixture、真實單題 accepted 及 host 多題功能軌跡通過後，才首次構建 Ubuntu ARM64 Core |
| Docker | 最終交付使用單一 `ctf-agent:core-arm64` 鏡像；不把它當作可承受惡意程式的安全 sandbox |
| Formal Core 出站 | 不要求雙 bridge 才能解題，但所有 Tool job／Browser 必須受最小 egress allowlist 約束，不能訪問公共搜索、provider 直連、平台控制面或非本題 target |
| 工具 | Agent 可組合預裝命令和腳本；運行中的 Agent 不安裝依賴 |
| 限次 Oracle | 有硬 request／query／connection 上限或一次性狀態時，強制使用可計量受管通道；結果不明不盲重發 |
| Scheduler | 以預期剩餘增量分數／剩餘牆鐘時間排序；token、實例、Hint 和硬遠端額度作預算約束 |
| Reference | 使用完整、已批准、完全離線的固定 snapshot；同一 run 不熱更新共享知識 |
| 公共外網 | 正式運行只允許模型、平台、已授權靶機和必要基礎服務，不允許公共搜索 |
| 模型資料 | 只發送解題必要內容；控制面 credential 永不進入模型；大資料保留本地並按需回取片段 |
| 正式驗收 | 保留原 easy／medium／unknown 解出率門檻和零虛假成功；刪除「每題七角色全部派發」作為通過條件 |
| 模型能力 Gate | 確定性 contract／fixture 必須全過；M1 每條模型軌跡固定配置獨立運行 3 次，至少 2 次成功並報告全部結果 |
| 正式人工介入 | 計時後只允許可證明無題目副作用的 secret refresh／VPN 恢復；人工解題或 Challenge Browser 操作使結果 invalid |

### 2.1 近期執行順序與能力聲明（2026-10-20）

產品主線為 **API 接題 → OpenCode 自主解題 → 控制層 API 提交**。Platform Service 管理平台憑據和副作用，Solver 只處理題面、公開材料與授權目標。平台網頁自動導航不是首題前置；Challenge Browser 按實際解題需要使用。

近期先以一道現成本地 Web CTF 的原始題面、入口與公開附件取得自主整題證據，再做 M2 單題 API live。首題可復用 local oracle，無須先架設比賽網站或人造接題 API；它不能冒充 API 接題／提交成果。詳細範圍、預算提案與停止點見 [自主首题主线](../plans/2026-10-20-autonomous-first-challenge-plan.md)。

自主成功要求：無額外 payload／解法／答案提示及人工解題介入，真實工具求得 flag、獨立驗證通過、可信 oracle 確認單 flag 或整題完成。給定查詢的 verified finding、部分 flag accepted 和模型自述均不替代整題 solved。公開題的一次成功只證明該題，不聲稱無訓練污染或泛化解題率。

**舊 M1／M1B 軌跡開發與驗收已凍結**：①②歷史結果保留，③–⑥未完成，不繼續任一軌跡。原 M1B §0.5 由獨立自主首題計畫取代。它們不作首題探索或 M2 首次單題 live 的全部前置，不以此取消其後續取證要求。既有安全邊界與必要接線檢查維持；不新增通用框架、fixture 或 gate。未完成能力不得隨首題成功一併標完成。

本輪凍結與主線修訂僅授權文件更新，保留未提交程式與證據，不實作、不跑模型、不啟動 TSecBench、不提交。後續逐切片實施與逐批 token 授權獨立。

## 3. 目標、非目標、前提與反目標

### 3.1 目標

- 從已授權入口建立完整 challenge manifest，保留穩定 challenge identity 和初始平台狀態。
- 在同一 Solver 任務中完成真實的編輯、執行、錯誤回灌、局部修復和前提反證後改路。
- 支持 Web、Misc、Crypto 的單題與多題解題，包含多 flag、partial、互動 PTY/TCP 和長任務。
- 讓平台明確接受或本地等價 oracle 成為 solved 的唯一最終依據，做到零虛假成功。
- 在 TSecBench 上處理 list、start、ready、Hint、submit、close、三個活躍實例和稀疏 metadata。
- 在 compaction、session 重建或 fail-stop 後，沿用 checkpoint 做正確的下一步，而不是重做失敗路線。
- 讓 host-dev 和 Core 鏡像共用服務契約、狀態 schema、fixture 和 Agent 行為測試。
- 在多題之間按剩餘價值調度，保留 accepted 得分和可重用的題內成果。

### 3.2 非目標

- 首版不承諾 Pwn、Reverse、Mobile、Blockchain、Cloud 等領域的完整解題能力。
- 首版不支援 TSecBench 官方托管模式、網頁任務建立或官方認證成績歸因。
- 首版不承諾 Supervisor 崩潰後原地接管存活 PTY、TCP、瀏覽器或長計算。
- Host-dev 不作正式隔離環境，不可用來聲稱 Docker／ARM64、網絡隔離或正式驗收已通過。
- 首個 Agent 閉環不要求 noVNC、多 display、雙 bridge、容器 VPN、多 Challenge Browser 或 callback listener。
- 首版不控制宿主 Docker daemon，不把 `/var/run/docker.sock` 掛入 Core。
- 正式運行不使用搜索引擎、GitHub、在線文檔、公開 writeup 或運行時安裝。
- 首版不保證繞過 CAPTCHA、MFA、反機器人或平台規則限制。
- Core 和 host-dev 都不承諾安全分析故意逃逸、竊取同機秘密或耗盡宿主的惡意程式。

### 3.3 使用前提

- 使用者確認對入口、帳號、題目、地址和平台操作具有授權。
- 使用者只在允許 AI、自動化、既有離線資料和本地工具的活動中運行本系統。
- Host-dev 僅用於可信 fixture、已授權靶場和開發者可接受在宿主執行的題目資料／腳本。
- 真實 TSecBench 開發任務由使用者建立，且任務、Token、VPN 和可能的計時／配額消耗均已獲同意。
- 題目附件和 Agent 生成腳本位於同一開發或 Core 信任邊界；產品不把它們視為敵對 sandbox workload。

### 3.4 反目標

即使程式能啟動，出現以下情況仍視為設計失敗：

- Docker、host fencing、角色 JSON 或 hash 管理長期阻塞第一個真實工具試驗。
- 工具錯誤沒有回到 Solver，或每次改一行腳本都重新派完整角色流水線。
- `job.read` 必須等待整份證據封存，導致 PTY、TCP 或長作業反饋不可用。
- 普通本地動作的確認丟失被升級為整題長期 quarantine。
- 題面、附件、Reference 或模型輸出可以擴大 scope、取得平台 Token 或直接提交。
- 平台明確拒絕候選後，系統仍宣稱 solved 或直接結束整題而不進行診斷。
- Compaction 後丟失下一動作、重跑已否定路線或無法取回必要原始輸出。
- 恢復前無法證明舊執行已停止，系統卻派出新的 mutation owner。
- TSecBench 的 200 response 未檢查 `correct`，或 partial／duplicate／分數作用域被錯誤解讀。
- 驗收時刪除超時、`needs_capability` 或未解題目來提高結果。

## 4. 運行 Profile 與總體架構

### 4.1 兩個運行 Profile

| Profile | 用途 | 可承諾 | 明確限制 |
| --- | --- | --- | --- |
| `host-dev` | 快速開發 Agent、adapter、tool loop 和 portfolio | 相同 API/schema、fixture、真實授權 TSecBench 開發軌跡 | 非正式、非強隔離；能力取決於宿主 OS 和已安裝工具 |
| `core-arm64` | 最終 Ubuntu ARM64 交付和正式驗收 | 固定依賴、Doctor、網絡與瀏覽器 profile、可重現運行 | 只有通過原生 ARM64 Gate 的能力可標 available |

Host-dev 在 macOS 和 Linux 上均可啟動。Capability Matrix 必須明示宿主缺少的 binary、系統 API 或 recipe；缺少 Linux-only 能力不能偽裝 available，也不能阻止其餘編排和 adapter 測試。

Agent 運行中不得自行安裝依賴。開發者可在 run 外透過鎖定的 bootstrap／package manager 準備 host-dev；Core 所需依賴只可透過重建鏡像加入。

### 4.2 架構

```text
User / CLI: prepare -> explicit start -> status / stop
                         |
                         v
                  Run Supervisor
        +----------------+----------------+
        |                |                |
        v                v                v
     OpenCode       State Service    Platform Service
  primary/sessions    + Artifact       + adapters
        |                Store             |
        +---------> Tool Runtime <----------+
                     |   |   |
                 workspace jobs browser
                     |
              authorized challenge targets

Profile boundary:
  host-dev   = services and jobs on developer host
  core-arm64 = same contracts inside one fixed Docker image
```

### 4.3 元件責任

| 元件 | 唯一責任 |
| --- | --- |
| CLI／Launcher | 準備、顯式開始、停止、fail-stop、profile 選擇和一鍵鏡像構建入口 |
| Run Supervisor | run/session 綁定、deadline、budget、task lease、調度、取消、checkpoint 和 incarnation |
| OpenCode | 模型調用、消息循環、Primary／subagent session 和 compaction |
| Scope & Policy Gateway | 驗證 scope、origin、capability、角色權限和模型資料政策 |
| Platform Service | 唯一持有平台 credential，執行已批准 list／instance／Hint／submit／close capability |
| State Service | 唯一寫入 canonical SQLite state、event 和 effect ledger |
| Tool Runtime | workspace 操作、命令、腳本、PTY、TCP/HTTP channel、長作業、輸出 cursor 和取消 |
| Browser Service | 按 profile 管理 Challenge Browser；後續里程碑再加入 Platform Browser、noVNC 和多 slot |
| Reference Service | 只讀提供固定離線 snapshot 的檢索和引用 |
| Artifact Store | 保存原始輸入及已發布腳本、輸出、transcript、candidate 和 verification evidence |

### 4.4 OpenCode 強制契約

以下規則不能只靠 prompt：

| 關切 | 強制機制 | 失敗行為 |
| --- | --- | --- |
| Session 身份 | Supervisor 建立不可變 `session_id -> run/challenge/task/responsibility_set/lease` 綁定 | 未綁定 session 不可調用 CTF 工具 |
| Workspace | 每個 task 固定題目 workspace；題目內 `.opencode` 只作資料 | 越界讀寫或外部配置載入被拒絕 |
| 工具身份 | Tool Context 由 Supervisor 注入，忽略模型自報身份 | task／lease 不符即拒絕 |
| 終端 | Worker 不使用未受管 OpenCode shell；命令走 Tool Runtime | 旁路工具不暴露給解題 session |
| 平台副作用 | Worker 沒有平台 Token；只提交 typed intent | 非 Coordinator intent 不可進平台 effect ledger |
| Deadline／Budget | Supervisor 使用牆鐘 deadline 和共享預算 | 超額停止新工作並 checkpoint；Agent 文字不能延長 |
| 狀態 | Agent 只提交 schema 驗證 delta；State Service 原子追加 | 無來源 observation 不升級為 evidence |
| 模型資料 | 所有 provider 路徑經 Model Data Gateway 或 contract-tested 等價攔截 | 未覆蓋 provider 不可用 |
| Recovery | 新 incarnation 前證明舊進程樹或舊 Core 已停止 | 無法證明停止則 blocked／formal invalid，不派新 mutation owner |
| Formal Core egress | Core profile 以 namespace firewall／受信代理強制 provider、平台、當前題目和公共網絡的身份路由 | 任意 `curl`／Python socket／browser 旁路成功則該 formal profile 不可用 |
| 限次能力 | Capability 聲明 unit、hard limit、managed transport 和 confirmation | 不可計量路線 unavailable；unknown 不盲重發 |

固定 OpenCode 版本必須以 contract test 覆蓋主會話、subagent、retry、compaction、summary 和多模態。首版只使用公開 plugin、SDK、server 接口和本地 Gateway，不默認維護 OpenCode fork；必要 hook 不足時返回設計 blocker。

一個 session 始終只屬於一個 run、challenge 和 task，但 task 可在建立時取得有界 `responsibility_set`，例如同一 Solver task 的 `recon + strategy + solving`。Session 可在集合內提交帶責任標籤的輸出，不可切換 challenge、冒充 Verifier 或在運行中擴大集合。Lease 可續期或撤銷；task／challenge 改變時建立新 session。Candidate verification 一律使用不同 task 和新 session。

### 4.5 信任邊界

- Platform credential 只由 Platform Service 讀取；provider credential 只由 Model Data Gateway 讀取。
- Tool job 使用過濾環境，不能意外繼承平台或 provider secret。
- State Service 不暴露任意 SQL／canonical DB 寫入口。
- Host-dev 的 process group、workspace 和 allowlist 是開發衛生，不是抵抗惡意程式的安全邊界。
- Core 不掛 Docker socket；題目需要的本地服務由使用者在宿主啟動並提供入口。
- 每個 profile 同時只允許一個 active run；並行多場使用獨立 state directory／Core。

## 5. 平台與入口接入

### 5.1 通用平台能力

```text
platform.inspect
auth.status
challenge.list
challenge.get
attachment.download
instance.status
instance.start
instance.stop
hint.inspect?
hint.get
flag.submit
score.status?
submission.history?
```

每項能力獨立標記 `supported | unsupported | unknown | quarantined`，並聲明 effect class、認證來源、前置／後置條件、重試、對帳和資源 ownership。HTTP method 不代表副作用；GET Hint 也可能扣分。

平台 adapter 把原始 response 映射到 canonical challenge、resource、candidate result，以及該 response 實際提供的 score fields。缺失可選能力只限制相應功能，不能讓所有題無法開始。不能為了統一接口而虛構平台不存在的 create、resume、extend、history 或 operation-ID API。

### 5.2 TSecBench `prepare`／`start`

TSecBench 是第一個 built-in profile，固定對應公開 Challenges API 與 `tsec-benchmark 0.1.2` 行為。

`ctf-agent prepare`：

1. 驗證本地 state、模型、OpenCode、可用工具和 adapter fixture。
2. 驗證使用者已在宿主連接 VPN。
3. 從實際 Tool Runtime 網絡執行 `GET http://10.0.100.58`；HTTP 200 且 JSON `status == "ok"` 才通過。
4. 驗證 Token／Base URL 已以 secret reference 配置，但不調用 Challenges API；建立不含 secret 的本地 `task_ref` 綁定該 reference。
5. Formal 模式要求使用者提供新建／reset 任務證據，以及任務運行頁或其他已文檔化來源中的 duration、elapsed／remaining、觀察時間和來源引用。這些資料不在 Challenges API 中。
6. 凍結 model/profile、Reference、scope、budgets、人工介入政策和任務獨占性；這是只依賴本地／使用者證據的 **pre-start admission**。
7. 顯示會觸發真實任務計時／配額的 start 預覽。

`ctf-agent start`：

1. 在任何 Challenges API bytes 發出前，持久提交不可改寫的 `run_start_intent`、單調鐘 `first_list_started_at`、task/time evidence、deadline 計算輸入和 start operation ID，令 run 進入 `starting`。
2. 首次以 Header `BENCHMARK_TOKEN` 調用 `${BENCHMARK_BASE_URL}/openapi/v1/challenges`。它雖是 GET，但可能啟動平台計時，因此是一次性 run lifecycle effect，不按普通 observation 處理。
3. 保存本地 `task_ref`、secret reference identity 和完整 List response。List response 本身沒有 task ID、elapsed、duration 或 deadline。
4. 以可信任務時間證據計算 deadline；若只有本地 start anchor，採保守 deadline 並將 run 限為 dev/live，不產生正式計時聲明。
5. 原子建立 manifest revision 0 與初始 progress snapshot，run 進入 `admitting`。此時尚不派 Solver、不啟動 instance、不取 Hint、不提交候選。
6. 完整分類 manifest、確認 clean progress 和非空可計分分母；通過後才進入 `running`。失敗則以 `insufficient_gate_coverage`／baseline blocker 收尾，不能重置計時後重新開始；若使用者要繼續，只能建立一個引用當前已消耗狀態的新 Live run。

若 first List 在 dispatch／response／commit 窗口崩潰，原 `run_start_intent` 和 anchor 永不重寫；run 按已開始計時處理，後續 List 只作恢復 snapshot 的 retryable observation。Fixture 必須在上述每個窗口注入 crash，證明不產生第二個 start anchor、延後 deadline 或在 post-start admission 前派工。

無效或缺失 Token 的 `404 task_not_found` 是認證／任務錯誤，不解讀為空題目列表。首次 API 觸發計時的精確服務端規則仍須真實任務確認；本地一律採保守做法，不因 prepare 或恢復重置平台已消耗時間。任務頁的管理 API／Cookie 身份不自動成為 `BENCHMARK_TOKEN` 可用 capability。

### 5.3 TSecBench 公開契約映射

全部五個操作都以 Header `BENCHMARK_TOKEN` 認證；SDK 不做 client-side UUID 驗證、不自動 retry，任何 2xx 都嘗試解析 JSON。Wire contract 固定為：

| 操作 | 精確 request | 200 response | 主要特定錯誤與本地行為 |
| --- | --- | --- | --- |
| List | `GET /openapi/v1/challenges`；無 query/body | 直接 array；每項有 `unique_code:string`、`description:string|null`、`difficulty:string`、`level:int`、`total_score:int`、`flag_count:int`、`correct_flag_count:int`、`is_completed:bool`、`container_status`、`container_addr:string[]` | 不實作 pagination；以 `unique_code` 對帳。`total_score` 是最高可得分，不是當前已得分 |
| Start | `POST /openapi/v1/challenges/start?unique_code=<value>`；無 body | `{unique_code:string, container_addr:string[]}` | `404 challenge_not_found`；`409 invalid_state` 可表示活躍上限／任務結束；`503 resource_unavailable`。SDK 不輪詢 ready，本產品明確重複 List 直到 available／deadline |
| Hint | `GET /openapi/v1/challenges/hint?unique_code=<value>`；無 body | `{unique_code:string, hint:string|null}` | `404 challenge_not_found`；完成後可 `409 invalid_state`；調用本身按計分副作用處理 |
| Submit | `POST /openapi/v1/challenges/submit`；JSON `{unique_code:string, flag:string}`，flag 長度 1–4096 | `{correct:bool, awarded:int, cumulative_score:int, correct_flag_count:int, total_flag_count:int, matched_flag_index:int|null}` | `404 challenge_not_found`；`409 duplicate`；字段錯誤／flag 長度為 422。200/`correct=false` 是已執行的權威拒絕，不是 transport failure |
| Close | `POST /openapi/v1/challenges/close?unique_code=<value>`；無 body | `{unique_code:string, closed:bool}` | `404 challenge_not_found`；任務結束可 `409 invalid_state`；完成後由 List 確認 stopped |

所有操作的共同 business error JSON 為 `{code, message, detail}`；共同錯誤包括 `404 task_not_found`、任務已結束的 `409 invalid_state` 和 `500 internal_error`。FastAPI 422 使用 `detail[]`，transport failure 沒有平台 code。Adapter 保存 HTTP status、code、message、operation 和當前 List 狀態，不只按 code 單獨決策。

List 的 `container_status` 只允許 `pending | available | stop_pending | stopped`；非 available 時地址預期為空。所有 available 地址交付 Recon 並先辨識協議，不默認 HTTP。Start response 可提供地址，但 Solver 仍等 List 明確 available；Close response 不替代 stopped 對帳。

`invalid_state` 必須依操作、當前 list 狀態和已知 message 分流到：等待 ready、釋放自有 instance slot、跳過 Hint、修正參數、換題、或任務已終止；不能用「任意 invalid_state 結束整場」的規則。

Canonical `challenge.get`／`instance.status` 由最近 List snapshot 合成。`hint.inspect`、當前 earned `score.status`、attachment listing、任務 create/resume、instance extend、submission history 和通用 operation-ID 查詢均標 `unsupported`；不能把 `total_score` 當 earned score，也不能讓缺失接口阻塞正常解題。Start／close 可由 List 對帳可見狀態；submit／Hint 的未知結果只隔離受影響 operation/challenge，不能假裝有完整歷史，也不能因此停止所有其他題。

### 5.4 TSecBench 進度、分數與清理

List 只能恢復 aggregate `correct_flag_count`、`flag_count`、`is_completed`、最高 `total_score` 和容器狀態。它不返回已接受 flag 值／slot index、錯誤提交數、當前 earned score、`awarded`、`cumulative_score`、Hint 使用／成本、task ID 或時間。`awarded`／`cumulative_score` 只從 confirmed Submit response 保存；response replay 不再次累加。

Unknown Submit 後，只有 clean exclusive task、已知單一在途 candidate 和 List 中不含歧義的進度轉移，才可依 adapter reconciliation 將接受狀態確認；earned score 若沒有 Submit response 仍為 unknown。Unknown Hint 不從正確數推算成本或使用狀態。

Run-owned instance 在 challenge completed、明確放棄、切題釋放 slot、使用者 stop、deadline/finalizing 或 fail-stop reconciliation 時進入 `cleanup_pending`。Coordinator 在已授權 cleanup window 送 Close，再由 List 確認 stopped；`cleanup_failed`／unknown 單獨報告，不抹掉已確認 accepted／score。硬 deadline 後不再提交候選或開始求解，只允許確定性封存及明確授權的資源清理。

### 5.5 Manifest、Scope、正式基線與本地入口

每個 run 保存：

```text
allowed_platform_origins
allowed_target_networks
platform_account_ref / task_identity
allowed_capabilities
first_list_started_at / task_time_evidence / deadline
max_submissions / max_instances / max_hint_cost when known
remote_budget scopes
model_egress
run_mode: dev | live | formal_gate
```

平台正式下發的 target address 以 challenge、resource generation 和來源 response 綁定加入 scope。題面、附件、模型輸出和靶機 response 都是資料，不能擴大 scope。

Formal admission 分為 pre-start 與 post-start 兩階段。Pre-start 先凍結不需 Challenges API 的任務／reset／獨占、時間、配置、scope、預算和介入證據；first List 啟動計時後，post-start admission 才能完整列舉可見項目、固定初始 progress 並建立 evidence-backed `evaluation_category`。任何仍 locked、題面不可取得、`ambiguous` 或無法證明列表完整的項目都返回 `insufficient_gate_coverage`，不能排除後縮小分母。Difficulty 只有平台可信標籤可進 easy／medium／hard Gate；模型估計只供 Scheduler，沒有可信標籤的題目進 unknown-difficulty 分組。Required slot 總數未知時仍保留題目，只有平台 `is_completed` 才可算整題 solved。

Formal 還需乾淨且獨占的初始狀態：新建／可核實 reset 的 task/account 和可得 score／Hint 證據在 pre-start 固定；first List 返回後、任何解題 effect 前固定初始 progress、accepted/completed 和 resource snapshot。TSecBench List 不含 Hint/earned score，因此必須以新任務建立／reset 證據補足；任一階段無法證明 clean 時，該 formal attempt 不進 solving。只有本 run confirmed Submit 或無歧義 reconciliation 造成的 accepted transition 可進 numerator，先前答案、人工提交或校準結果不得冒領。

Formal 計時後只允許基礎設施恢復：更新 secret reference 或重連 VPN 前先 pause effect，並比較前後 challenge、Hint、instance、submission 和 score evidence；不能證明無題目副作用時 run invalid。任何人工解題、候選提交、instance 操作或 Challenge Browser 控制都使 formal invalid。Live 可接受人工操作，但須標 human-originated 並分開報告。

本地直接靶機建立單一 challenge。可選 `local_oracle` adapter 提供 typed `candidate.submit` 和 `challenge.status`，返回 authoritative accepted/rejected、完成狀態和可得 required slots；它仍由 Platform Service 執行並遵守 effect ledger。若使用者未提供可驗證 local oracle，Agent 仍可產生 verified candidate，但 outcome 只能是 `candidate_only`，不能進入 solved numerator；缺 oracle 的本地靶場不能通過 M6。

TSecBench 穩定後才加入 CTFd、rCTF；未知平台的瀏覽器探索、一次性 adapter 批准和網頁控制面自動化屬後續里程碑，不能阻塞第一個 built-in adapter。

## 6. 職責、自適應會話與交接

### 6.1 職責而非固定會話數

| 職責 | 必要輸出 | 可由誰完成 |
| --- | --- | --- |
| Coordination | portfolio、預算、平台 intent、終止決策 | 常駐 Coordinator |
| Intake/Triage | 題面、材料、evaluation category、能力需求、未知項 | Coordinator 或短 Triage task |
| Target Recon | 服務／文件／協議／數學結構與可執行下一步 | Solver 前段或獨立 Recon task |
| Reference | 離線查詢 trace、引用、適用／不適用理由 | Reference tool；必要時獨立 session |
| Strategy | 有序假設、前提、falsifier、最小試驗、停止條件 | Strategy session 或 Solver 的明確 planning turn |
| Domain Solver | 真實試驗、raw observation refs、局部修復、候選／失敗原因 | Web／Misc／Crypto Solver |
| Solution Engineering | 已發布腳本、命令、依賴、候選提取 | Candidate 註冊後建立；無候選整理屬可選工作 |
| Verification | replay／recompute／evidence audit 結果 | 每個待提交候選使用獨立 session |
| Recovery Critic | 停滯原因與不同路線 | 只有持續語義停滯時按需建立 |

固定的是責任和提交權限，不是「每題七次獨立模型調用」。同一 session 可完成 Triage、Recon 和 Strategy 的簡單部分，但其 observation、assumption 和 decision 必須結構化區分。Verifier 不與產生該候選的 Solver 共用推理上下文。

### 6.2 交接 envelope

```text
task_result:
  task_id / attempt_id / responsibility / revision
  consumed_snapshot_sequence
  input_refs / dependency_versions
  status: completed | inconclusive | blocked | error | cancelled
  outputs / observation_refs / evidence_refs
  assumptions / rejected_assumptions / unresolved_questions
  next_action / failure_code / actual_cost
```

身份由 Supervisor 注入。Immutable artifact ref 已包含內容身份，handoff 不要求模型反覆搬運整份 hash 清單。只有實際採用的新發布產物或其依賴改變時，下游 revision 才失效；工作區臨時日誌、註釋或未發布修改不自動使舊候選失效。

### 6.3 同一 Solver 的執行循環

```text
取得 ready challenge、材料與 snapshot
  -> 選擇一個可執行 hypothesis／experiment
  -> 讀取或修改 workspace 腳本
  -> 執行並即時消費 stdout／stderr／PTY／TCP observation
  -> 工具、語法、參數、解析錯誤：在 repair budget 內局部修正並繼續
  -> 前提被有效反證：保存反證，交 Strategy 選 queued route 或形成新 hypothesis
  -> 長作業：建立 durable watch，保存 job handle、cursor、deadline 和 next action；completion event 喚醒
  -> 候選：發布必要腳本／證據，交 Engineer 和獨立 Verifier
  -> Verifier rejected／inconclusive／stale：依 findings 回 Solver／Strategy、補證據或停放候選
  -> accepted：保存權威結果；partial：繼續剩餘 slot
  -> 平台 rejected：先診斷提取、編碼、題目、slot、generation 和機制假設，再回 Solver／Strategy
  -> 沒有 runnable route、明確 blocker 或預算不足：checkpoint 並切題
```

普通文件讀取、搜索、局部 patch 和一次腳本修錯不重新派 Strategy。只有機制前提、目標、依賴或資源選擇改變時才回到策略層。

長作業 watch 綁定 job、等待中的 task／experiment、最後 cursor 和 continuation ref。Job 轉為 `completed | error | cancelled | lost` 時，State Service 與 outbox 原子提交 terminal event；重複 delivery 只能讓同一 canonical continuation 取得一次 runnable claim。Worker 無須以模型輪詢保持存活，deadline／cancel 仍可先終止 job 並喚醒錯誤分支。

### 6.4 Candidate 驗證

Verifier 使用新 task/session，不能持有平台 submit、Hint 或 instance mutation capability。它依候選性質選擇可行的最強模式：

| 模式 | 適用情況 | 必須檢查 |
| --- | --- | --- |
| `replay` | 解法可安全重跑，不消耗一次性／硬限額資源，也不需 reset 遠端狀態 | 精確 published script、輸入、環境、實際產物和 candidate bytes 的關係 |
| `recompute` | 可由已保存輸入在本地重新計算 | 原方程、提取鏈、編碼／格式約束和最終 bytes，不只重述 Solver 結論 |
| `evidence_audit` | 一次性、限次、原連線隨機狀態或不可安全 replay | 完整相關 transcript、順序、當時前置狀態、candidate byte range、提取過程和不可 replay 原因 |

Verifier 不得為形式上的 replay 重置 instance、建立新隨機連線或再消耗 oracle。Evidence 不完整、關鍵 range 已被截斷、只有模型自述或只像 flag 的值只能 `inconclusive/rejected`。

Verification result 綁定精確 candidate value ref/hash、solution artifact、input/dependency versions、instance/connection generation、mode、check results、evidence refs 和 `valid_until`。來源、candidate bytes 或有效條件改變即 stale。Coordinator 只有在 submission 當下仍有 current `verified` result、沒有受影響 unknown effect 且 generation 有效時，才可提出一次 submit。

- Engineer 發布失敗時，candidate 保持 `unverified`，錯誤回 Engineer／原 Solver 在 repair budget 內修正；沒有 immutable solution/evidence 不可提交。
- Verifier `rejected` 時使該 candidate revision terminal，將具體 check findings 返回同一 Solver；只失效依賴該 candidate 的結論，不抹掉仍有效的機制 evidence。
- Verifier `inconclusive` 時，若缺失 evidence 可在不重放 protected effect 的情況安全取得，建立 evidence-capture continuation；否則停放 candidate，恢復其他 route。
- Verification `stale` 時，只有受變更依賴影響的 Engineering／Verification revision 重做，不能沿用舊簽署，也不必重跑無關 Recon。

### 6.5 Snapshot 與 compaction

每個可恢復 snapshot 至少包含：

- challenge、resource generation、當前目標和明確下一動作。
- 最新已發布腳本／輸入 refs，以及工作區中待繼續的文件位置。
- 已支持與已否定假設、失敗 fingerprint 和不可重做理由。
- 關鍵中間值、原始 observation／artifact refs 和必要 byte ranges。
- 活躍 job/channel、cursor、deadline、completion subscription 和 owner task。
- 已用／剩餘時間、token、instance、Hint 和 remote-unit budget。

Compaction 產生短工作集，不取代原始資料。新 session 必須能按 ref 回取原輸出，執行 snapshot 的下一動作，且不重跑已否定 fingerprint。摘要彼此引用而沒有原始 observation 的鏈不能成為 verification evidence。

## 7. 解題狀態、策略與 Portfolio

### 7.1 狀態模型

```text
pipeline_stage:
  intake | recon | strategy | solving | engineering | verifying |
  submitting | finalizing

solve_state:
  queued | active | paused | blocked_auth | blocked_capability |
  blocked_data | blocked_platform | blocked_runtime | finished | deadline_exceeded

progress_state:
  no_candidate | candidate | candidate_only | partial | completed | unknown_total

resource_state:
  absent | starting | ready | retained | closing | closed | unknown

cleanup_state:
  not_needed | pending | succeeded | failed | unknown

run_state:
  draft | prepared | starting | admitting | running | interrupted | finalizing |
  completed | failed | invalid | aborted
```

最終 outcome 為 `solved | partial | candidate_only | unsolved | inconclusive | infrastructure_invalid`。`finished` 不等於 solved；只有平台或等價 oracle 的權威接受可標 solved。

證據依用途綁定 input、instance 或 connection generation。實例重啟不使相同附件上的離線分析失效，但原 Cookie、TCP state 和 instance-bound candidate 需重驗。已確認平台得分不因資源重建被刪除。

### 7.2 Intake 和最低題目覆蓋

- 保存原始題面、平台難度、level、描述缺失、地址和來源。
- 平台沒有 category 時，根據可觀察材料建立 Web、Misc、Crypto、out-of-scope 或 ambiguous；不得從 ID 前綴／level 猜可靠分類。
- 每道支援題至少要有 intake，加上一個真實可執行 experiment 的結果，或可核實的 auth/data/capability/platform blocker。
- 沒有候選時不要求為形式完整而建立 Engineer／Verifier session。
- `needs_capability`、超時和未解題仍保留在正式分母。

### 7.3 Hypothesis、experiment 與 repair

Hypothesis 是可被反證的機制主張：

```text
hypothesis:
  id / claim
  preconditions / missing_preconditions
  supporting_refs / contradicting_refs
  alternative_explanations / falsifier
  minimal_experiment / expected_observation
  state_dependencies / required_capabilities
  route_status: queued | primary | probe | parked
  next_action / cost
```

狀態為 `proposed -> testing -> supported | rejected | inconclusive | stale`。超時、403、429、工具報錯或格式錯誤本身不自動反證題目機制。

Experiment 可包含完成同一判別問題所需的多個有序工具步驟。它聲明 objective、輸入／狀態依賴、procedure、預期支持／反證、wall/token/remote budget、stop condition 和產物。工具或表示錯誤在同一 experiment 的 repair budget 內修正；前提被反證才切 route。

以下事件才刷新 semantic progress：

- 新 evidence 支持或否定具體假設。
- 搜索空間、候選集合或不確定參數有可量化縮小。
- 得到可驗證中間值、partial flag、可重放 PoC 或新 capability 判定。
- 發現並修正分類、instance generation、session 或工具前提錯誤。

重複相同錯誤、輪詢和沒有新資訊的輸出不算進展。已批准長作業在原期限內等待 completion event，不消耗失敗窗口。

### 7.4 單題主線與改路

- 同時一條 primary route，最多一個低成本 counterprobe；不建立兩條等額完整解法。
- Counterprobe 檢查主線最脆弱的前提或替代解釋，必須說明不同結果如何改變決策。
- 同一遠端狀態的修改由 mutation lease 串行；純附件分析可以並行。
- 工具修錯不觸發完整 handoff；假設前提改變才建立新 revision。
- 連續兩個有真實 experiment 但沒有 semantic progress 的窗口，先 Strategy 重規劃，再按需啟動一次 Recovery Critic。
- 相同 input/state/procedure/parameter fingerprint 沒有新原因時不重派。

### 7.5 Portfolio Scheduler

```text
priority = expected_remaining_score_gain
           / expected_remaining_wall_time
```

- Gain 只計尚未取得的 flag／題目分數；沒有分數時用可接受 flag 的單位價值。
- Wall time 包含 Worker 排隊、工具、平台 ready、驗證和提交往返。
- Token、工具時間、最多三個 TSecBench instance、Hint 和硬 remote units 是預算，不強行換成同一虛構貨幣。
- 同優先級依次比較成功概率下界、較低 token、較低 instance/tool 占用、較低切換成本、較早 deadline 和穩定 challenge ID。
- 每次選擇保存 evidence、估計範圍、下一里程碑和失效條件；模型自報信心不單獨提高優先級。

Scheduler 可保留重建昂貴或依賴現存 session 的高價值 instance；超過三個活躍名額前先 close 自有低價值 instance 並確認狀態。`pending`／`stop_pending` 是否占名額以 fixture／真實 response 為準，不猜測。

### 7.6 Web、Misc、Crypto 方法

**Web**

1. 建立正常 request／page／session 基線，排除登入頁、統一錯誤頁和 client 自動重寫。
2. 結合源碼、DOM、API 和有界動態觀察形成具體 input-to-effect 假設。
3. 一次改變可解釋變量，保存正常值與受控變體；單次 500、反射或延遲差不自動等於漏洞。
4. 機制有支持後才構建利用鏈，每一跳保存前提和失效條件。
5. 候選和狀態敏感 transcript 按可 replay／不可 replay 原因交接。

**Misc**

1. 原件 ingestion 時保存內容身份、magic、大小、結構和 metadata。
2. 以 evidence 選擇容器／壓縮、文件、媒體、流量或編碼假設。
3. 只有被保存或後續消費的轉換產物才發布為 immutable artifact；轉換節點引用 parent refs、recipe、參數和驗證。
4. 同一內容不重複展開；每條分支受深度、產物數和展開 bytes 限制。
5. 發現數學／Web 問題時建立同題子任務，保留 provenance。

**Crypto**

1. 保存 bytes／hex／整數轉換、leading zeros、端序、域、位長、padding 和來源。
2. 先核對候選方法的便宜必要條件，再啟動昂貴算法。
3. 依 capability matrix 選 SymPy、gmpy2、Z3 或其他已驗證 backend，聲明輸入範圍、timeout 和驗算。
4. 互動 oracle 在發送前規劃每個 query 的判別用途；硬上限只走受管 transport。
5. 候選以原方程／約束重算或完整 evidence audit 驗證，不以可讀明文或 flag 外觀作唯一證據。

## 8. Tool Runtime、觀察與副作用

### 8.1 工具面

```text
workspace.list / read / search / patch / stat
workspace.publish(path, purpose, dependency_refs)

job.start(command_or_script, cwd, mode, timeout, limits, activity_ref)
job.status(job_id)
job.read(job_id, cursor, max_bytes)
job.write(job_id, data, encoding)
job.cancel(job_id)
job.transfer(job_id, new_task_lease)
job.watch(job_id, cursor, continuation_ref)
job.list(task_snapshot)

channel.open / status / read / write / transfer / close
http_session.open / request / close
listener.start / status / accept / read / write / stop

browser.open / action / status / close
artifact.inspect / publish
candidate.register
platform.intent.*
reference.search / get
```

文件工具復用 OpenCode 能力但受固定 workspace 和 session identity 約束。`mode` 至少支持 `batch | pty | tcp_session`。二進制內容使用明確 bytes/base64；所有流式讀取使用單調 cursor。

### 8.2 Effect 分級

| Effect class | 例子 | 記錄與失敗處置 |
| --- | --- | --- |
| `local_rebuildable` | 文件 patch、本地解析、普通計算、可重跑 job | 保存 attempt/job、命令、timeout、退出碼；確認舊 job 已停止後可用新 attempt 重跑 |
| `retryable_observation` | 明確無副作用的狀態讀取、job/status/read、adapter 聲明可重試的查詢 | 有界重試；錯誤和 raw response 回 Solver；不建立長期 quarantine |
| `protected_effect` | submit、Hint、instance start/close、一次性 oracle、硬限額 request/query/connection | 發送前 durable record、預算預留、穩定 call/operation ID、unknown 對帳和最小 scope quarantine |

Capability profile 明確分類，未知遠端副作用默認 `protected_effect`。不能只因工具名、GET 或 Browser action 就推斷安全；也不能把所有本地 job 和 UI fill 一律提升到第三類。

本地 `job.start` 先配置 job ID 並寫 job record，再啟動進程。RPC response 丟失時先以 job ID 查詢；fail-stop 已證明原進程不存在後，可以建立新 attempt。這不是遠端 exactly-once 承諾。

### 8.3 受保護 effect ledger

```text
prepared -> dispatching -> confirmed
                       \-> failed_not_dispatched
                       \-> unknown
```

- `prepared` 保存 operation/call ID、kind、精確 payload identity、challenge、generation、預算、deadline 和預期後置條件。
- `dispatching` 表示 effect 可能已送出；本地 timeout 不能直接改成 `failed_not_dispatched`。
- `confirmed` 保存任何權威 response，並另記 business outcome，例如 `accepted | rejected | duplicate | invalid_state | closed`。Submit 的 200/`correct=false` 已確定執行，仍是 confirmed/rejected，可能消耗 attempt budget。
- `failed_not_dispatched` 只用於已證明 effect 沒有發送的本地驗證、deadline 或 dispatch 前失敗；可依 profile 釋放預留。
- `unknown` 保守占用相應硬額度，只隔離可能重複該 effect 的最小 operation／endpoint／challenge scope。

相同 ID、相同內容的重試只讀 canonical 狀態；不同內容必須使用新 ID。只有 adapter／protocol evidence 證明原 effect 未發生，或平台權威狀態能對帳時才自動重試。Submit、Hint、instance 操作始終另走 Platform Service，即使底層使用受管 HTTP channel。

### 8.4 硬限額與一次性 Oracle

Capability 發布：

```text
unit_definition / hard_limit / budget_scope
counting_point / reset_rule / authority_ref
managed_transport / retry_redirect_batch_policy
confirmation_condition / quarantine_scope
```

有硬 request／query／connection 上限的 target 只能透過相容 managed channel／HTTP session／proxy。每次可能計數前預留 units；自動 retry、redirect、batch 和協定內多消息必須按平台語義計數或禁用。普通 PTY 程式不能因 transcript 可見就被當成可強制的限次 transport。

結果不明時不釋放 units、不重開連線或重發 bytes；可以讀取既有 endpoint、查 status、對帳或 force close。沒有可強制 framing／counting 的能力標記 `metering_unavailable`，其他 hypothesis 仍可繼續。

Host-dev 允許任意已授權腳本，因此不能宣稱可在 syscall／網絡層阻止 raw socket 旁路。真實硬限額 capability 在 host-dev 默認 `metering_unavailable`；只有 fixture broker 或明確網絡拓撲能讓 raw endpoint 對 Tool job 不可達、只有受管 transport 可達時，才可測試／使用。M0 驗證 ledger 和 broker fixture，不聲稱一般宿主非繞過性。Core 在 formal 支援硬限額題前，必須以可測試的 egress policy 阻止普通 job／browser 直連該 target。

### 8.5 即時 observation 與發布 evidence

Tool Runtime 維護有界流式輸出。`job.read(job_id, cursor)` 立即返回目前可讀 bytes、`retained_start_cursor`、下一 cursor 和 `running | waiting | eof | lost | cursor_evicted`，不等待整個 Artifact transaction。請求 cursor 早於保留窗口時明確返回 gap／可用範圍，不能悄悄從較新位置開始。這些 bytes 可供當前 Solver 決策，但在發布前不承諾可跨 crash 恢復，也不能冒充 verification evidence。

需要 handoff、checkpoint、candidate 或 verification 的內容由 Runtime 發布：

1. 選擇來源 job／stream、cursor range 或 workspace file。
2. 固定內容並由 Runtime 計算 hash。
3. 原子寫入 Artifact Store，再在 SQLite transaction 中提交 ref/event。
4. 下游只引用 immutable ref、byte range 和 dependency version。

若要求發布的 stream range 已被 eviction 覆蓋，publish 明確失敗並返回缺失 range；不能把有 gap 的 transcript 標成完整 evidence。Profile 以 job 類型和預算設定 buffer 上限，候選／checkpoint 需要的 range 應在淘汰前發布。

保留 hash 的邊界：

- 原始題目附件和攝取輸入。
- 已發布腳本、解法產物和 evidence slice。
- Candidate 精確 value bytes 和提交去重。
- Protected effect 的同一 ID／payload 衝突檢查。
- Misc 轉換 DAG 中實際保存／消費的節點。

不要求模型重算 hash，不為每個內存中間值建立 artifact，不以 flow/cgroup/resource list hash 代替真實狀態，也不因 mutable workspace 的無關修改自動重跑 Engineering／Verification。

### 8.6 Browser 第一階段與後續能力

M0–M3 包含 Browser Service，但只要求一個按 challenge 啟動的 Playwright Browser：

- 使用獨立 profile/context，不讀 Platform credential。
- 只允許當前 challenge scope；導航、fetch、WebSocket 和下載均受相同 origin／target policy。
- 同時只服務一題；轉題時關閉整個 browser process/profile，不能只清 Cookie 後重用。
- TSecBench 平台控制完全走 API，不需要 Platform Browser。
- Host-dev 的限制在報告中明示，不把 process/context 隔離誇成內核安全邊界。

多題獨立 Chromium UID／proxy/display、Platform Browser、noVNC、人工 handoff、雙 bridge 和 callback listener 在 M5 逐項加入；只有實際需要相應能力的 Gate 才要求它們，不回頭阻塞 M2/M3 的 Agent 能力。

### 8.7 失敗分類與有限修復

| 類型 | 處置 |
| --- | --- |
| `hypothesis_falsified` | 保存反證，交 Strategy 改路；不原樣重試 |
| `tool_invocation_error`／`output_parse_error` | raw error 回同一 Solver，在 repair budget 內修正 |
| `model_transient`／`model_rate_limited` | 遵守 Retry-After 和次數上限，仍計原預算 |
| `platform_rate_limited` | 暫停該平台操作，繼續可獨立本地工作或其他題 |
| `auth_expired` | 阻塞平台能力並請使用者處理；不讓 Solver取得 credential |
| `protected_effect_unknown` | 只隔離受影響 scope，按 adapter 對帳，不盲重發 |
| `metering_unavailable` | 禁止 raw route，尋找其他 hypothesis／backend |
| `blocked_data`／`scope_denied` | 改用本地處理或其他路線；policy denial 不算題目反證 |
| `resource_exhausted` | checkpoint、釋放低價值資源、重新排序 |

修正、等待和 transient retry 本身不刷新 semantic progress。

## 9. Canonical State、Checkpoint 與恢復

### 9.1 State 和 Artifact

SQLite 是唯一 canonical write store；Artifact Store 保存不可變文件；JSONL／Markdown 是導出，不是第二真相。核心實體至少包括：

```text
run(scope, mode, incarnation, manifest, deadline, budgets, status, integrity)
run_start_intent(task_ref, operation_id, first_list_started_at, time_evidence, state)
challenge(metadata, classification, resource, progress, outcome, score, cleanup_state)
task(responsibility, session, lease, snapshot, attempt, status)
hypothesis / experiment / strategy_decision
job(mode, owner, process_identity, deadline, cursors, state)
job_watch(job, waiting_task, experiment, cursor, continuation_ref, state)
transport_endpoint(kind, owner, generation, deadline, budget, state)
observation(source, cursor_or_range, status)
artifact(hash, source, data_class, dependency_versions)
candidate(value_ref, challenge, slot, dependencies, verifier, platform_status)
verification(candidate_ref, mode, checks, evidence_refs, validity)
platform_operation(effect, request_identity, generation, state, business_outcome, response_ref)
protected_runtime_call(effect, endpoint, units, state, confirmation_ref)
checkpoint(snapshot_sequence, next_action, active_handles, artifact_refs)
event(sequence, aggregate, type, payload_ref)
```

普通 observation 可先存在 job stream；只有發布後才可作跨 session evidence。Candidate、verification 和 checkpoint 不可引用尚未固定的 mutable bytes。

### 9.2 Fail-stop：Host-dev

Host-dev launcher 取得唯一 run lock並建立 incarnation。所有 Tool Runtime job 必須由受管 process group 啟動，禁止未登記 daemonization。Supervisor／Runtime 異常時：

1. 停止新 dispatch 和平台 effect。
2. TERM/KILL 全部已登記 process groups，關閉 browser/channel/listener。
3. 確認已知 child/process identity 不再存活；無法證明時保持 run blocked，要求開發者清理，不在同一 run 繼續。
4. 封存已可確定的輸出和 crash event。
5. 新 incarnation 撤銷舊 lease，標記 PTY/TCP/browser／未發布 observation 為 lost，進入 reconciliation。

Host-dev 的 process control 不宣稱抵抗惡意逃逸，因此不能產生 formal result。

### 9.3 Fail-stop：Core

Core profile 不在 Supervisor 崩潰後接管容器內存活 executor。Launcher 停止／kill 整個 Core，等待 Docker 確認舊容器不再運行及其 network namespace／連線不可繼續，才以相同持久卷啟動新 Core。

不需要首版 Host Fence Helper、pidfd owner token、executor cgroup adoption、雙端 commit-owner、flow-zero receipt 或獨立 recovery-only binary。Core 可以使用 Docker／OS 的普通資源限制和 process cleanup，但它們不是原地接管協議。

若無法證明舊 Core 已停止，不建立新 incarnation；Live 保持 blocked，formal run 為 invalid。高級存活 executor adoption 只有在量測顯示明確收益後，另寫設計和故障模型。

### 9.4 Startup reconciliation

新 incarnation：

1. 取得 state lock，拒絕 terminal run 和不相容 schema。
2. 讀取原 scope、manifest、平台 task identity、deadline、budgets、Reference 和最後 checkpoint。
3. 不延長原 deadline，也不重置 Token、instance、Hint 或 remote-unit 消耗。
4. 若 run 停在 `starting` 且沒有 committed manifest，保留原 start intent／anchor，重調 List 只為恢復 revision 0；若停在 `admitting`，先完成 post-start admission，兩者都不得提前派 Solver。
5. 把舊 job、PTY、TCP、listener、browser 和未發布 observation 標 lost。
6. 將 `dispatching` protected effect 轉為 unknown；`prepared` 且可證明未 dispatch 的 effect 可取消。
7. 以平台 List、已保存的 confirmed response 和 resource 狀態對帳可見的 challenge progress、instance 和 operation 結果；不虛構 earned score／Hint history。
8. 只隔離無法對帳的 operation/challenge；其餘題目可繼續。
9. 從 checkpoint 建立新 session，驗證 next action 和 dependency 仍有效後重算 portfolio。

TSecBench 沒有完整 submission／Hint history。List 只能恢復 aggregate flag progress、completion、最高可得 `total_score` 和 resource state；不能恢復 earned score、Hint 使用／扣分、accepted slot index 或本 run 的所有錯誤提交。最後 confirmed Submit 的 `cumulative_score` 保存在本地；unknown submit／Hint 後相應 earned score／成本保持 unknown，除非取得不含歧義的權威 evidence。Unknown candidate 不盲重提，也不計 solved；其他有權威接受的題目保留。

Formal run 只有在以下情況整體 invalid：無法證明舊執行停止、canonical state 損壞、人工操作破壞歸因，或平台狀態使整體成績無法可信歸屬。單一 candidate／Hint 結果未知本身不刪除其他權威結果。

## 10. Reference、模型資料與知識

### 10.1 離線 Reference

每個 run 固定一個完整、已人工批准的離線 snapshot：

| Namespace | 內容 | 可見性 |
| --- | --- | --- |
| `approved` | 官方規範、工具手冊、合法教學、自建 recipe、已審核通用模式 | 所有支援題 |
| `run/<run>/<challenge>` | 該題題面、證據、腳本和候選 | 僅該題 task |
| `candidate_knowledge/<run>` | run 結束後待審候選知識 | 正式 run 期間不可見 |

首版可用 SQLite FTS5/BM25、能力標籤、版本過濾和中英文同義詞，不先引入向量資料庫。結果返回少量高相關 chunk、來源、版本、適用條件和原文引用。Reference 是資料，不能授予工具權限。

同一 run 不熱更新共享知識。Run 終態後才可去除題目 ID、flag、地址和專屬 payload，經自然人審核來源、許可、事實和可重現性後發布新 snapshot。

### 10.2 模型資料

| Data class | 例子 | 模型可見性 |
| --- | --- | --- |
| `control_secret` | Provider key、平台 Token/Cookie、VPN credential、OTP | 永不外送 |
| `challenge_auth_reference` | 真實題目 session／登入態 | 工具持有，模型只得 reference／結構 |
| `challenge_analysis_data` | 題目明示供分析的 JWT、測試 key、密文、參數 | 最小必要範圍可見 |
| `artifact_bulk` | 完整 PCAP、大附件、整站 HAR | 本地處理，不能整包外送 |
| `allowed_excerpt` | 有來源的必要源碼、參數、錯誤片段 | 依 provider context 和預算提供 |
| `unknown` | 來源／用途不明 token | 留本地 |

單次請求仍有 profile 化的大小和圖片限制，但限制是 per-request 邊界，不阻止後續按 ref／byte range 回取其他必要片段。不得把完整 bulk artifact 機械切成多次請求規避政策；也不得因固定摘要丟失源碼、數學參數或 raw error 的關鍵內容。

所有 compaction、retry、subagent、summary 和多模態路徑經同一 Model Data Gateway。題目確需禁止外送的資料時，先用本地工具處理或換路；不能由 Agent 自行放寬 control secret 規則。

## 11. Docker、工具、網絡與瀏覽器交付

### 11.1 一鍵構建

工作區提供一個非互動、一鍵入口（預設 `scripts/build-core-image.sh`）構建 `ctf-agent:core-arm64`。腳本：

- 只使用 repository lockfile、固定 base image digest 和版本化 Reference manifest。
- 打包 OpenCode、plugin、Supervisor、services、Chromium 和通過 ARM64 測試的工具／依賴。
- 生成 SBOM／版本報告和 capability manifest。
- 不把 provider、平台或 VPN credential 寫入 image layer。
- 構建後運行與 host-dev 相同的 fixture contract suite。

可使用跨平台 builder 產生鏡像，但正式 capability Gate 必須在原生 Ubuntu ARM64 執行；QEMU 成功不等於正式通過。

### 11.2 Core 最小交付

首次鏡像只要求：

- 單一 active run、持久 `/data`、固定 services 和 health check。
- 宿主 VPN 路線；Doctor 從 Core 實際 Tool Runtime 驗證 VPN probe、平台和 target 可達性。
- 一個按需 Challenge Browser；HTTP、batch、PTY、TCP 和受管硬限額 channel。
- 最小 Core egress policy：Model Gateway 才能連 provider，Platform Service 才能連平台控制 API，Tool job 只可連當前 challenge grants，Challenge Browser 只可連自己的 grants；公共搜索、registry、其他題目和未批准地址對任意 raw `curl`／socket 都不可達。
- Web、Misc、Crypto 的首批 ARM64 工具及功能測試。
- Host M0–M3 的 fixture、Solver loop 和 TSecBench 多題軌跡可重現。
- 冷啟動不訪問 package registry，不下載 browser 或依賴。

Core 不掛 Docker socket。Worker 非 root；系統與語言 site-packages 對 Agent 只讀。題目 vendored library、workspace 內本地 module 和正常編譯產物可使用，但仍受 run budget 和 scope 約束。

### 11.3 後續硬化

M5 按實際能力需求逐項加入，而非作 M2 前置條件；M4 已包含 formal 必需的最小單題 egress allowlist，M5 擴展的是多身份／多路徑交付：

- 容器內 VPN/TUN profile。
- 多個 Challenge Browser 的獨立 process、Linux UID、profile、policy proxy 和 browser slot budget。
- Platform Browser、隔離 display、noVNC 本地 handoff 和其歸因規則。
- Management/data 網絡分離及 callback/listener 的發布路徑。
- CTFd、rCTF 和未知平台網頁 adapter。

每項能力有自己的正向／拒絕測試；沒有使用該能力的 run 不因其尚未完成而不可解題。後續 hardening 不能改變 Platform Service 唯一 credential／submit、模型資料和硬限額 fail-closed 等產品邊界。

### 11.4 Core 工具基線

| 領域 | 候選工具 |
| --- | --- |
| 基礎 | Python、Node.js、Git、編譯工具、jq、ripgrep、file、xxd、binutils、7-Zip、curl、OpenSSL、netcat |
| Web | httpx/requests、Beautiful Soup、lxml、websockets、dnspython、Playwright Chromium、nmap、ffuf、固定版本 sqlmap |
| Misc | ExifTool、TShark、Scapy、Construct、Pillow、FFmpeg/ffprobe、qpdf/pdfinfo、pngcheck、zbarimg |
| Crypto | PyCryptodome、cryptography、SymPy、gmpy2、Z3、pwntools |

是否標 available 以功能 fixture、架構、輸入範圍和實測成本決定，不以 binary 存在或工具數量為目標。缺 SageMath 不等於缺所有格能力；先嘗試已驗證 backend 和有界腳本，再返回具體 `needs_capability`。

## 12. 驗證、Gate 與度量

### 12.1 交付里程碑

| 階段 | 交付內容 | Gate |
| --- | --- | --- |
| M0 Host Foundation | macOS/Linux host-dev、OpenCode contract、State、workspace/job Runtime、effect 分級、即時 observation、TSecBench mock adapter、Browser Service 與單一按需 Challenge Browser | 正常工具循環、identity/scope/deadline、protected effect、artifact publish、secret boundary，以及 Browser scoped navigation/fetch/WebSocket/download 和轉題整個 process/profile teardown 測試通過 |
| M1 Solver Loop（歷史已收斂為①） | OpenCode 上同 Solver 修錯、候選、獨立驗證與 oracle | ①獨立 3 次至少 2 次；已有 3/3 歷史記錄，不代表自主真題能力 |
| M1b 韌性 | ②獨立交付；③–⑥暫停，按實際需要取證 | 各軌跡原 2/3 判據保留，未完成不算通過；不阻塞自主首題探索 |
| 自主首題（獨立當前主線） | 現成題原始輸入 → 自主求解 → 獨立驗證 → local oracle | 無額外解法提示，權威確認整題完成；一次僅證明該題，不等於泛化或 API 閉環 |
| M2 TSecBench Live Single | 宿主 VPN、prepare/start、list/start/ready、多地址、單題 solve/verify/submit | 相對 first-List baseline，本 run 的 confirmed Submit（或 clean/exclusive 下無歧義對帳）確認至少一道新完成的題；多 flag 的部分 accepted 不算整題；不要求故意製造 partial／rejected |
| M3 Host Portfolio | 完整列表、最多三活躍 instance、多題 Scheduler、close／切題、checkpoint／fail-stop | Fixture 覆蓋三 instance 和錯誤分支；真實任務枚舉全部支援題、跨題調度並至少一題 accepted |
| M4 ARM64 Package | 一鍵 Core image、固定依賴、host VPN、既有單 Browser、最小 formal egress、ARM64 recipes、host/image parity | 原生 Ubuntu ARM64 重跑 M0–M3 契約，以 raw curl/socket/browser 驗證公共／跨題／平台控制旁路失敗，並以另一個預登記 TSecBench 開發 task 取得至少一個 accepted；冷啟動無下載 |
| M5 Delivery Hardening | 容器 VPN、多 browser/noVNC、多身份網絡、callback、CTFd、rCTF、未知平台等獨立 capability tracks | 每個被聲稱支援的 profile 只需通過其依賴 track；未使用或其他平台 track 不阻塞 TSecBench run |
| M6 Formal Acceptance | 使用者靶場單次登記 run、完整報告、資源度量 | 第 12.5 節門檻、零虛假成功、全部支援題保留在分母 |

確定性 schema、state、adapter、Runtime 和 policy contract tests 每次都必須全過。M1／M1b 六條模型工作軌跡固定 model ID、參數、prompt/template、工具版本和預算，各自以乾淨狀態獨立運行 3 次，至少 2 次成功；三次結果全部保存，不能只展示最佳 run。M2 是 M3 同一個預先登記真實 task 的中途 Gate：不中途 reset，不合併其他 run，M3 以同一完整軌跡判定。M4 使用新的預登記 task，不能用 host 已接受狀態冒充 image 成果。

M5 不是單一全有或全無的 M6 前置階段。某個正式 profile 只依賴它實際使用的 capability tracks；例如 TSecBench＋宿主 VPN＋單 Browser 的正式 run 不等待 CTFd、rCTF、容器 VPN、noVNC 或未知平台完成。

**M2 首次 live 與完整交付分開：** 首次單題探索保留憑據隔離、scope、ready、候選／提交綁定、預算與 deadline、首次 List 保守時間錨、不明提交不盲重試、資源清理及所用路徑必要測試。完整 §12.3 crash／恢復矩陣不全部前置於首次探索；未驗證的恢復路徑不啟用，遇故障停下。完成首次 live 不代表完整 M2 或 formal gate 通過；本節後續契約與正式驗收要求不刪除。

### 12.2 M1／M1b 六條工作軌跡（保留判據，非首題探索前置）

以下每條依上節的固定配置 `2/3` 規則判定，不以同一次 conversation 的重試冒充三個獨立 run：

1. 腳本存在語法／參數／解析錯誤；同一 Solver 讀 raw error、局部修正並成功執行。
2. 一項機制前提被有效反證；保存反證後切換不同 route，不因沉沒成本原樣重試。
3. 長作業在 Worker 釋放後完成；completion event 以保存的 handle/cursor/next action 恢復後續步驟。
4. 強制 compaction／新 session 後，Agent 取回必要原始輸出並執行正確下一動作，不重跑已否定 fingerprint。
5. Verifier 通過但平台明確 rejected；系統檢查提取／編碼／slot／generation／假設後繼續，而非標 solved 或終止題目。
6. 多 flag 題得到 partial；保存 accepted slot 和權威得分，繼續求解剩餘 slot。

### 12.3 TSecBench fixture

Fixture 固定 `tsec-benchmark 0.1.2` 已核實契約並覆蓋：

- Token 缺失／錯誤的 `404 task_not_found`。
- 無分頁完整 list、description null、無 category／附件、difficulty/level type。
- pending→available、stop_pending→stopped、多地址和最多三個活躍 instance。
- start 超額、任務結束、完成後 Hint 等不同 `invalid_state`。
- Submit 200/`correct=false`、partial、complete、duplicate、matched slot、分數作用域。
- Hint null、Hint effect unknown 和 response loss。
- First List 的 durable start intent、dispatch、response、manifest commit 各窗口 crash；原 anchor/deadline 不重寫，post-start admission 前不派工。
- Start／close 可由 list 對帳；submit／Hint 無 history 時局部 unknown。
- 恢復後 deadline 不重置、accepted score 不重複累加。

### 12.4 Runtime、State 與恢復 Gate

- Session 偽造 run/task/lease、越界 workspace 和直接平台提交被拒絕。
- `job.read` 在 job 運行時立即提供新 bytes；發布 evidence 後舊 ref 不因後續輸出改變。
- Local job response loss 可查既有 job；確認 fail-stop 後可建立新 attempt，不建立整題 quarantine。
- Protected effect 在 prepared、dispatching、response-before-commit 窗口注入 crash；unknown 不重發且只隔離相應 scope。
- Durable job watch 在 terminal/lost event 後只讓一個 canonical continuation 取得 runnable claim；重複 outbox delivery 不重複續跑。
- Replay/recompute/evidence-audit 分別測試；Verifier 不可為限次／一次性題重開連線或 reset，stale candidate/generation 不可提交。
- Engineer publish error、Verifier rejected／inconclusive／stale 都有確定 transition；candidate 不會卡在 engineering/verifying，也不會繞過 current verification。
- Host-dev 只在 raw target 對普通 job 不可達的 broker fixture 驗證硬限額 accounting／拒絕，不宣稱一般宿主 raw-socket 非繞過性。
- Core 對正式聲稱支援的硬限額 route，普通 job／browser raw client 必須不可達，超額在發送前被受管 transport 拒絕。
- Formal Core 的任意 Tool job／Challenge Browser 對公共 web、provider 直連、平台控制面、其他題目和未批准地址均不可達；這個 Gate 不依賴 M5 的雙 bridge／多 browser 能力。
- Host-dev Supervisor crash 後舊 process groups 停止；無法證明時不續跑。
- Core crash 後舊 container 必須停止，全部連線標 lost；新 Core 從 checkpoint 續跑且不延長 deadline。
- Canonical state 不引用半發布 artifact；mutable workspace 變動不改寫舊 published ref。

### 12.5 正式解題驗收

正式 run 使用使用者提供的已授權平台或本地靶場：

1. 完整列舉全部可見項目並凍結 Web、Misc、Crypto、out-of-scope 題目、required flag slots／unknown-total、oracle 和分類依據；任何 locked、ambiguous 或 discovery incomplete 項目使 admission 返回 `insufficient_gate_coverage`。
2. Pwn、Reverse 等 out-of-scope 題目列出但不進入分母。
3. 每道支援題完成 intake，並留下至少一個真實 experiment result 或可核實 blocker。
4. 使用預登記 model、Reference、工具、Worker/browser、時間、token、instance、Hint 和 remote-unit 預算，只運行一次正式 run。
5. 診斷重跑使用新 run ID，不能合併或覆寫正式結果。

Pre-start admission 在首次 List／正式計時前必須：

- 取得新建／可核實 reset 且由本 run 獨占的 task/account 證據，以及任務頁可得的初始 score／Hint／resource 證據；無法證明 clean 時不 dispatch first List。
- 保存非 secret task ref、平台時間來源、duration／elapsed／deadline、來源引用和觀察時間；Challenges API 不返回這些字段時，不能只用本地猜測宣稱 formal timing。
- 保存人工介入政策。計時後 secret refresh／VPN reconnect 只有在前後狀態證明沒有題目副作用時可繼續；人工解題、提交、instance 操作或 Challenge Browser 控制使 run invalid。

First List 取得後進行 post-start admission，在任何求解／instance／Hint／submit effect 前：

- 將 List 保存為 manifest/progress revision 0，與新建／reset 證據共同確認初始 accepted/completed 和 resource baseline；不 clean 時本次 formal attempt 收尾，不把已啟動 task 偷換成新的正式 run。
- 完整分類全部可見項目並凍結 evaluation category。只有平台可信 difficulty 可進 easy／medium／hard；模型難度只供 Scheduler，其他題進 unknown-difficulty。
- 確認至少一個 easy、medium 或 unknown-difficulty 題目進入可計算分母；空集合或只有 Hard 題返回 `insufficient_gate_coverage`，不形成 vacuous pass。
- 所有條件通過後才從 `admitting` 進入 `running`；失敗可以另建 Live run 接續已消耗的 task，但不能 retroactively 把該 formal attempt 算成 live 成果。

只計本 run confirmed Submit 或無歧義 reconciliation 造成的 accepted transition。先前 accepted flag、人工提交、校準 run 或其他 actor 的進度不能進 numerator。帳號／task 失去獨占性時停止正式歸因。

通過規則保留：

- 有可信難度時，`ceil(easy_count * 60%)` 和 `ceil(medium_count * 30%)` 均須 solved。
- 部分題有可信標籤時，unknown-difficulty 子集另以 `ceil(unknown_count * 45%)` 判定。
- 完全沒有可信難度時，全部支援題使用 `ceil(in_scope_count * 45%)`。
- Hard 題仍調度和報告，但不影響版本門檻。
- 若 easy／medium／unknown 三個可計算分母全部為零，結果為 `insufficient_gate_coverage`，不能通過。
- `partial`、`candidate_only`、`verified` 但未被平台接受均不進 solved numerator。
- 多 flag 題只有平台 challenge-complete 或全部凍結 required slots 被接受才算 solved。
- 系統自身故障計未解；獨立確認的外部平台故障標 `infrastructure_invalid` 並保留在報告／原分母，該 formal run 不通過，也不能靜默刪題後重算。
- 不再要求每題 Triage、Recon、Reference、Strategy、Solver、Engineer、Verifier 都有獨立 dispatch；Engineer／Verifier 只對候選路徑強制。

到 `stop_new_experiments_at` 後只完成已在途實驗和候選收尾；硬 deadline 後不得發起模型、工具試驗或 submit。已授權 cleanup window 可在 deadline 後關閉本 run instance並封存報告，cleanup 失敗不改寫 accepted 結果。

### 12.6 能力與成本度量

每個開發／正式 run 至少記錄：

- 從 start 到第一個有效 experiment 的牆鐘時間。
- Solver 連續工具回合、工具錯誤數、局部修復成功率和 Strategy 回退次數。
- Candidate 產生、Engineer 發布、Verifier 完成到平台 accepted 的各段時間。
- 各責任的模型 token、調用數、工具等待和切換成本。
- Observation 可見延遲、artifact 發布等待、hash/I/O bytes。
- 各 blocker code、持續時間、unknown protected effect 和 quarantine 範圍。
- Compaction 後重做的失敗 fingerprint、取回原始輸出次數和 next-action 成功率。
- Fail-stop 次數、checkpoint 恢復時間、重算時間、丟失連線／instance 的得分影響。

這些度量決定是否需要進一步合併職責、調整資料窗口或重新設計存活 executor adoption。沒有數據前，不以更多 Gate 或 control protocol 推定收益。

## 13. 實施前輸入

輸入責任分為：

| 提供者 | 責任 |
| --- | --- |
| 產品／release 維護者 | 固定受支援 OpenCode 版本、provider adapter、host OS 矩陣、fixture、Reference snapshot、Core tool manifest 和原生 ARM64 release environment |
| Run 使用者 | 從已發布矩陣選 model/profile，提供 credential refs、授權入口、TSecBench task/Token/Base URL/VPN、task time/baseline evidence 和 run budget |
| 實施團隊 | 建立本地 mock、CI、build script、schema migration 和各里程碑測試；不能把缺少外部真實任務寫成已通過 |

M0／後續 Gate 需要：

- Host-dev 的 macOS／Linux 版本、CPU/RAM/disk、可用 shell／browser／工具清單。
- 固定 OpenCode 版本、provider、model ID、Base URL 和 credential 注入方式。
- 可合法打包的離線 Reference 來源和許可清單。
- TSecBench mock fixture 所需的官方公開 schema／SDK 0.1.2 package。
- 兩個彼此獨立、由使用者預登記且可接受計時／配額消耗的 TSecBench 開發任務：task A 供不中斷的 M2/M3 host 軌跡，task B 供 M4 Core image 驗證；各自提供 Token／secret ref、Base URL、時間／基線證據，並共用或分別驗證宿主 VPN。
- 一個可控制 partial、duplicate、invalid_state、response loss 和多 instance 的本地 fixture。
- Core 目標 Ubuntu ARM64 host 的 kernel、Docker Engine、CPU/RAM/disk 和宿主 VPN 路由資料。
- M6 使用者靶場入口、乾淨帳號／任務基線和正式 deadline／budget。
- 本地靶場若要計 solved，需提供符合第 5.5 節的 local-oracle adapter／fixture；只有入口而無 oracle 時預期結果就是 candidate-only。

缺少 task A／真實平台時，可以完成接口和 fixture，但不能聲稱 M2 或 M3 已通過；缺少 task B 或原生 ARM64 host 時不能聲稱 M4 已通過；兩者都不能由 mock 替代正式驗收。

## 14. 研究依據

### 平台

- TSecBench Challenges API／Agent Prompt：<https://tsecbench.zc.tencent.com/assets/IntegrationGuide-C2ra4-Qu.js>
- TSecBench SDK 0.1.2：<https://pypi.org/pypi/tsec-benchmark/0.1.2/json>
- TSecBench 運行頁計時：<https://tsecbench.zc.tencent.com/assets/BenchmarkRunningView-D0TcBN17.js>
- TSecBench 本地／托管模式：<https://tsecbench.zc.tencent.com/assets/BenchmarkModeView-B30HkZ3R.js>
- CTFd API：<https://docs.ctfd.io/docs/api/getting-started/>
- rCTF：<https://github.com/otter-sec/rctf>

### Agent 循環

- EnIGMA／SWE-agent 固定提交 `084d5d164729ddcbe8fbc05877ead403549ef669`：action-observation、interactive session、lint rollback。
- NYU CTF baseline／D-CIPHER 固定提交 `612190f298ae9e604f00370019beed4ba1f372f6`：工具錯誤回灌、Planner/Executor 內多輪操作和 observation 裁剪。
- Cybench SimpleAgent 固定提交 `ca483c6443f17a20ba7d6bac3d274859a1721e51`：工作計劃、下一命令和有限歷史。

上述比較只用於循環與工具設計，不用不同題集、模型或預算推論解出率高低。

### OpenCode、工具與資料

- OpenCode Agents：<https://opencode.ai/docs/agents/>
- OpenCode Plugins：<https://opencode.ai/docs/plugins/>
- OpenCode Permissions：<https://opencode.ai/docs/permissions/>
- Playwright BrowserContext：<https://playwright.dev/docs/browser-contexts>
- Docker Resource Constraints：<https://docs.docker.com/engine/containers/resource_constraints/>
- OWASP WSTG：<https://owasp.org/www-project-web-security-testing-guide/>
- MITRE CWE：<https://cwe.mitre.org/data/downloads.html>
- CryptoHack：<https://cryptohack.org/>
- PortSwigger Web Security Academy：<https://portswigger.net/web-security>

## 15. 歷史未驗證事項（2026-10-15 快照）

以下保留設計初稿當時的缺口，不是 2026-10-20 現況或待辦；M0／M1 及 DVGA 後續證據以各 plan 為準。當時尚未：

- 實作 macOS／Linux host-dev Supervisor、State、Tool Runtime 和 OpenCode contract。
- 建立 TSecBench fixture 或調用任何私有題目 API。
- 以真實模型完成六條 M1 Solver 工作軌跡。
- 從宿主 VPN 完成一次真實 TSecBench accepted 或多題功能 Gate。
- 實作三級 effect、即時 observation／發布 evidence、局部 unknown 對帳和 compaction 續跑。
- 建立一鍵 ARM64 Core 構建腳本或在原生 Ubuntu ARM64 驗證 image parity。
- 驗證宿主 VPN 到 Core 的實際路由、單 Challenge Browser 和 ARM64 tool recipes。
- 實作 CTFd、rCTF、未知平台、容器 VPN、多 browser、noVNC、雙 bridge 或 callback。
- 從使用者提供的真實入口完成一次 M6 正式 run。

這些必須由實作和實際軌跡證明，不能由本文、官方文檔或 mock 單獨替代。

## 16. 本輪決策與實作可調項

本輪使用者已確認：

- 只修訂現有設計，不另寫 implementation plan。
- 按 TSecBench 單題閉環、Solver 連續調試、多題調度、封裝和後續恢復／硬化的順序收斂。
- M0 的 host-dev 採受管進程樹 fail-stop；M4 Core 採整個容器 fail-stop，兩者都不原地接管存活 executor。
- Runtime 按副作用分三級；即時 observation 與發布 evidence 分離。
- 職責固定、會話自適應；正式 Gate 要求有效 experiment 或 blocker，不要求無候選題執行 Engineer／Verifier。
- TSecBench 首發只做本地 API 薄適配，宿主 VPN 優先，單題按需 Browser。
- 先在跨平台 host-dev 完成 fixture、真實單題和多題功能 Gate，再首次打包 Docker。
- Compaction 使用短工作集和按需回取；高級原地接管是否立項由實測決定。
- 確定性測試全過，M1 固定配置採 2/3；Formal 計時後只允許可對帳無題目副作用的 secret／VPN 基礎設施恢復。

Builder 可決定程式語言、進程通訊、SQLite schema 細節、job stream buffer、artifact chunk 大小、模型 prompt、默認 repair/window 上限、build system 和工具精確版本，但必須：

- 保持 host-dev／Core 的公開契約和 fixture 一致。
- 不把普通本地動作重新提升為全域 durable quarantine。
- 不讓模型手算／搬運 hash 或用 hash 取代實際狀態判斷。
- 不削弱 Platform Service 唯一 credential／effect 出口、獨立候選驗證、硬遠端預算、權威 solved 和禁止盲重試。
- 將任何會改變上述產品行為的取捨帶回設計決策，而不是在實施中暗改。
