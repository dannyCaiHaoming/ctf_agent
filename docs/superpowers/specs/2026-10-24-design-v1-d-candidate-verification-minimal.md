# design v1 D 最小版詳細 design：產物交接、候選、獨立驗證與可信完成

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：接口一按首題最小邊界已接入主工作區並完成主區無模型回歸。H1 原完整條件未通過及 H5/H7 限制保留。接口二已按核對版本接入主區並完成無模型回歸；接口三已按首題最小邊界定稿；V3完整條件未通過，已接入主區並完成無模型驗收，見§5；第四、第五接口已按核對來源接入主區並完成無模型驗收（§7.1）；語義與動態條件、實際裁判可部署性和秘密隔離限制仍保留。** 本文是 [核心 design v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 D 的詳細子文件；D 的接口細節與待決問題以本文為準。本文只寫設計，不授權產品修改、驗證 session、真實模型運行或 commit。下文「推薦候選」是本次設計建議，不冒稱已驗證或已批准的外部接口。

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

**最小契約已定；第二接口已接入主區並通過主區無模型驗收。** 草稿沿用原生 task／產物交接；Engineer 整理完成後，由宿主一次固定候選與解法包，返回不可變包版本引用。不採先正式登記候選再補包，避免可送驗半成品及額外草稿狀態。這不改變 Solver 提出解法、Engineer 整理、Verifier 獨立檢查的職責。

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

返回 `{version,manifestSha256,manifestSize,snapshotFixed:true,candidateSize,candidateSha256}`，version 是整包發布 ref。只有 Engineer 可固定包；C 核實角色、同 run 同題與原生 execution。本切片僅為 Engineer 開放 package 工具；C 對 publish/read 均核實 Engineer 角色。下一接口的 Verifier 可見性及任務綁定尚未接入。

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

**第二接口主區接入及必要回歸已完成，沒有本切片未解阻塞。** 不是完整 D 定稿：實際包重放、依賴語義充分性、Verifier 綁定／結果和可信提交仍按後三接口處理；真實模型選材及協作仍未驗。預定替身遵守 unknown 不代表模型能力或宿主強制鎖。

延後項不變：正式草稿持久化、全目錄版本管理、通用依賴推斷、環境封裝、強隔離部署、跨重啟恢復及自動重試。

### 接入實現與主核對（2026-10-24）

9b7d 子區沿用 ae52 已核對原型，完成產品／角色說明及接入驗收；主區產品未合併，不能稱主區第二接口已可用。新增的直接修正是 C 的 `package.read` 也僅允許 Engineer：原型僅在模型可見白名單限制讀取，直接 C 調用曾允許非 Engineer，該失敗保留；修正後 hook 與執行准入均拒絕，沒有放開 Verifier 或接入後三接口。

補齊多頁 manifest/candidate/file 原 bytes 拼接、超 1 MiB envelope／第 33 文件無半包拒絕、NFC 別名／雙向父子路徑衝突，並確認最終角色完整正文、工具說明及精確白名單在真實 runtime 載入。主 session 復跑定向 41/41 與完整四情形批次（提交 1/1/0/1，兩 job／一次包請求），核對原始 bytes、28 項最終來源及每批 23 項 runtime 來源 hash。子區全套 362/362、typecheck/build exit 0 已核對，未用模型替身證明真實模型能力。

接入證據與失敗見 [主核對記錄](../../gates/d-artifact-handoff-20261024/candidate-package/integration/9b7d/parent-review.md)。主區基線產品未變；舊 H1/H5/H7 及本輪缺接口、C 讀取權限失敗原樣保留。未合併 worktree、commit/push 或跑真實模型；不把接入完成寫成整體 D、實際包重放、獨立驗證或 solved 完成。

### 主區接入（2026-10-24）

使用者授權後已將核對版本的13個產品／測試／角色文件接入主區，hash 與 9b7d 最終版本一致；前節為接入前歷史。主區 typecheck/build exit 0、全套362/362；同一新批原生四場景通過，包提交1/1/0/1。原始bytes、版本依賴、實際載入正文及資源終態已核對，見 [主區接入記錄](../../gates/d-artifact-handoff-20261024/candidate-package/integration/main-20261024/README.md)。第一接口依賴與舊失敗保留，未加入延後項或後三接口；無真實模型調用。完成的驗證／實現 plan 已清理，第二接口的驗證與實現子 session 已歸檔；ae52／9b7d 工作樹最初因主工作目錄限制拒絕直接移除，聊天歸檔後應用已自動清理；後續核對代碼與失敗證據均已保存，僅餘空名稱標記亦已清除，其他工作樹不變。此狀態不代表獨立驗證、可信判定或 solved 已完成。

## 5. 接口三：固定材料交給獨立 Verifier

### 已定責任

Coordinator 決定何時驗證，沿用 G 的 assign 與原生 task 分派獨立 Verifier 會話。Verifier 接收固定候選／解法包、必要題面與證據，以及明示的前提和未知項，不接收 Solver 完整推理上下文。不得以另一個自造 session ID 冒充獨立。

### 首題材料交接決策與邊界（2026-10-24 主核對）

**狀態：首題最小接口定稿，接入範圍是固定材料交接與宿主執行關聯；V3 完整固定輸入執行證明未成立。** 接口一、二保持已接入，接口四、五未實作。保留以下最小做法，不以部分成立寫成完整 D 通過。

- Coordinator 使用既有 `challenge.assign(role,challenge,version?)`，Verifier 必須指定實際包 version。宿主先核對同 run／同題整包，再提交聲明；原生背景 task callID 消費聲明至 execution，C 核實真實 child，首次模型准入前綁定版本。同 session 新 execution 明確重綁，不默認沿用舊版。不以 prompt、模型自填身份或新 registry 授權。
- Verifier 只用 `package.read` 讀本次綁定包；Engineer 原權限不變。保留同題材料與 artifact 讀取，不開發布、普通 HTTP 或提交。交接題面、包、必要證據、前提和未知項，不帶 Solver 完整推理。
- `package.prepare({})` 由宿主在自己的 work 建唯一 `verify-<uuid>/`：inputs 保留 manifest 路徑，candidate/manifest 放父目錄。經 staging、rename、存活和 hash 校驗後登記 ready；失敗／停止清除半準備，不覆寫其他 work。argv 仍是 proposed，準備不自動執行。**此能力限可信穩定 work 根、無不受管並發寫入；不是 OS 隔離。**
- Verifier `job.run` 使用本次 session/execution/version 對應 preparation，cwd 指向 inputs；宿主記錄實際 argv、列明文件與 metadata hash、job、原輸出和終態。自寫檢查腳本與包內原腳本區分來源。端點 hash 不能證明讀取時點，所有 job 的 continuousIntegrity／undeclaredDependencies 保持 unknown；不接受模型 receipt 作證據。

| 契約 | 主 session 核對結論 |
| --- | --- |
| V1 任務版本 | 最小契約成立。原生 assign→execution→bind→首次准入可核對；錯題／角色／外來task、缺版本、遲到child與舊preparation拒絕。重綁競態由定向測試覆蓋，不冒稱全部原生情境 |
| V2 材料準備 | 上述條件下成立。同次E→Solver發布→Engineer整理固定→Verifier準備，20-byte產物及9-byte二進位候選原bytes一致；多頁、損壞及路徑替換為contract證據。半準備停止無ready或殘目錄 |
| V3 執行關聯 | 部分成立。假receipt、準備後改寫／symlink／metadata替換、舊execution等待校驗時重綁可拒絕；永久修改記changed_or_unreadable。真實腳本中途改寫再恢復、讀未聲明文件，前後matched但輸出CHANGEDUNDECLARED；完整固定輸入執行證明仍未成立 |
| V4 停止與傳輸 | 已測最小契約成立。準備中停止、job讀到20 bytes且running後自然停止、ready後回复丟失／遲到、預算拒絕均經真實plugin/C。停止由原生sibling完成通知喚醒Coordinator，未SDK resume child；資源settled，預算案為預期budget_exceeded |

### 首題阻塞與 unknown 的責任邊界

第三接口直接阻塞：身份／版本不符、來源或準備內容損壞、未ready的半準備、舊execution句柄、已停止或預算拒絕後的新操作。這些必須拒絕或停止受影響交接，不交給Verifier猜測；已有對應原型及主核對證據。

continuousIntegrity與undeclaredDependencies保持unknown不阻塞固定材料交接，但也不構成驗證通過許可。接口四應按實際驗證方法判斷unknown是否影響結論：若判斷依賴「執行中未改寫」或「沒有未聲明依賴」，且無充分獨立證據，結果只能inconclusive；不能靠候選相等、exit0或前後hash相同補足。若有直接反證則rejected。若某種方法能由其他充分證據支持結論，須在接口四定稿相應最低證據，而非此處默認放行。

已觀察到changed_or_unreadable是具體變更事實，不能降為一般unknown後忽略。必要依賴改變須重新整理／準備及驗證；任務停止或傳輸unknown則沿用暫停受影響交接、不盲目重發。正常新建輸出不自動等於輸入被破壞，依manifest必要依賴區分。

推薦先接入已核對版本，將上述限制作正式契約保留；代價是第三接口只能讓獨立Verifier取得材料並操作，尚不能讓首題取得有效verified或solved。第四接口最低證據與第五接口可信判定仍是跑通完整成功流程的直接依賴。強隔離、任意腳本全部依賴捕獲、HTTP通用重放及恢復系統不因此加回。

### 證據、限制與剩餘問題

來源為 abe7d6e 上未提交原型，Node26.3.0、OpenCode1.19.3、SDK/plugin1.19.0；27個最終來源及副本hash保存。主session核對源碼差異、原bytes、角色工具真實載入與作者六案，另復跑46/46定向及同源六案 `parent-runtime`，全部命令exit0；子區125/125定向、372/372全套與typecheck/build記錄保留。詳見[主核對](../../gates/d-artifact-handoff-20261024/verifier-handoff/parent-review/README.md)及[原證據](../../gates/d-artifact-handoff-20261024/verifier-handoff/README.md)。缺接口RED、類型錯誤、metadata與execution競態失敗、舊fixture契約失敗及早批job-stop不足證據均保留。

回复丟失可出現C已ready而plugin報control unavailable；遲到案為socket取消、回复未送達，不能說收到後拒絕。unknown不盲目重發是替身預定決策，不證明模型遵從或新增調用強制鎖。正常輸出相同只證明接線；沒有真實模型調用，usage unavailable，沒有語義驗證、verified或solved。

首題可復用版本交接、準備與可信執行關聯；**不得把此關聯當完整固定輸入執行證明**。接口四仍須決定各驗證模式的最低充分證據及如何處理這個unknown；缺充分證據維持inconclusive，不自動放行。需要任意並發／未聲明依賴的確定性時才提出具體缺口，不擴展強隔離或通用依賴捕獲。先支持固定材料讀取和本地recompute，evidence_audit不能掩蓋不可重放缺口；普通HTTP/replay、恢復系統仍延後。

本輪已保存結論、原型源與失敗證據，主／子驗證plan已刪除；專屬session已歸檔，388a工作樹及登記已移除。清理前後主區及其他工作樹指紋／狀態核對一致；自動跟進已刪除。該次清理時未接入主區；其後使用者授權的接入結果如下。

### 主區接入驗收（2026-10-24）

已按使用者授權接入13個核對來源文件，hash與原型一致。主區typecheck/build通過、全套372/372；同源六個原生場景harness exit0，原bytes、角色工具載入及資源收束已核對。見[主區接入記錄](../../gates/d-artifact-handoff-20261024/verifier-handoff/integration-main/README.md)。V3反例及unknown保留，不增加後兩接口或延後項；沒有真實模型運行。第三接口可用不代表已有有效驗證結果或solved。

## 6. 接口四：驗證結論與有效性

### 已定責任

Verifier 負責方法、前提、反例及證據支持程度的判斷；宿主負責可機械核實的身份、版本、執行記錄和證據關聯。兩者均必要：模型自述不能直接改可信狀態，hash 相同或工具 exit 0 也不能代替獨立判斷。

### 首題機械契約（已按核對版本接入；限制見下文）

只新增受管驗證報告登記與指定結果讀取，復用前三接口的固定包、真實身份與execution、preparation、job與原輸出。報告由獨立Verifier提出，宿主核實機械事實並保存；結果引用經原生task交回Coordinator。不能解析自由文字「通過」直接改狀態，不恢復舊ResponsibilityRegistry／自造session／固定五分鐘有效期，也不新增求解或消息循環。

推薦報告輸入為判斷、模式、理由、必要前提、具體證據選擇與未解問題。宿主從當前execution取得run／題目／version／Verifier身份，從既有記錄解析job、實際命令、原始輸出、完整性及精確區間；模型不手填可信receipt、hash或身份。由報告入口固定必要job輸出即可，不開放Verifier通用artifact.publish。具體schema、引用形式和登記原子點待原型核實後定稿，不以自由文字當授權。

### 三種結論的最低證據

| 結論 | 最低要求 |
| --- | --- |
| verified | 真實獨立Verifier對指定版本明確判斷通過，說明方法為何符合題意、必要前提、檢查過的來源／資料流及具體證據；宿主核實身份、版本、引用、執行來源及結論依賴的完整性；無影響該結論的未解缺口。不是solved或形式化證明 |
| rejected | 與該版本相關且有可信證據的具體反證，例如有效檢查條件下重算不符、提取錯誤或違反題意。工具失敗、缺資料本身不證明候選錯誤 |
| inconclusive | 材料／關鍵輸出缺失或截斷、方法前提不明、取消、未知副作用或未解相關依賴，導致既不能支持通過，也不能支持否定；不猜布林結論 |

非法身份、偽造receipt、錯版本／execution等是**登記拒絕**，不能冒充候選rejected。合法報告提出verified但機械證據不足時不能登記可用verified；應保留原提議與宿主不成立原因，輸出inconclusive或明確拒絕，具體一致策略在本輪定稿。

保存三個可區分層次：Verifier原判斷、宿主可核實檢查、目前結果是否可用。宿主不能自行從bytes相等升格為verified；有明確反證不能被「檢查字段都齊全」蓋過。

### 模式與unknown處理

- recompute：固定輸入、可檢查計算／提取方法、真實Verifier job及所需完整輸出、精確候選比較；Verifier說明方法如何回答題目。只echo候選或複製候選文件不是重算。
- evidence_audit：具來源的必要操作／觀察、順序與前提、候選提取位置，以及不能安全重放的理由；字串出現在日誌不是充分證據。不要求無關全部日誌完整，但必要上下文缺失不能以局部區間完整取代。
- replay：本輪不新增普通HTTP／通用重放；未有可信實際能力的模式不可用，不能改名為audit就自動通過。

V3的continuousIntegrity／undeclaredDependencies繼續保留unknown，不要求先完成任意程式的強隔離證明，也不一律阻塞所有驗證。推薦允許在明確的受信任本地執行前提下，Verifier檢查固定輸入、實際腳本／命令與提取資料流，依足夠證據提出條件性判斷；該前提必須顯式保存，不可把「已檢查」文字當清除unknown的通用開關或宿主證明。此接受邊界的機械契約已按下述原型核對；無模型只能檢查報告與事實的契約，不能證明模型審查能力。

若結論依賴「中途未改寫」或「無未聲明依賴」且缺足夠證據，則inconclusive；前後hash相同、exit0、候選相同不補足該缺口。已觀察到changed_or_unreadable是具體事實，不可降為一般unknown後忽略。改寫是否屬合理已說明計算步驟須檢查；破壞驗證前提則本次執行不支持verified，但不直接推出候選錯誤。

### 有效性與交付

結果綁定精確包版本與本次Verifier execution，相關必要依賴／實例狀態的條件顯式保存。候選或相關依賴變更使舊結果不能用於新對象；無關work文件變更不使結果失效。不自造全題latest指針，不因新版本存在就篡改舊驗證事實；後續請求必須指定版本與結果，重新核對適用性。

同一execution的重複報告不製造互相覆寫結論；衝突必須明示。保存先於回复與下游接收分開，停止／預算拒絕後不新登記；保存後回复丟失仍保留事實，調用方unknown不盲目重發。結果讀回供Coordinator使用；不接第五接口提交、oracle或solved，不加恢復系統。

### 原型核對結論與已選機械契約（2026-10-24）

**原型調查已完成；其後主區接入見§7.1。Q2語義充分性與Q3外部／持續完整性仍未證明。** 基線639782b，Node26.3.0、OpenCode1.19.3、SDK/plugin1.19.0。原型採 `verification.report` 僅Verifier、`verification.read` 僅Coordinator，結果與本次真實execution綁定；不是可信提交入口。

報告保存original判斷、宿主blockers與effectiveJudgment。非法身份／版本／job拒絕登記；合法報告缺必要機械證據則effectiveJudgment=inconclusive並保留原提議。相同execution相同內容返回同一結果，衝突拒絕，不覆寫。recompute需本次版本綁定的真實job與精確比較；replay未開放。premises明確區分assumed／unknown，requirements表示判斷是否依賴持續完整性或無未聲明依賴；這些選擇的正確性仍屬Verifier語義判斷，不能偽裝成宿主已證明。

`verification.read({challenge,version,result,cursor?})` 返回有界摘要及固定報告JSON的32768-byte base64頁，含size/hash/offset/nextCursor/done。完整前提、原判斷、證據bytes與來源皆在固定報告；讀到末頁並核對總長/hash才算完整收到。每頁重新核對currentAvailability，固定報告不隨後續失效改寫，摘要不可替代讀完整必要內容。

失效核對固定包及必要證據；獨立非必要artifact或不同preparation變動只記warning，必要／共享preparation或包依賴損壞仍阻斷。necessary選擇不可後改，但其語義正確性不是宿主證明。usable只表示報告在目前機械核對下可用（亦可能是rejected報告），不是提交許可；消費者必須讀effectiveJudgment、條件與不足項，不得只看usable。

| 契約 | 主核對結論 |
| --- | --- |
| Q1 綁定／交付 | 所測最小機械契約成立。原生E→Solver→Engineer→獨立Verifier報告→Coordinator指定結果讀回；錯身份/版本/job/execution拒絕。大報告主復跑1403719 bytes、43頁、最大44294 bytes，逐byte/hash吻合 |
| Q2 判斷／證據 | 部分成立。固定錯候選INCORRECT與正確獨立重算構成有效反證fixture；缺必要證據降inconclusive。但刻意虛假的完整echo論證仍能讓機械核對通過且usable，不能宣稱已排除語義假陽性。原早批錯檢查器不是有效反證，證據保留但不作通過依據 |
| Q3 有效性 | 本地機械部分成立。必要截斷/未知前提/已知改寫阻擋，相關變更失效、獨立非必要變更warning，版本競爭不串用。V3中途改寫恢復及未聲明依賴仍unknown；外部狀態/任意並發未證明 |
| Q4 停止／傳輸 | 已測邊界成立。停止先勝0報告，保存先勝保留；真RPC丟回复/遲到、預算拒絕；原生sibling通知接續父再停止，無SDK resume child。遲到reply未送達，不冒稱收到後拒絕；不盲目重發為替身決策，非模型能力 |

主session先發現並要求修正兩處直接缺口：大報告超262144-byte原生工具上限、獨立非必要證據損壞誤判主結論失效；原RED與修正證據均保留。主session復跑42/42定向及同源八個原生場景，exit0（budget內層budget_exceeded是預期）；核對來源hash、原bytes與實際角色工具載入。子區112定向、390全套與typecheck/build日誌已核對。證據見[主核對](../../gates/d-artifact-handoff-20261024/verification-result/parent-review/README.md)及[修正邊界](../../gates/d-artifact-handoff-20261024/verification-result/review-fixes-20261024/README.md)。無真模型，usage unavailable。

**剩餘決策：** 原型證明報告與機械核對接線，不證明Verifier能識破完整但虛假的論證。接入時是否接受「獨立Verifier在明示假設下的語義判斷＋宿主機械核對」為工程verified，須保留這個信任邊界，不能稱自動防偽已通過；若要求宿主證明任意論證正確，本原型不能滿足。第五接口仍不得僅憑usable放行。沒有增加通用語義判斷器、強隔離、恢復或第五接口。

本輪已保存結論、失敗及原型源；主子完成plan已刪，專屬session已歸檔，3e07工作樹及登記已移除，其他工作樹未變。調查收口不等於主區已接入、完整D或solved。

## 7. 接口五：Coordinator 與可信完成判定

### 已定責任

Coordinator 基於當前有效驗證提出對指定候選的提交／判定。宿主讀取已固定 bytes，調用該題實際可用的權威能力；不接受另一份模型自由文字作提交值。Verifier 不獲提交、提示或實例管理權限。平台拒絕要交回團隊；傳輸／業務結果未知不盲目重發。

### 推薦候選與待驗契約

優先接「當前題目確實具有的一種完成判定」，不要求通用平台 API。有 local oracle 就用受控宿主判定；有權威完成接口就按其真實能力接；沒有裁判明示 unavailable，保留 candidate_only。題目來源、公開材料及私有裁判配置分離，沿用 E，不增加偽 target 或把答案混入 challenges 材料。

尚未確定：裁判配置載入位置、模型可見的能力描述、精確提交格式、可信回覆到題目完成狀態的映射，以及答案／憑據如何保持在 G job 不可讀的邊界之外。現有同 uid job 邊界不足，**不能只把 flag 放進另一個 JSON 或環境變數就宣稱已隔離**。無模型探針使用非秘密 fixture；若實際 local oracle 需要新邊界，列出這個具體阻塞及最小可行通道，不自行重啟整套容器部署工程。

候選做法比較：直接復用本地判定函式便於驗 bytes／結果映射，但不證明私有答案保護；使用已有外部可信裁判可維持答案在解題環境外，但需核實通道認證、scope 與業務回覆。依現有環境證據選擇，不先建一套通用 oracle 服務。

宿主在受保護提交送出前記錄意圖；遇 unknown 保留受影響操作，不因重建候選或更改 generation 而重送。同題其他正常觀察不一概封鎖。若判定能力只確認部分完成，不提升為整題 solved；多 flag 通用管理不在本次展開。

### 原型驗證採用的最小契約（機械接線已核對，真裁判部署未定）

原型驗證時在隔離子區復用§6已核對的最終原型，當時主區第四接口未接入；其後接入見§7.1。驗證採用「獨立Verifier的明示條件判斷＋宿主機械核對」的工程邊界；不要求宿主證明任意論證。完整虛假echo可能誤得verified的反例必須保留；第五接口的權威裁判應能拒絕這類錯候選，不能以usable或verified本身宣告solved。

已核對入口採 Coordinator 專有 `completion.request({challenge,version,result})`，不接受candidate自由文字、generation或模型提供的權威標記。宿主重查指定結果為effectiveJudgment=verified且目前適用，解析固定版本的精確候選bytes；rejected、inconclusive、缺失／失效／錯題結果不得發送。已聲明條件隨結果保留，無法機械證明的前提不改記為已證明。只有受信配置選定的裁判回覆可作完成事實。

候選判定配置由宿主在啟動時注入，Agent僅見能力是否可用及公開格式限制，不提供任意endpoint。無模型先使用非秘密本地裁判fixture，分開證明接口接線與真實裁判可部署性。若既有環境沒有可核對的實際裁判通道，明確留下接入阻塞，不把fixture認作首題權威裁判。舊LocalFlagOracle只收string；候選若使用它，必須驗證UTF-8嚴格且往返不改bytes，不能trim、正規化或替換非法編碼；無法無損表示的候選明確拒絕，而非偷偷變值。

提交前固定意圖及候選hash／版本／結果／裁判身份；同run同題存在未決已發送操作時，禁止以新版本、新result或重建候選繞過unknown再送，正常觀察仍可繼續。並發相同請求最多一次副作用。拒絕有明確結果可交回團隊修正；duplicate不單獨證明成功。accepted僅在可信回覆明確完成整題且與本次意圖關聯時記完成，部分完成保持未完成；無裁判保留candidate_only。對外狀態應分開業務結果、操作是否發送及回覆是否送達。

停止前未發送則零副作用；已發送後停止／超時不能假定回滾，保留可信已得結果或unknown，不盲目重發。回覆先落盤再返回；真實RPC丟回复與裁判通道丟回复分別驗證。只做本run內去重與未知保留，不展開跨重啟恢復、自動對帳、多flag、通用平台或強隔離工程。

### D5 隔離原型的已核對實作選擇（2026-10-24）

採 `completion-tools.ts` 的本run登記，宿主啟動時以不可由Agent指定的 `completionJudges` 注入題目→裁判物件；不從題面、環境或模型參數讀endpoint/答案。裁判介面收bytes、宿主intent及challenge，回覆必須與intent/challenge一致；能力只作本地非秘密探針，尚無真實部署通道。意圖及結果寫在run的state/completion中，寫入失敗不發送；送出後未確認一律unknown且鎖住同題，確定拒絕允許修訂候選。相同已確認請求可讀原記錄，不重送。只實作本run排他與保存，不承諾fsync／進程崩潰恢復。公開入口只回不含裁判配置的摘要。


### D5 原型與主session獨立核對結論（2026-10-24）

**本段記錄隔離原型與非秘密裁判探針的程序驗證；其後主區接入見§7.1，仍不能稱首題已可可信判定或 solved。** 基線 HEAD `2d9fc4e1439449ea30bad4471994a247805c34e0`，D4 必須使用 `verification-result/review-fixes-20261024/final-source/`，31項來源hash全部核對、28項產品／測試／角色／包文件恢復；當時主區未提交D design與plan另行完整帶入。D4基礎與本輪D5差異接入時分別保存；證據精簡後以verified-source.patch統一還原已驗來源，D4來源恢復與D5差異的hash仍在manifest中，沒有將D4語義缺口改判通過。Node26.3.0、OpenCode1.19.3、SDK/plugin1.19.0。

子區採用 Coordinator 專有 `completion.request({challenge,version,result})`，宿主使用同run/同題/同version的指定結果，要求目前usable且effectiveJudgment=verified；拒絕模型candidate／authority／endpoint等自由欄位。宿主完整讀固定candidate的base64頁，並在意圖及保守發送準備記錄落盤後、同步呼叫裁判前重新核對有效性及候選bytes相等，不能在await落盤窗口串用失效結果。必要prepared輸入於意圖落盤期間變更的原始RED曾錯送；補最終核對後GREEN零派送。仍承接可信穩定根與無不受管並發寫入條件，不宣稱抵抗任意同uid惡意寫入。

| 判據 | 子區實錄與結論 |
| --- | --- |
| 有效結果與精確bytes | D5定向13項：角色/錯題/錯版本/缺結果/自由candidate與authority拒絕；usable=true rejected及inconclusive不派送；必要來源改變拒絕。裁判byte介面接收固定原bytes，包含NUL/非法UTF-8；獨立string adapter嚴格UTF-8往返，保留換行、BOM及NFC/NFD差異，非法UTF-8拒絕而非替換。沒有把舊string oracle直接當byte裁判使用。 |
| 判定與結果映射 | 只有宿主啟動時注入的題目裁判可回覆，必須關聯intent與challenge；明確accepted且completed=true才在原型中記solved。rejected/duplicate/部分完成均不提升，無裁判candidate_only，無效/錯關聯/偽造authority回覆保留rawReply並unknown。這是非秘密探針的映射事實，非真實題目solved。 |
| 語義反例與拒絕回傳 | 同批rejected案：Engineer固定錯候選INCORRECT，Verifier實際job只echo並提供完整虛假論證，宿主仍機械verified；裁判實收錯bytes後拒絕。Coordinator再經原生challenge.assign/task派給另一個既定Engineer會話，帶實際拒絕intent，Engineer實際收到並原生回應。只證明拒絕可送回，不證明模型識破echo或團隊已修正候選。 |
| 意圖、並發與unknown | 意圖先落盤、同題在途排他，並發最多一次送出；確認過的同一請求返回原記錄。裁判已收件後真socket斷連為unknown，host鎖同run同題，不可換version/result繞過，指定驗證讀取等無關觀察仍可繼續。C保存後真RPC斷連則host保留confirmed，調用方工具為control unavailable且未確認；不重試是scripted決策，不證明模型遵守。 |
| 自然停止競爭 | Coordinator前台completion在途，由launcher整體deadline自然停止，沒有測試側SDK resume或task.stop。stop案裁判實收1、回覆未得，host unknown，工具原生aborted；late案host先保存confirmed，延遲真RPC後自然停止、socket已destroyed、原生aborted，先存事實保留；before-stop案意圖落盤後barrier，自然stop_marked先勝再放行，host not_sent、裁判實收0。not_sent可先於native abort送達為completed工具；若連接先被abort則調用方未知，不能要求這兩種時序有同一工具狀態。 |
| 故障、超時與預算 | 發送前保存失敗零裁判副作用；裁判accepted後最終落盤失敗不返回solved，內存unknown/solved=false、磁盤保留sent且sent=false的保守發送準備記錄，後續換version/result仍禁止重送。sent狀態不等於裁判實收；以submit呼叫事實及探針收件分開核對。定向裁判timeout為unknown；同批budget案在completion前由既有預算拒絕，裁判零收件。進程崩潰/fsync/跨重啟恢復未驗。 |

最終同源公開runtime批次為 `trusted-completion/batch-final/`：每案均從E讀題、Solver真job/發布、Engineer固定包、獨立Verifier真prepared job及報告、Coordinator完整讀指定結果，再走completion；未預置published/報告，未跨run拼成功。十案為control、rejected、noj、missing、judge-lost、rpc-lost、stop、late、before-stop、budget；內層deadline_exceeded/budget_exceeded為預期觀察，不是解題成功。最終typecheck/build exit0、全套403/403；真實產品模型調用0，模型usage unavailable，scripted零usage另記，不冒充實測模型成本。其後證據精簡保留本批原始終態與來源manifest於 `batch-final/results.jsonl`，完整最小鏈路證據保留於後續主區同批 `integration-main-native/*/records.jsonl`；兩批身份分開，不互補為同一次通過。

失敗的原始日誌與各批終態保留，完整重複轉儲已精簡：最初入口不存在RED；意圖落盤期間來源變更RED；舊權限白名單401/402；新增保存後故障測試誤把同步拒絕寫成Promise拒絕；batch-01使用錯revoke觀察全局停止及執行中改角色正文；batch-02要求before-stop一定native aborted而實際收到明確not_sent。batch-03舊範圍十案全通，但不包含實際拒絕回傳，不拿來拼接最終批。這些是具體探針／預期失配與已修機械缺口，不籠統稱產品全失敗或以exit0掩蓋。

**尚未驗證／接入阻塞：** 現有E題目配置不含真實權威裁判通道；LocalFlagOracle僅string介面、內存去重，未接目前啟動入口，亦不提供私有答案隔離；舊PlatformService／VerifiedCoordinator責任／generation機制未復活。本輪typed host注入及loopback probe只驗接線，尚無可核對的真實裁判認證、scope、業務回覆或秘密保護部署。G同uid job直連及讀宿主位置的限制不變，不能把真答案放另一JSON/環境就稱隔離。Verifier語義、外部狀態/持續完整性、真實模型協作/拒絕後修正能力未驗。跨重啟、自動對帳、多flag及部署工程仍延後。

主session另實際復跑31/31定向contract與 `parent-review-native/` 同批十案，命令exit0；核對30項同批來源hash與當時來源一致，裁判實收原bytes的長度/hash及completion記錄一致，見 `parent-review/commands.json`。內層deadline/budget exit1是預期。該次主session只將核對結論與證據同步主區；其後授權產品接入見§7.1。

最小證據、來源manifest、可還原已驗來源的 `verified-source.patch` 與失敗日誌見 [D5證據入口](../../gates/d-artifact-handoff-20261024/trusted-completion/README.md)。重複D4/D5差異、來源副本與臨時計畫快照已移除，不再宣稱完整歷史轉儲仍保留。本節可支持下一次按具體題目接入一種真實裁判的決策，不能自行授權主區接入、模型運行、合併或提交。結論與失敗已轉入本文及證據目錄，一次性plan已刪除；專屬工作樹暫留供查閱，不自動合併或歸檔。

## 7.1 第四、第五接口主區接入與無模型驗收（2026-10-24）

使用者明確授權將兩接口接入主工作區，保留限制，暫不commit/push。逐hash核對31個非文檔源，僅接入13個差異文件，接入時實作及探針與已核對來源一致（精簡後可由verified-source.patch還原）；另更新product/AGENTS.md過時能力說明，既有未提交設計與.handoff保留。沒有恢復舊編排或增加真實裁判部署。

主區定向43/43、全套403/403、typecheck/build exit0。同一主區來源完整十案原生runtime均符合判據，harness exit0；30項來源hash一致，實收候選bytes及完成記錄核對一致。覆蓋E→Solver發布→Engineer固定包→獨立Verifier報告→Coordinator讀回→宿主判定，拒絕實際送回Engineer、無裁判、不可用結果、兩類真socket丟回复、自然停止競爭及預算拒絕。deadline/budget內層exit1是預期停止，不是解題成功。證據見[主區接入驗收](../../gates/d-artifact-handoff-20261024/trusted-completion/integration-main/README.md)。

獨立審查未發現接入阻塞。來源角色文案中的conditionalOn舊名稱尚未同步，實際條件位於固定報告original.premises/requirements；保留為非阻塞文案限制。Q2虛假完整echo、Q3/V3動態完整性unknown、真實裁判認證/scope/秘密隔離與模型協作能力均未因此通過；無可信裁判仍candidate_only，verified不等於solved。沒有真實產品模型調用，usage unavailable；跨重啟與任意惡意並發未驗。結論已轉入design及既有證據位置，接入plan刪除，未commit/push。

依使用者要求精簡D5證據：主區十案按原批保留可無損還原的原生訊息、job／固定包／驗證／提交記錄、原bytes、RPC與觀察；audit僅保留相關事件及原索引，重複Provider請求、事件流、workspace與來源副本移除。歷史批次僅保留各自終態、日誌與來源hash，不再提供完整原始轉儲；抽取範圍與核對方式見證據README及retention.json。既有驗收結論不因此擴大。探針後續原始輸出改寫至Git已忽略的 `runs/d-trusted-completion/<label>/`；這項輸出位置修改在既有同批驗收之後，舊來源hash不重寫，也不冒稱已再次跑原生十案。精簡時未commit/push；其後使用者已授權將程式、探針與精簡證據依類型分批提交並推送。

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

這是待定契約的問題表，不是執行計劃或固定階段順序。接口一、二已接入主區並完成無模型回歸，依據與限制見 §3–4；接口三已接入主區，V3完整條件未成立，結論見 §5；接口四、五均已完成原型核對及主區接入驗收，結論見§6–7.1；實際裁判部署仍待驗。下表前兩項保留為已驗問題索引，不重新列為未定；既有 G 成果不重算為 D 通過。

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

當前接口一按 §3 首題最小邊界已接入主區並完成無模型驗收；H1/H5/H7 的延後項與真實模型邊界不改判通過，接口一、二已接入並隨 abe7d6e 提交，候選／解法包粒度已定。接口三已按最小邊界接入主區，V3完整輸入執行證明仍未成立，按§5保留限制。接口四、五已按§7.1接入主區並完成無模型驗收；機械契約與語義信任邊界見§6–7，當前仍缺實際裁判通道與可部署秘密邊界。已定角色分工、E 讀題、G 工具與原生任務生命週期維持原設計。未知問題先在本文收斂並驗證；證據與決策回寫本文，才生成相應最小實作 plan，不把 plan 當設計權威。
