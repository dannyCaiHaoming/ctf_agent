# design v1 D 最小版詳細 design：產物交接、候選、獨立驗證與可信完成

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：接口一按首題最小邊界已接入主工作區並完成主區無模型回歸；尚未 commit。H1 原完整條件未通過及 H5/H7 限制保留。接口二最小契約已由隔離區原型及主核對成立、主區尚未接入；後三接口仍為待驗候選。** 本文是 [核心 design v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 D 的詳細子文件；D 的接口細節與待決問題以本文為準。本文只寫設計，不授權產品修改、驗證 session、真實模型運行或 commit。下文「推薦候選」是本次設計建議，不冒稱已驗證或已批准的外部接口。

## 1. 目的與範圍

盡快讓一道題經現有 E 接入，由核心 v1 的既定團隊動手解題，將真實產物交給 Engineer 整理，再由獨立 Verifier 檢查，最後讓 Coordinator 根據有效驗證與可信完成結果決定繼續或結束。

沿用 Coordinator、Intake/Triage、Target Recon、Reference、Strategy、Domain Solver、Solution Engineer、Verifier、Recovery Critic 九項職責。簡單職責可自適應合併，職責不消失；Verifier 必須獨立，Recovery Critic 按持續停滯觸發。D 提供能力，不決定解題路線，不另建 Solver、調度器、provider 循環或硬編碼全隊執行順序。

本次只補五處直接接口：

1. 解題角色向 Engineer 交付宿主固定的文件與工具輸出。
2. Engineer 整理解法包，固定候選及其提取方式與實際依賴。
3. Coordinator 向獨立 Verifier 分派指定版本及必要證據。
4. Verifier 交付判斷，宿主核實綁定並保存結論及失效條件。
5. Coordinator 根據有效驗證提出提交／判定，由宿主取得可信結果。

**完成層次分開：** 接線通過、真實 Agent 能完成協作、候選經獨立驗證、整題 solved 是不同結論。沒有可信裁判也可探索及驗證，結果至多 candidate_only；不能為湊齊流程虛構平台或 oracle。

## 2. 沿用的已定設計與現狀

| 來源 | 已有能力／決策 | D 承接處 |
| --- | --- | --- |
| [E](2026-10-23-design-v1-e-intake-minimal.md) | 宿主固定題面／附件，Intake 只讀並由原生 task 交接 | 使用既有 challenge 與材料來源，不重做取題，不讓模型填入裁判秘密 |
| [G §2–3](2026-10-23-design-v1-g-solver-minimal.md) | C 綁定題目與真實會話；materials 同題共享只讀、work 會話私有、published 預留同題共享讀取 | D 補 published 的可信寫入及引用解析，不能讓角色直接讀另一會話 work |
| G §6–7／[C](2026-10-23-design-v1-c-control-service.md) | 既定角色權限、共享准入、原生分派／背景交付、停止、可信工具資源記錄 | D 使用同一條插件／C 路徑；結果回傳沿用原生 task，不另建消息循環 |
| 核心 v1 §1.3 | replay／recompute／evidence_audit；候選及實際依賴變更使驗證失效；可信裁判才可確認整題完成 | 保留判定標準，不以 D 接線方便降低它 |
| G §9.1–9.2 | 同入口團隊接線已驗，Engineer／Verifier 只各自讀材料算出結果，published 為空 | 不是 Solver → Engineer → Verifier 的候選證據鏈已通過 |

**已知運行限制仍保留：** G 的受管路徑拒絕不等於 OS 隔離。同 uid job 曾能改其他目錄及直連網路。D 的 hash／版本檢查不能修復該邊界；可以先用非秘密資料驗接口，但不能據此宣稱能安全放入私有 oracle 答案。具體秘密存放與判定通道見 §7，不展開 G 已延後的容器部署工程。

## 3. 接口一：解題產物交給 Engineer

### 已定責任

Recon／Domain Solver 保存腳本、觀察與輸出，選擇交付下一角色所需材料；宿主核實來源並固定內容。Engineer 取得可讀產物後才能整理。不能只允許 Engineer 在最後發布，否則它無法取得 Solver 的私有文件。Reference／Strategy 的建議仍可走既有 task 文本交接，不為每句討論新增產物工具。

### 首題最小版已定設計

採「來源角色提出交付，宿主建立固定快照與同題引用」。來源角色只選本會話文件的虛擬路徑，或自己有權讀取的 job／HTTP 輸出及必要範圍；宿主填 run、challenge、session、execution、內容 hash、大小及實際來源。模型不提交宿主絕對路徑、任意 hash 或其他會話身份作授權。

宿主回傳穩定引用及可用的 `published/` 虛擬路徑；原生 task 帶引用與必要說明交回 Coordinator，後者交給 Engineer。同題讀取沿用 G，發布不包含控制日誌、provider 憑據、oracle 資料或完整私有推理。Engineer 的整理產物可再固定成新引用；不覆寫舊版，不開放 Agent 直接寫 published。

| 候選 | 取捨 |
| --- | --- |
| 宿主快照後提供 published 映射（採用） | 維持 work 私有、可校驗與重用既有讀取；採宿主登記表及實體快照，所有 published 讀取共用該權威來源 |
| 給 Engineer 直接讀 Solver work | 無法固定版本且破壞 G 邊界，不採 |
| 只用 task 文本傳腳本／輸出 | 可補充說明，但不足以固定大量／二進位證據，不作產物交接替代 |

### 接口選擇與限制

首題最小版採用宿主獨立 UUID 登記表作同題引用權威，發布為實體快照；新發布產生新引用，不依內容去重或覆寫舊版本。引用讀及 G 的 published 讀取／列表／搜索共用登記表，拒絕未登記或 hash 損壞內容，不直接暴露舊 ArtifactStore 的宿主 path。模型工具名稱 `artifact.publish`／`artifact.read` 已在主區接入並通過無模型驗收。

job／HTTP 來源由宿主在原操作捕獲 bytes 及 session、resource、call、execution，不從可編輯 work 副本重新認定來源。文件僅能追溯內容匹配的最後一次受管 workspace.write；其他文件的原始 producer execution 記 unknown/null，發布選擇 execution 另記，不能偽稱腳本執行收據。原型僅允許已有原生背景 execution 發布；前台發布未驗，不創造身份補齊。

完整性分為固定快照、所選區間完整、原輸出完整三項。截斷輸出可發布觀察片段，但原輸出完整性為 false；普通文件原輸出完整性為 unknown。未結束 job 不發布。原型每文件／輸出流最多 1 MiB、讀頁 32 KiB，是實測界限，不代表 run 級保留配額已設計。

固定文件使用不跟隨葉 symlink 的 descriptor、前後路徑／inode／大小／時間檢查，受控競態會拒絕；這不是任意惡意並發下的原子快照。發布臨時寫入、rename、再次確認存活後才登記；讀取再次校驗 bytes/hash。**成立條件仍是可信穩定根與無不受管並發寫入；同 uid 可直接改 published 的反例仍成立。** hash 能檢出損壞，不能提供 OS 隔離，不把容器部署加回本次範圍。

### 本輪核對及未解決項

主 session 核對源碼、來源與最終 hash、原始 bytes，並獨立復跑；證據見 [主核對記錄](../../gates/d-artifact-handoff-20261024/parent-review/README.md)。版本為 HEAD `c652e95` 上的未合併原型（精確差異與源碼 hash 見證據），Node 26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0。

| 判據 | 結論與實際邊界 |
| --- | --- |
| H1 文件交接 | 同一 E→Solver→Coordinator→獨立 Engineer 原生鏈路，四份產物實際發布、引用交接、逐 byte 讀回；未預置 published、未用 SDK 注入內容。但 27/27 原生請求含宿主 cwd/instructions 絕對路徑，完整無私有路徑條件**未通過**。工具回复乾淨不能替代整體條件。 |
| H2 工具輸出 | 同一 runtime 的真實 job stdout 與 loopback HTTP body 交接通過；原執行來源一致，HTTP work 副本篡改不改可信 bytes 另有定向測試。 |
| H3 版本與來源 | 舊快照固定、新引用分開來源；跨 execution 保留受管 producer，未知 producer 不猜；並發發布審計各綁自身 ref。定向通過。 |
| H4 授權與路徑 | 跨題/run、越權、偽身份／引用、sibling、路徑穿越／symlink、未綁定／停止拒絕；published 讀／列／搜共用登記表。僅受管 API 保證。 |
| H5 並發固定 | 明確 barrier 的同長改寫、rename、父目錄／symlink 替換及讀塊間寫入均拒絕；靜止版本可讀。有條件成立，同 uid 破壞反例保留，不能宣稱任意並發安全。 |
| H6 完整性 | 真實超限 job／HTTP、區間／分頁、未結束 job 與失敗 HTTP 定向通過；快照／區間／原輸出三義分開。 |
| H7 失敗與 unknown | 原組件故障證據保留；本輪已經真實插件／C RPC 的 R1 回复丟失、R2 停止先勝、R3 提交先勝並由 native abort 丟棄遲到回复驗證及主復跑。最小契約有條件成立，具體判據與模型選擇邊界見下節；未驗恢復／跨重啟。 |

主復跑 83/83 定向測試（含 22 項 D）通過；原生 runtime 以本地預定替身完成 27 次請求，發布 4／41／16／14 bytes，真實模型調用 0。子區原有 345 項全套與 typecheck/build 日誌保留。這不證明模型協作能力、D 整體完成或 solved。原始失敗及早期將 H1 簡寫 passed 的記錄原樣保留，以本節限制及最終原始請求糾正，不拼接各批成功。

### 首題接入的當前邊界與延後項（2026-10-24 決策）

- **H1：** 保留產物接口只接受引用／虛擬路徑、宿主授權、Engineer 不讀 sibling work 的要求。原生 cwd／instructions 路徑隱藏延後，不作首題產物交接前置；原始 H1 全上下文無私有路徑判據仍未通過，不重標為成功。路徑可見不等於已讀到其他會話文件，也不證明秘密隔離；不可把私有答案／憑據放進同 uid job 可讀位置。
- **H5：** 首題採「寫完再發布」：相關 job 結束、文件寫入完成後固定，保留路徑／descriptor 前後檢查及讀取 hash 校驗。發現變化即拒絕本次發布，回交來源角色處理，不能交付半成品。可信穩定根與無不受管並發寫入是運行條件，提示詞不是 OS 強制保障。抵禦任意惡意同 uid 寫入、OS 原子快照及容器部署延後；需要邊寫邊交付時再提出具體依賴，不預先擴展。
- **H7：** 當前必需契約是失敗不冒充交付：未確認的可讀引用不能記為已交給 Engineer；拒絕／損壞明示失敗。宿主發布已提交但 RPC 回复未知時，保留宿主真實記錄，調用方保持 unknown／未確認，暫停受影響交接，不自動重跑來源 job／HTTP，也不盲目重發發布。這不等於停止整題一切無關觀察。停止先於發布提交時不產生可用半引用；提交先於停止時保留已固定事實，但不把停止後的遲到回复當成新交付授權。真實插件／C 的本輪觀察見下節；不把預定替身的 unknown／不重試決策當模型能力或宿主對新調用的強制封鎖。

本輪已完成 H7 的真實 RPC 回复丟失與停止競爭最小驗證及主核對；沿用原生背景任務、C 准入／停止及既有發布登記表，不建立另一套調度。自動找回引用、冪等重試、跨重啟恢復和恢復系統延後，代價是異常時可中止本次交接或交人工處理。原型僅支援背景發布、未知文件 producer=null 的限制繼續保留，不藉本輪擴成前台來源或執行收據。D 後四接口仍待驗。

### H7 真實鏈路核對結論（2026-10-24）

**採用的語義：發布提交、RPC 回复、Engineer 已讀取分開認定。** 傳輸失敗不能被解釋為確定未提交；停止不能抹去先前已固定的產物。只有確認引用及實際讀取才支持交接成功。沿用現有原生停止與 C 資源收束，無須為首題增加恢復系統；原型仍未合併主區。

| 場景 | 主核對原始觀察 | 支持的結論 |
| --- | --- | --- |
| 對照 | 真實 job 產生 18 bytes；發布後經原生 task 交引用，獨立 Engineer 逐 byte 讀回 | 正常產物交接成立 |
| R1 提交後回复丟失 | C 已登記，真實 HTTP socket 被斷開；plugin 工具為 `denied: control unavailable`，宿主仍有完整發布記錄與原 bytes | 調用方未確認，不能宣稱交付或認為來源未執行；plugin 不自動重試同一調用 |
| R2 停止先勝 | 真實 rename 在提交前由 barrier 暫停；Coordinator 原生 `ctf_task_stop` 到達 C 撤銷 execution 後放行；返回 cancelled，零引用且無殘檔 | 停止先勝不留下可交付半產物，資源收束 |
| R3 提交先勝 | 登記後延遲真實 HTTP 回复；原生停止使等待連接關閉，釋放回复時 socket 已 destroyed；工具為 `Tool execution aborted`，既有記錄保留 | C 發布 resource completed 與來源 execution cancelled 可以同時為真；native abort 丟棄遲到回复，不生成新交付 |

依據：[主核對與原始證據](../../gates/d-h7-rpc-stop-20261024/parent-review/README.md)。主 session 核對最終 17 個來源／244 個證據 hash，並在未合併 D 原型上獨立復跑 56/56 定向測試與同一新批四案。四案發布數為 1/1/0/1，每案來源 job／發布各一次，資源全部 settled。Node 26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0；使用 loopback 預定替身，真實模型調用 0。完整最終源碼指紋及版本隨證據保存。子區既有全套 348 項與 typecheck/build 記錄保留，本輪未新增產品邏輯修改。

**驗證邊界：** 注入只安排真實 IO／傳輸時序；recon 替身在 barrier 到達後經原生完成通知喚醒 Coordinator，不是模型自行辨認停止時機。R3 沒有證明「原生插件成功收到遲到回复後再次拒絕交付」；它證明的是連接被取消、回复未送達。組件測試收到遲到結果的情境不能混為原生 runtime 成果。

錯誤傳遞與同一調用不自動重試已有程序證據；`UNKNOWN`、不再次請求來源／發布、暫停交接是替身預定決策。**尚未證明真實模型會遵守，也未實作對仍活躍模型新調用的 unknown 強制鎖定。** 保留為後續有預算的模型協作驗收邊界，不藉本輪擴展恢復系統。自動找回、冪等、跨重啟仍延後；H1/H5 的當前條件與舊失敗不變。此輪沒有新失敗驗收批，但所有傳輸錯誤／取消原始狀態和前輪失敗仍保存，不以 exit 0 宣稱 D 整體或 solved。

### 定稿與接入完成條件

在已確認的 H1/H5/H7 邊界內，接口一沒有新的可行性研究前置。定稿僅指背景來源角色的文件／job／HTTP 固定發布、同題引用、原生交接及 Engineer 讀取；不是 D 整體定稿，也不代表原型已在主區接入。

接入沿用既有原型：Recon／Domain Solver／Engineer 可發布及讀取，Verifier 僅讀取；Coordinator 透過原生 task 交接引用，不取得直接發布權限。維持宿主來源與權限綁定、寫完再發布、1 MiB 文件／流與 32 KiB 讀頁界限、未知 producer 不猜、完整性三義分開。這些上限限制首題可交付產物的大小，不承諾任意附件都可原樣發布。

剩餘實施工作是整合已驗代碼、同步工具與既定角色的使用說明，以及在接入版本上驗收。說明應明確：來源角色交回工具實際返回的 ref 與必要說明，不以 work 路徑或自填身份代替；Engineer 讀取需要的頁及完整性標記後才確認取得材料，改寫產生新引用；發布成功不等於已讀取，不等於候選登記／verified／solved。傳輸錯誤保持未確認，不猜未執行，也不因缺引用重跑來源或盲目重發；不擴成 unknown 強制鎖定或恢復系統。

接入驗收需保留既有權限／來源／競態／截斷回歸，在同一新 runtime 批次完成文件、腳本、job、HTTP → 原生交接 → Engineer 逐 byte 讀回，並在最終接入版本重驗 H7 對照及 R1–R3。原始失敗不刪除，H1 完整路徑條件不改判通過。真實模型是否會正確選材料、使用工具及遵守 unknown 策略仍未驗，需另有預算授權；這不阻塞本次程序接入。D 後四接口繼續按各節待驗，不加回本切片。

### 子區實現與主核對歷史（2026-10-24；後續主區接入見下節）

**接口一已在子工作區實現並通過主核對；主區產品未合併，不能直接稱主區已可用。** 實現位於 `/Users/caihaoming/.codex/worktrees/1488/pentest-agent`，沿用 `c652e95` 上已驗宿主原型，補齊 plugin 工具描述及 Coordinator／Recon／Solver／Engineer／Verifier 使用說明，修正探針對已刪計畫的依賴。沒有增加角色、權限、後四接口或延後工程。

主核對修正了一處 Engineer 說明：Engineer 只能發布自己的文件/job，讀取 Solver 已發布的 HTTP 引用，不能發布 Solver 的 HTTP resource；權限和宿主實作未變。來源角色發布與 Engineer 讀取、完整性三義、unknown 不猜和不盲目重跑規則已進入實際模型可見說明。

主 session 在修正後版本復跑 86/86 定向測試；同次四產物原生交接逐 byte/hash 相等，並核對 Coordinator/Solver/Engineer 完整正文與工具描述實際載入。H7 對照及 R1–R3 同一新批再次通過，發布數 1/1/0/1，每案來源／發布各一次，資源收束。子區原有最終全套 348/348、typecheck/build exit 0；角色文字修正後以實際載入及集成復跑驗證，未重跑未變全套。證據及精確來源見 [主核對記錄](../../gates/d-artifact-handoff-20261024/integration/parent-review/README.md)。

本輪收口的是子區程序實現及無模型驗收，並非真實模型選材／協作能力、完整 D 或 solved。H1/H5/H7 延後項與失敗證據全部保留。主區只有文檔及證據同步；後續產品合入需使用者另行授權，不因本結論自行合併或提交。

### 主工作區接入狀態（2026-10-24）

使用者授權後已逐文件接入 18 個核對版本的產品／測試／角色文件，來源與子區主審副本 hash 一致。`artifact-tools`、C 來源／發布登記、G job/HTTP 原 bytes、published 共用授權讀／列／搜、plugin/schema／配置白名單、角色使用說明及既有驗收探針已在主區；Engineer HTTP 來源說明修正包含在內。未整份套用子區文檔或加回延後工程，未 commit。

主區 typecheck/build 均 exit 0，全套 348/348；同次四產物原生交接及 H7 對照/R1–R3 各自新批通過。四產物 4/41/16/14 bytes、Engineer 實際讀取及 hash 一致；H7 發布數 1/1/0/1，來源／發布各一次且資源 settled。證據、來源與命令見 [主區接入記錄](../../gates/d-artifact-handoff-20261024/integration/main-integration-20261024/README.md)。舊失敗原樣保留，H1 全上下文路徑條件仍未通過，H5 運行條件及 H7 模型選擇／恢復邊界不變。

此狀態只代表第一接口的程序接入與無模型驗收；不代表真實模型能選材／協作、D 後四接口完成或 solved。後續候選與獨立驗證仍按下節待驗契約處理。

## 4. 接口二：Engineer 固定候選與解法包

### 已定責任

Domain Solver 提出候選及來源，Engineer 整理可驗證腳本、輸入、命令和提取方式；宿主固定精確內容與版本。Engineer 整理不是自動通過驗證，初始候選也不自動成為 solved。

### 採用方案：一次固定候選與完整解法包

**最小契約已由隔離區原型及主 session 無模型核對成立；第二接口尚未接入主區產品。** 草稿沿用原生 task／產物交接；Engineer 整理完成後，由宿主一次固定候選與解法包，返回不可變包版本引用。不採先正式登記候選再補包，避免可送驗半成品及額外草稿狀態。這不改變 Solver 提出解法、Engineer 整理、Verifier 獨立檢查的職責。

Engineer 讀取接口一真實產物，在自己的 work 整理腳本、輸入和提取方法；需重新採樣時交回 Solver。候選權威來源為已發布 ref 的非空半開 byte 區間；去日誌、解碼等轉換由既有本地 job 產生新文件／輸出再發布，保留來源與轉換說明。宿主不 trim、不轉換換行、不把字元位置當 byte 位置，也不新增通用提取語言。

### 固定與讀取契約

驗證原型名稱為 `ctf_package_publish`／`ctf_package_read`，接入時沿用此最小能力，不復活舊 candidate-control 或驗證／提交鏈。

| 輸入 | 約束 |
| --- | --- |
| `candidate: {ref,start,end}` | 同 run 同題的已發布產物；safe integer、非負、非空、未越界的半開 byte 區間。不收候選文字副本或模型自填身份/hash |
| `files` | 最多 32 項：`{kind:"artifact",ref,path,purpose}` 或 `{kind:"material",name,path,purpose}`。purpose 為 script/input/evidence；path 為明確相對位置，拒絕越界、大小寫/NFC 別名、重複和父子衝突 |
| `argv?`、`extraction`、`premises` | 建議命令、提取說明及必要前提；argv 省略為空。無腳本不捏造腳本，也不因此宣稱可重放 |

artifact 使用接口一可信發布表與 bytes 校驗；material 僅按本題 E PreparedChallenge 中的名稱及 size/hash 解析。宿主填入題目、Engineer session/execution、來源、hash 和版本，不依賴模型抄寫。來源未知、截斷和完整性標記原樣保留。

採用現有 ArtifactPublisher 的**一次 publish** 固定 manifest envelope；不增加平行候選 registry。manifest 綁定候選來源、區間、base64 bytes／size/hash、文件引用及來源／完整性、E 材料固定 bytes、argvStatus=`proposed`、提取說明和前提。候選與 E 材料內嵌，其餘產物沿用已固定引用。序列化包上限 1 MiB（含 base64／metadata 開銷），不是任意 1 MiB 候選或附件都能裝入。超限明確拒絕，不截斷包。

返回 `{version,manifestSha256,manifestSize,snapshotFixed:true,candidateSize,candidateSha256}`，version 是整包發布 ref。只有 Engineer 可固定包；C 核實角色、同 run 同題與原生 execution。原型僅為 Engineer 開放 package 工具；下一接口的 Verifier 可見性及任務綁定尚未接入。

`package.read({version,component:"manifest"|"candidate"|"file",path?,cursor?})` 讀明確版本；file 使用 manifest 中的精確 path。返回 base64、元件 size/hash、manifest hash、offset/nextCursor/done，每頁至多 32768 bytes。每次核對包本體、候選原引用及全部必要發布引用；任一損壞就拒絕整包讀取，不靜默替換。不提供 latest。

### 版本、完整性與停止邊界

版本指向固定內容，不指向當前 work 全目錄。修改候選或必要腳本／輸入產生新版本；舊版並發讀取不受新包或無關臨時文件影響。E bytes 已嵌入包，原材料後續變化不改舊包；新包仍須匹配 E 固定來源。尚無跨重啟恢復能力。

包完整只表示規定內容已固定、引用可讀、關係明確，不等於證據充分或驗證通過。argv 是提議，不是執行收據；來源關聯不是因果證明。snapshotFixed／rangeComplete／originalComplete 保持三義；截斷或未知不能變成完整。依賴是否充分由 Engineer 說明、Verifier 檢查，外部實例狀態未知就保留未知，不聲稱已凍結環境。

提交、RPC 回复與下游收到包分開。核對失敗或提交前停止不產生可用半包；提交後回复丟失保留固定事實，調用方保持 unknown／未確認並暫停受影響交接，不盲目重發或重跑來源。提交後停止不撤銷已固定事實，但遲到回复不授權繼續交接。這沿用 H7，不增加強制 unknown 鎖、重試或恢復系統。

### 已驗依據與接入剩餘

在 `c652e95` 加已接入接口一的來源上，ae52 隔離區使用 OpenCode 1.19.3、SDK/plugin 1.19.0、Node v26.3.0 驗證；主 session 核對起點與最終來源 hash、原始 bytes、公開 runtime 與失敗。只用 loopback 預定替身，未調真模型；usage 不可得記 unavailable。

| 契約 | 主核對結論 |
| --- | --- |
| P1 精確候選 | 成立：真實 Engineer job 從混合日誌 `[5,14)` 提取 9 bytes `e697977bc3a97d00ff`，再以新 ref `[0,9)` 固定；CRLF、UTF-8 中間 byte、二進位保留，非法區間拒絕 |
| P2 引用及依賴 | 成立：同次原生 E → Solver 發布 → Coordinator → Engineer 讀/整理/job/發布 → 整包固定與讀回；錯題、偽造、錯角色、損壞和歧義路徑拒絕，截斷／未知不提升 |
| P3 不可變版本 | 成立：修改 work／原 E 材料不改舊包，新候選／腳本形成新版本；並發舊版讀取通過，包或必要引用損壞被拒絕 |
| P4 失敗與停止 | 成立於本次可觀察邊界：正常／回复丟失／提交前停止／提交後停止的包提交數為 1/1/0/1；每案 2 個來源及整理 job、1 次整包請求。停止走原生 sibling 完成通知和 Coordinator 的真實 task id，無 SDK resume；無盲目重發或重跑 |

主 session 另起完整四情形批次 `parent-review-20261024`，exit 0，並復跑定向 35/35。子區最終全套 358/358、typecheck/build exit 0 的日誌與來源已核對。證據及精確命令見 [主核對記錄](../../gates/d-artifact-handoff-20261024/candidate-package/parent-review.md)，原 bytes、hash 與時序見同目錄 `parent-audit.json` 和 runtime 子目錄。

P3 曾暴露 snapshotFile 將父目錄新增 sibling 的 metadata 變化誤判為文件變更。原型僅將目錄檢查收斂為 dev/ino/type，leaf 仍核對 size/mtime/ctime；原有父目錄替換、symlink、混合讀取拒絕回歸通過。接入須保留這個直接修正，不稱 OS 隔離。缺接口 RED、P3 誤拒及 runtime-1 探針錯計發布數的失敗全部保留；後者未發出包請求，不當通過依據。

**剩餘是第二接口產品接入與接入版本回歸，沒有本切片新增的可行性阻塞。** 不是完整 D 定稿：實際包重放、依賴語義充分性、Verifier 綁定／結果和可信提交仍按後三接口處理；真實模型選材及協作仍未驗。預定替身遵守 unknown 不代表模型能力或宿主強制鎖。

延後項不變：正式草稿持久化、全目錄版本管理、通用依賴推斷、環境封裝、強隔離部署、跨重啟恢復及自動重試。

## 5. 接口三：固定材料交給獨立 Verifier

### 已定責任

Coordinator 決定何時驗證，沿用 G 的 assign 與原生 task 分派獨立 Verifier 會話。Verifier 接收固定候選／解法包、必要題面與證據，以及明示的前提和未知項，不接收 Solver 完整推理上下文。不得以另一個自造 session ID 冒充獨立。

### 推薦候選與待驗契約

宿主先登記待驗的候選／解法包版本，再將該次驗證綁到 C 核實的 Verifier session 與 execution。具體透過哪個受管入口登記、如何與原生分派銜接仍待驗；不從 prompt 自由文字決定授權，不建立另一套 ResponsibilityRegistry 會話身份。

Verifier 在自己的 work 準備必要文件，用 G 已有工具操作，結果沿用原生完成交付。job／HTTP 輸出記錄要能追溯到此次真實執行及所用固定輸入，不能由模型上傳一份聲稱「執行成功」的 JSON 取代。如何把固定輸入複製到驗證 work、比對實際使用版本與命令，是 D/G 的直接接口問題；不預先假設任意腳本全部依賴都能被自動捕獲。

- **recompute：** 重算保存輸入及提取鏈；G 已有本地 job，可先驗公開接線，但重算出同一值本身不證明解法成立。
- **replay：** 僅在操作確實可安全重放時使用；Verifier 普通 HTTP 仍不開放。若實際題目需要網路重放，先定該路徑的可信模式與狀態條件，不順手建通用重放平台。
- **evidence_audit：** 審核必要執行順序、狀態、來源、提取位置與不可重放理由；證據不足保持 inconclusive。不能因重放接口未做就無條件改稱審計通過。

尚待驗：宿主指定候選版本與首次 Verifier 准入的銜接、錯角色／外來任務拒絕、同 Verifier 新 execution 不誤用舊候選、停止及預算拒絕後不再放行驗證操作。復用 G 已驗生命週期，不重做整套分派研究。

## 6. 接口四：驗證結論與有效性

### 已定責任

Verifier 負責方法、前提、反例及證據支持程度的判斷；宿主負責可機械核實的身份、版本、執行記錄和證據關聯。兩者均必要：模型自述不能直接改可信狀態，hash 相同或工具 exit 0 也不能代替獨立判斷。

### 推薦候選與待驗契約

Verifier 提交判斷、模式、理由及具體證據引用；宿主對照此次綁定保存判斷與檢查結果。推薦只有在 Verifier 明確通過且宿主必要核對通過時，才記為可用的 verified 結果。具體欄位與核准入口待驗，不能只解析 task 文本中的「通過」關鍵詞。

| 情況 | 結果語義 |
| --- | --- |
| 方法成立、證據足夠、候選／執行綁定核對通過 | verified，仍不是 solved |
| 存在反證、提取錯誤或結果不符 | rejected，具體反饋交回 Coordinator／團隊 |
| 缺材料、缺完整輸出、未知副作用或方法前提不能確認 | inconclusive，不以布林值猜通過 |
| 候選、解法包或實際相關依賴已變 | 舊結果不可提交；保留原始結論與失效原因 |

提交前重新核對指定版本及相關狀態，而不是僅看某次歷史 verified。無關文件變化不使整題失效；不能繼承舊固定五分鐘有效期作所有題目的新需求。舊驗證事實與「現在是否可用」分開保存；同一版本的重複回報不應製造互相覆寫的結果。

尚待驗：拒絕假造 job receipt／錯 session／錯版本；相同候選字串但錯輸入不能通過；真實證據被截斷不能通過；候選修訂與驗證回報競爭；相關變更失效而無關變更不失效。模式各自需要哪些最低證據仍須定稿，尤其 evidence_audit 不能退化成「字串出現在日誌」檢查。

## 7. 接口五：Coordinator 與可信完成判定

### 已定責任

Coordinator 基於當前有效驗證提出對指定候選的提交／判定。宿主讀取已固定 bytes，調用該題實際可用的權威能力；不接受另一份模型自由文字作提交值。Verifier 不獲提交、提示或實例管理權限。平台拒絕要交回團隊；傳輸／業務結果未知不盲目重發。

### 推薦候選與待驗契約

優先接「當前題目確實具有的一種完成判定」，不要求通用平台 API。有 local oracle 就用受控宿主判定；有權威完成接口就按其真實能力接；沒有裁判明示 unavailable，保留 candidate_only。題目來源、公開材料及私有裁判配置分離，沿用 E，不增加偽 target 或把答案混入 challenges 材料。

尚未確定：裁判配置載入位置、模型可見的能力描述、精確提交格式、可信回覆到題目完成狀態的映射，以及答案／憑據如何保持在 G job 不可讀的邊界之外。現有同 uid job 邊界不足，**不能只把 flag 放進另一個 JSON 或環境變數就宣稱已隔離**。無模型探針使用非秘密 fixture；若實際 local oracle 需要新邊界，列出這個具體阻塞及最小可行通道，不自行重啟整套容器部署工程。

候選做法比較：直接復用本地判定函式便於驗 bytes／結果映射，但不證明私有答案保護；使用已有外部可信裁判可維持答案在解題環境外，但需核實通道認證、scope 與業務回覆。依現有環境證據選擇，不先建一套通用 oracle 服務。

宿主在受保護提交送出前記錄意圖；遇 unknown 保留受影響操作，不因重建候選或更改 generation 而重送。同題其他正常觀察不一概封鎖。若判定能力只確認部分完成，不提升為整題 solved；多 flag 通用管理不在本次展開。

## 8. 可復用實作與不可直接繼承處

以下為源碼檢查結論，不代表已在目前 D 路徑驗收。

| 現有位置 | 可復用 | 必須核對／替換 |
| --- | --- | --- |
| `packages/artifacts/src/index.ts` | 內容 hash、原子落盤與 bytes 讀取／校驗思路 | ArtifactReference 帶宿主 path；verify/read 依傳入 path 讀檔，沒有目前 C 題目／會話授權。不可直接暴露為模型引用。publishRange 的 complete 標記不證明來源輸出沒有截斷 |
| `packages/supervisor/src/candidate-verification.ts` 的 SolutionEngineeringService | 固定解法包、候選內容及引用核對 | 目前要求已存在候選，不能代替候選前的 Solver → Engineer 發布；對接 G 來源與版本 |
| 同檔 publishHostExecutionReceipt | 從真實執行產生憑據、核對命令與輸出完整性的原則 | 依賴舊 ToolRuntime／RuntimeOwner，不是目前 G JobManager 的收據；將傳入腳本 ref 寫入 receipt 不等於已證明該版本被實際執行 |
| 同檔 IndependentVerificationService | 版本失效、精確候選核對、提交前再檢查 | 舊 ResponsibilityRegistry／task factory 不能冒充真實 OpenCode 獨立會話；輸出相等或日誌 byte range 相等不是完整語義驗證；舊固定有效期不直接繼承 |
| `packages/supervisor/src/candidate-control.ts` | 受控取消、結果與權威性分離的概念 | 舊 experiment／HypothesisManager／stage 編排不是新 D 的必需依賴 |
| `packages/local-oracle/src/index.ts` | 本地精確判定及權威結果映射的候選基礎 | 私有答案載入、目前入口接線和隔離尚缺；內存去重不證明跨故障安全重試 |
| `packages/platform/src/index.ts`／VerifiedCoordinator | 提交前有效驗證及副作用記錄的原則 | 不恢復舊平台主導編排；依真實 adapter 能力檢查，保留 G 已記錄的 generation 變更可重送等反例 |
| 目前 launcher／plugin／C／G | 真實身份、工具白名單、題目根、資源與 execution 關聯 | 只增加 D 必需的受管入口與權限；未定 schema 不在 plan 或程式中偷偷決策 |

## 9. 要驗證的問題及結果去向

這是待定契約的問題表，不是執行計劃或固定階段順序。接口一的本輪結果與限制見 §3；其他四項尚未運行，既有 G 成果不重算為 D 通過。

| 問題 | 最小有效觀察 | 通過／不通過後的去向 |
| --- | --- | --- |
| 固定產物能否由來源會話安全交付到同題 Engineer？ | 真實 G 文件／job 輸出固定後可讀；修改原 work 不改快照；錯題、越權及競態拒絕；截斷如實標記 | 成立則定發布入口與映射；不成立則修來源／存儲接口，不開放 sibling work |
| Engineer 能否固定精確候選與實際解法版本？ | 含換行／二進位／日誌混合輸出；來源提取吻合；修訂不覆寫舊版 | 選定登記粒度及提取契約；不能核對則保持草稿／不可送驗，不猜標準化 |
| 獨立 Verifier 是否真的操作指定版本？ | 原生獨立會話及 execution；限定證據交接；真實 G job 使用固定輸入；錯版本／偽 receipt 被拒絕 | 定 C/D 綁定與執行證據格式；不足則列明缺少的可信事實，不復活舊假 session |
| 驗證結果能否同時承載判斷與宿主檢查？ | 故意錯誤候選、僅 echo 候選、斷裂證據鏈不因相等而自動通過；相關變更失效，無關變更不失效 | 定每種實際採用模式的證據要求；未覆蓋模式保持未定／不可用 |
| 能否把有效驗證連到真實可信判定？ | 指定候選 bytes 被使用；無有效驗證拒絕；拒絕／unknown／無裁判各自正確；公開輸入不含私有答案 | 定一種當前可用接入；裁判或隔離缺失則明確阻塞 solved，不造權威成功 |

無模型驗證可以證明上述權限、綁定、版本及程序接線；不能證明 Verifier 模型能識別所有錯誤論證。語義能力須在後續有預算授權的真實模型驗收中觀察，不能用預定替身的拒絕回答冒充已證明。

最終需要一個同入口情境串起：E 讀題 → 既定團隊真實工具操作 → Solver 產物固定 → Engineer 讀取並固定解法／候選 → 獨立 Verifier 使用該版本 → 結論交回 → Coordinator 提出判定 → 宿主保存可信結果。還須能把拒絕／證據不足交回團隊修正；不能拼接各個獨立演示宣稱此鏈已通。先驗接口，真實解題另行驗收；不以新設計自動授權任何 run。

## 10. 明確延後與當前待決

不展開全部平台 adapter、跨平台操作描述／自動對帳、完整多 flag 管理、通用 HTTP 重放、全協議工具、跨重啟恢復、部署系統或 G 已延後的隔離／配額工程。若一道題暴露具體依賴，只提回直接需要的部分，不取消核心 v1 的安全與成功標準。

當前接口一按 §3 首題最小邊界已接入主區並完成無模型驗收；H1/H5/H7 的延後項與真實模型邊界不改判通過，產品已接入但未提交。其餘需要定稿的是：候選／解法包的登記粒度、驗證任務與真實執行的綁定、判斷及有效性核對、當前可用裁判的受控接入。已定角色分工、E 讀題、G 工具與原生任務生命週期維持原設計。未知問題先在本文收斂並驗證；證據與決策回寫本文，才生成相應最小實作 plan，不把 plan 當設計權威。
