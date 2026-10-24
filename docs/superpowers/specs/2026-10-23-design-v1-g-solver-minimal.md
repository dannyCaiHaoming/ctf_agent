# design v1 G 最小版詳細 design：解題角色的工作區、HTTP／作業與題目綁定

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 G 的詳細 design 子文件。本文定義解題角色的題目綁定、工作區、HTTP 與腳本執行能力；細節以本文為準。**部分設計已確認，整體尚未定稿**：長作業／Coordinator 停止的統一行為契約已選定，原生背景分派／自動交付／停止的公開接線已在隔離原型完成聯合無模型驗證（§9），已按授權接入主工作區（§9.2）；隔離部署、網路 scope、資源總量及 D/E 接口仍有未定項（第 10 節）。已選做法寫在正文；驗證條件集中於第 9 節。當前接入範圍與延後項以第 10 節為準；整體尚未定稿不代表已確認的部分仍需等待全部問題解決。

本文只定義設計，不構成執行或真實模型調用授權。G §10.1 已定接線已在 c323 獨立工作區實作，2026-10-24 經主 session 獨立核對及無模型複跑（§9.1）；其後按使用者授權整合到主工作區（§9.2）。

**前提：** [E 最小版詳細 design](2026-10-23-design-v1-e-intake-minimal.md)（下稱 E design）已定題目材料的固定與 Intake 的唯讀接入（`workspace/<id>/materials/`）；[C 詳細 design](2026-10-23-design-v1-c-control-service.md)（下稱 C design）已定控制服務、會話綁定、分派登記與逐次准入。本文沿用這些機制，只補解題角色需要的能力與題目範圍。

**用詞：** 「宿主」指啟動器與其進程內的控制服務（design v1 1.2）；「解題會話」指經分派綁定到某題的 `recon`、`domain-solver`、`engineer`、`verifier` 會話（下稱解題角色）；「作業」指經受管工具啟動的一次本地程序執行。

---

## 1. 範圍

本文服務核心 design v1 的既定多 Agent 系統：Coordinator、Intake/Triage、Target Recon、Reference、Strategy、Domain Solver、Solution Engineer、Verifier、Recovery Critic。簡單職責可自適應合併，但職責不消失；Verifier 保持獨立，Recovery Critic 按持續停滯條件觸發。本文的「解題角色」只是題目綁定與工具權限的分類，不是把整個團隊縮成單一 Solver，也不另建編排器或角色。

**做：**

- 題目綁定：Coordinator 分派解題角色前先宣告題目，宿主在綁定時把會話與題目固定（第 2 節）；
- 工作區：列出、讀取、寫入、搜尋本題的材料、本會話工作目錄與已發布產物（第 3 節）；
- HTTP：經控制服務發出的受控請求，限授權目標（第 4 節）；
- 作業：在受控環境執行腳本，同次工具等待終態、保存可續讀輸出，並接受宿主／Coordinator 停止（第 5 節）。

**不做：**

| 延後項 | 待何時 | 首版替代 |
| --- | --- | --- |
| PTY、TCP 連線與 stdin 互動 | 出現需要持續互動的題目時（design v1 G 的 PTY/TCP 列） | 作業 stdin 固定為空；需互動的題目不在本切片 |
| 瀏覽器 | 瀏覽器接口與 ARM64 依賴定稿後 | 無 |
| 產物發布、候選登記、驗證結果登記 | D 負責設計與實作；團隊交接的直接依賴見 §10.1 | `published/` 只由宿主寫入；預留目錄不是已完成交接，也不代表 Engineer／Verifier 可從做題流程省略 |
| 網路隔離（覆蓋腳本與直接 TCP） | design v1 第 3 節待決項 | 第 5.5 節明確限制，不宣稱 scope 已強制 |
| 解包歸檔的受管工具 | 出現大量歸檔題目時 | 由作業在本會話工作目錄中以標準庫解包（第 3.5 節） |
| 結構化 scope（host、port、路徑前綴） | 網路隔離定稿時 | 授權範圍即 `target` 的 origin（第 4.2 節） |
| 觀察句柄（`observation.*`）與假設工具（`hypothesis.*`） | 不再使用 | 從插件清單移除（第 7.4 節） |

---

## 2. 解題會話與題目的綁定

**採用「先宣告題目，再用原生 task 分派」。** Coordinator 決定哪個角色做哪題，`challenge.assign` 成功後再分派；宿主只核實並固定題目，不替 Agent 選題。

這在 C 既有的「同父、同角色一筆待綁定分派」上增加題目欄位，不改原生 task 參數，也不增加分派循環。**不從 task 的自由文字解析題目**：文字中的題號不能區分描述與授權。宣告在工具實際執行時生效，不能為遷就同輪 hook 順序改為預檢時生效。

### 2.1 宣告：`challenge.assign`

| 項目 | 規則 |
| --- | --- |
| 授予 | 僅 `coordinator`（對應 C design 第 5 節的分派權） |
| 參數 | `challenge`（題目 `id`）、`role`（`recon`、`domain-solver`、`engineer`、`verifier` 之一） |
| 核實 | 題目屬本 run；角色屬上述四個；同父會話對同角色已有未消費的宣告或待綁定分派時拒絕（與 C design 第 3 節第 1 點同一規則） |
| 生效點 | `tool.execute.before` 只預檢；`tool.execute` 在短暫串行區內再次核實有效性、題目與角色，寫入宣告後才返回成功。不依賴同輪兩工具的 hook 順序 |
| 結果 | 回傳宿主確認的題目 id |
| 釋放 | 未消費宣告跨模型輪保留；成功登記新分派時原子消費。顯式 unassign 或父會話停止、撤銷或到期時清除；不得在下一次模型准入時清除 |

`intake`、`reference`、`strategy`、`recovery-critic` 不接受宣告：前三者不需要題目工作區，`recovery-critic` 依 design v1 H 只讀全局狀態。`intake` 仍以整個 run 為範圍（E design 第 4 節）。

**宣告、失敗與恢復：**

- 一個父會話／角色只有一筆宣告；重複宣告（含同題）拒絕且原記錄不變。需要放棄或換題時，Coordinator 調用 `challenge.unassign(role)` 清除未消費宣告，無宣告時冪等成功；已有待綁定分派時拒絕，不能撤回在途 task。插件 id 為 `ctf_challenge_unassign`，只接受上述四個解題角色，返回 `{cleared: boolean}`。
- 正常順序是 `assign` 成功返回 → 下一輪 `task`。同輪 task 若先於宣告完成，明確拒絕且不建立分派；宣告稍後成功仍保留，下一輪可重試 task。已完成的宣告可以被同輪 task 消費，但不要求此順序成立。
- task 登記前拒絕不消費宣告；登記成功後宣告已消費。待綁定分派由可信首次綁定消費，或在確認分派失敗、取消、父會話撤銷／停止或到期後釋放；父會話下一次准入不能清理仍在啟動的異步分派。結果未知時保留 pending 並拒絕同父同角色新分派，不猜測遲到 child 的歸屬。不自動恢復已消費宣告，釋放後重新分派須重新 assign。已綁定會話保留原題目；公開失敗事件與延遲首次綁定的原型邊界已有確定性驗證；runtime 與邊界覆蓋分開見第 7.2.2 節。
- 恢復既有 `task_id`：無宣告時按 C 核實並恢復；同題宣告在恢復核准時消費，不建立新 pending；異題宣告拒絕且保留，不改既有會話。核實失敗不改任何記錄。

選擇依據：跨輪宣告與恢復已驗證；舊「下一輪准入清除宣告」規則撤回。條件與失敗見第 9 節 G-V1。

### 2.2 分派與綁定

對 C design 第 3 節的改動：

1. **分派登記（`task` 的 `tool.execute.before`）**：若被分派角色是解題角色，必須存在該父會話與角色的宣告。登記的待綁定分派附帶題目 id，並消費該宣告。沒有宣告時拒絕（理由寫入審計，回覆固定短碼）。
2. **首次綁定**：子會話綁定時，綁定內容多出 `challengeId`（來自待綁定分派；run 範圍角色為空）與工作目錄（第 3.1 節）。宿主在綁定後準備該目錄，完成後才返回子會話的首次 chat.message／放行首次模型准入。準備等待不占全局狀態隊列，返回後再核實會話有效性。
3. **工具不接受題目參數**：解題角色的工作區、HTTP、作業工具一律以綁定的 `challengeId` 為範圍，工具參數中沒有題目 `id`。這使題目歸屬只來自綁定表，模型不能在調用中改指其他題目。
4. **`task_id` 恢復**：題目不變；宣告的核實與消費按第 2.1 節，合法恢復不建立新的待綁定分派。

### 2.3 綁定後的範圍

綁定的 `scope` 仍為 `run`（C design 第 3 節第 3 點），新增欄位 `challengeId`。解題角色對其他題目的任何工具調用都沒有對應的參數可用，因此不需要在每次調用比對第二個題目；但作業句柄、HTTP cookie 與工作目錄仍按 `challengeId` 核對（第 4、5 節），防止未來新增的工具漏查。

---

## 3. 工作區

### 3.1 佈局

這裡的「三根」指題目材料、會話工作目錄與已發布產物的三個文件根目錄，不是三份模型上下文，也不是新增 Agent 機制。Agent 看到 `materials/`、`work/`、`published/` 三個名稱，宿主依題目與會話映射到實際路徑，模型不填宿主路徑。同題的 Engineer 與 Domain Solver 可讀相同材料及已發布產物，但各自的 `work/` 不同；跨角色不能直接拿對方的 `work/` 路徑讀取文件。`published/` 的發布接口歸 D；現已按 [D §3](2026-10-24-design-v1-d-candidate-verification-minimal.md) 接入宿主快照與登記表，G 的讀／列／搜共用其同題授權，不代表候選或驗證接口已完成。

每題的工作區位於運行資料目錄的 `workspace/<challenge-id>/` 之下（E design 第 3 節）：

| 目錄 | 寫入者 | 解題角色的權限 | 說明 |
| --- | --- | --- | --- |
| `materials/` | 宿主（E design 第 3 節，唯讀） | 讀 | 題面與附件，逐字節固定 |
| `work/` | 宿主建立；綁定的會話寫入 | 讀寫 | 只屬於綁定它的會話；目錄名不含會話 ID，對模型以 `work/` 呈現 |
| `published/` | 宿主（D §3 固定發布） | 讀 | 已發布產物；讀／列／搜透過同題登記表，直接寫入禁止 |
| `jobs/` | 宿主（第 5 節） | 不可見 | 作業的標準輸出與錯誤輸出，只能經 `job.read` 讀取 |
| `http/` 的 body 檔 | 宿主（第 4 節）寫入 `work/http/` | 讀 | 寫在會話自己的 `work/` 下，便於用工作區讀取工具續讀 |

`work/` 的實際磁碟路徑為 `workspace/<challenge-id>/work/<會話 ID>/`。會話 ID 只出現在宿主路徑中，不回傳給模型。

**採用三個明確根目錄，不用共同父目錄推導：** `WorkspaceRoots = { materialsDir, workDir, publishedDir }`。`materialsDir` 直接使用 E 的 `PreparedChallenge.materialsDir`；`workDir` 是已綁定會話的實際目錄；`publishedDir` 是本題宿主發布目錄。每項由宿主解析，不能由模型傳入。工具先把虛擬首段映射到對應根，再在該根內核實餘下路徑。不能把共同父目錄當作模型的 `work/`，不能靠符號連結拼接三根（第 3.2 節禁止符號連結）。目錄由宿主在首次准入前準備；`published/` 未有產物時為空，發布仍屬 D。

兩個同題會話共享 materials／published，但 work 指向不同目錄；工具的 list／search／read 都不能透出另一會話 work。工具根映射不等於 OS 隔離，作業直接文件訪問仍依第 5.4 節。

### 3.2 虛擬路徑與工具

模型只看到三個根：`materials/`、`work/`、`published/`。路徑規則：

- 必須是相對路徑，首段必須是三個根之一；不得含 `..`、空段、`\0`、反斜線，不得是絕對路徑；
- 逐段 `lstat` 檢查，任何一段是符號連結即拒絕；解析後的 `realpath` 必須仍在對應根之下；
- 寫入只允許 `work/`；`materials/` 與 `published/` 寫入一律拒絕。

| 工具（插件 id） | 參數 | 回傳 | 限制 |
| --- | --- | --- | --- |
| `workspace.list`（`ctf_workspace_list`） | `path`（可省略＝三個根） | 條目名、類型、大小；不遞迴 | 最多 500 條，超出標明截斷 |
| `workspace.read`（`ctf_workspace_read`） | `path`、`cursor`（可省） | 文字分頁（同 E design 的 `challenge.read` 語義：32 KiB 一頁，不切斷 UTF-8，`nextCursor`）；二進位只回傳大小與開頭 8 字節 | 唯讀 |
| `workspace.write`（`ctf_workspace_write`） | `path`（須在 `work/`）、`content`、`encoding`（`utf8` 或 `base64`） | 寫入的大小與 sha256 | 單次 1 MiB 上限；覆寫既有文件，不提供刪除；父目錄僅能在 `work/` 內建立 |
| `workspace.search`（`ctf_workspace_search`） | `path`（可省略＝三個根）、`needle`（字面字串，非正則） | `path:行號` 與 ≤200 字元的片段 | 跳過二進位與超過 1 MiB 的文件；最多 200 條，總輸出 32 KiB |

`workspace.read` 與 E design 的 `challenge.read` 共用實作（把 E 的「題目 `id` + `materials/`」泛化為「根目錄 + 相對路徑」），避免兩套讀取語義分叉。

選擇依據：E 的真實材料佈局與同題雙會話讀寫已驗證；共同根接口不符合此佈局，已淘汰。驗證範圍見第 9 節 G-V3。E/G 共用讀取實作與並發路徑替換仍未驗證。

### 3.3 配額

**128 MiB 保留為可配置的初始總量提案，計量口徑與持久硬邊界未定，現有原型沒有強制執行。** 已實作的只有 workspace.write 單次 1 MiB；跨會話累計、HTTP body 和作業直接寫入都能超過總量。

**採宿主計量配合 OS 硬邊界的責任方向，持久儲存方案未選定。** 宿主負責可信歸屬、同題原子保留、覆寫差額與 unknown 結算；OS 邊界負責攔截直接腳本寫入及並發增長。只掃目錄或只記受管工具不能強制全部寫入。覆寫須計入臨時文件尖峰，失敗後只有確認回收的空間才可退還。

待定口徑是各會話 work（含 HTTP）及宿主 jobs 輸出是否共用 G 額度，materials／published 則由 E／D 負責；須區分邏輯大小、實際配置空間與累積寫入量，不能混稱「總量」。比較持久卷 quota 與有界檔案系統時，需兼容會話隔離和非 root 部署，驗證重啟、稀疏檔案與 metadata。小容量 tmpfs 可硬拒絕寫入，但重啟清空且稀疏邏輯大小可超容量，**不採為產品持久工作區**。數值適用性仍未校準，實測條件見第 9 節。

### 3.4 唯讀的實際邊界

受管工具不提供寫入 `materials/` 的路徑，這是工具層的邊界。然而作業以程序形式運行（第 5 節），若與宿主同一 OS 用戶，程序可以直接寫入或改權限。因此產品運行時，**必須有 OS 隔離，使作業對 `materials/`、`published/`、控制服務的狀態目錄與其他題目的目錄沒有寫權限**；同題會話間也要隔離。獨立會話容器的機制已驗，產品建立／回收接口仍未定（第 5.4 節）。開發機單用戶運行時無法滿足此條件，本文不把開發機結果當作唯讀證明。

### 3.5 解包

不新增解包工具。歸檔由作業在 `work/` 中以 Python 標準庫或 `tar` 解包；解包的輸出路徑由腳本自行決定，宿主只保證它落在會話可寫範圍（第 3.4 節的 OS 邊界）。來源關係由 E design 的材料 sha256 與作業的 argv 記錄保存。若實測發現解包必須有宿主層的路徑與大小限制，再以受管工具補上（延後項）。

---

## 4. HTTP

### 4.1 工具

`http.request`（`ctf_http_request`），授予 `recon`、`domain-solver`。

| 參數 | 規則 |
| --- | --- |
| `method` | 預設 `GET`；允許 `GET`、`HEAD`、`POST`、`PUT`、`PATCH`、`DELETE`、`OPTIONS`；不允許 `CONNECT`、`TRACE` |
| `url` | 絕對 URL；scheme、host、port 必須與題目 `target` 的 origin 完全相同（第 4.2 節） |
| `headers` | 最多 20 項，單值 ≤ 2 KiB；拒絕 `connection`、`keep-alive`、`transfer-encoding`、`content-length`、`upgrade`、`proxy-*`；允許 `Host`（CTF 虛擬主機需要），連線位址仍由第 4.2 節決定 |
| `body` 或 `body_base64` | 互斥，解碼後 ≤ 64 KiB |
| `follow_redirects` | 預設 `false`；`true` 時最多 5 跳，每一跳都重新核實 origin（第 4.2 節） |
| `timeout_ms` | 預設 15000，上限 60000 |

回傳：狀態碼、響應頭（含 `Set-Cookie`，總量 ≤ 16 KiB）、`redirectChain`（每跳的 origin 與路徑，不含 body）、`bodyPath`（`work/http/<序號>.bin`）、`bodyBytes`、`bodyTruncated`（保存上限 1 MiB）、`preview`（前 2 KiB 的 UTF-8 文字，或二進位的開頭 8 字節十六進位）。完整內容由 `workspace.read` 續讀。

### 4.2 scope 核實

- **origin 規則：** 題目 `target` 為 `http` 或 `https` 時，請求的 scheme、host（小寫）、port（含預設埠規範化）必須與 `target` 相同；`target` 為 `tcp` 或無目標時，`http.request` 直接拒絕。離線題與 TCP 題不得經此工具訪問。
- **每一跳：** 重定向的 `Location` 解析後同樣比對，越界即停止並回報 `redirectChain` 中的越界位置，不發出該跳請求。
- **連線位址：** 核實時解析的位址必須與實際連線位址一致（防止 DNS 重綁定）；目標 host 是 IP 字面量時直接使用。
- **TLS：** 授權 origin 的自簽憑證視為可接受，僅對該 origin 放寬；其他 origin 不存在此例外。首版採此做法以支持自簽憑證靶場；已驗證只對授權 origin 放寬（第 9 節 G-V4）。
- **代理：** 忽略環境中的代理設定，避免請求經未核實的路徑出去。
- **憑據：** 工具不注入任何平台或 provider 憑據；`Authorization` 只能來自模型自己提供的頭。

### 4.2.1 宿主接口與全程取消

HTTP 適配器由宿主提供 `{target, jar, workDir}`；每次請求另帶 `HttpOperation = {run, sessionID, callID, signal, deadline}`。這些欄位不接受模型參數，綁定核實、配額登記與終態保存仍由 C 負責。

- `deadline` 是絕對 Unix 毫秒，取宿主時限與「開始時間 + timeout_ms」的較早者。DNS、連線、所有重定向、讀取與 body 落盤共用一次期限，不逐跳重置。
- 解析得到的地址固定到實際 socket；DNS 隨後改變也不改連線目的地。取消後 DNS 遲到返回不得再開 socket；底層 resolver 可能仍在執行，不把它寫成已終止。
- 取消銷毀請求／響應，將 AbortSignal 傳給落盤操作；保存失敗或取消的部分文件不算成功 body。
- 落盤收尾最多等 1000ms，仍未確認則返回 `cleanup_unknown`，宿主保留未知狀態與名額。這是原型採用的收尾值，產品數值確認見第 10 節。

這取代「只限制 socket 等待」的舊原型；原 DNS 超時後仍連線與落盤阻塞失敗均保留於第 9 節證據。

### 4.3 cookie 與會話

每題一個 cookie jar，由控制服務持有（不寫入工作區）。`Set-Cookie` 寫入 jar，之後同 origin 的請求自動帶上（路徑以前綴匹配，不實作完整的 domain 規則）。獲准 HTTP 的 Recon／Domain Solver 共用同題 jar。Verifier 不獲普通 HTTP，也不默認接入 Solver jar；安全重放的狀態依賴由 D 的可信驗證模式決定。jar 不跨題、不回傳模型。

### 4.4 併發與取消

每題同時進行中的 HTTP 請求上限暫取 8，由 C 按 challengeId 登記，同題會話共用、跨題容量獨立。完成或確認取消後釋放；unknown 不歸還名額。run／session 停止按第 7 節取消歸屬請求。並發保留、取消／失敗釋放及 unknown 占槽已驗證；落盤遲到返回不會自動對帳，不能重建服務清掉 unknown。數值採可配置初始預設、適用性未校準，持久恢復未實作。

### 4.5 受保護操作的責任界面

**不新增 G 端點語義分類器；已知操作的語義由可信 D／E adapter 提供，宿主保存意圖與處理 unknown。** GET 可以啟動計時，POST 可以只是觀察，HTTP 方法、路徑名稱及模型自述都不是可信分類。也不以對全部未知端點增加人工審批代替語義來源。

可信描述須回答來源版本、操作與實際請求的對應、共享副作用範圍、限次計數點及權威業務確認；具體 schema 未定。宿主先持久化意圖再發送，區分 HTTP 回應與業務確認；發出後斷線或遺留 dispatching 不自動重發，同副作用的別名也不能繞過。隔離受影響操作，保留普通觀察及無關操作；unknown 只能依權威對帳或明確恢復決策解除。

**完整接線仍未成立。** 有限 fixture 的可信清單支持這個責任方向，不能分類任意靶場，也沒有覆蓋腳本等出口。D／E 仍須定義描述覆蓋域、未描述請求的處理、共享資源範圍及對帳／解鎖。fixture 的封閉清單不能直接變成通用 HTTP 的新限制。E 啟動前 TCP 探測可能觸發「連線即計時」，須在接入階段處理；G 不能事後補救。

---

## 5. 作業（腳本執行）

### 5.1 為何用受管作業，而非原生 `bash`

**採用受管 `job.run`，原生 bash 維持拒絕。** 原生 bash 繼承 OpenCode 的 provider／RPC 環境；已查的 plugin 1.19.0 公開接口不能同時限定工作目錄與 uid。受管作業讓宿主固定工作目錄、環境和程序組，不把控制憑據交給腳本。這個選擇不等於已完成 OS 隔離，隔離方案仍須按第 5.4 節驗證。公開接口判斷的範圍見第 9 節 G-V2。

### 5.2 工具

`job.run`、`job.read`、`job.cancel`（`ctf_job_run` 等），授予 `recon`、`domain-solver`、`engineer`、`verifier`（`verifier` 用途為本地重算，實際隔離仍待完成，見第 6 節）。

| 工具 | 參數 | 回傳 |
| --- | --- | --- |
| `job.run` | `argv`（1–32 項，每項 ≤ 4 KiB，無 `\0`）、`timeout_ms`（預設 60000，上限 600000） | 同次工具等待完成、超時、取消或啟動失敗；回傳 `job`（UUID 句柄）、結果狀態及適用的退出碼／signal，收尾未確認另記 unknown |
| `job.read` | `job`、`stream`（`stdout` 或 `stderr`）、`cursor`（字節偏移，可省） | 最多 32 KiB 的一頁、`nextCursor`、`state`、`exitCode`、`signal`、`done` |
| `job.cancel` | `job` | 最終 `state` |

`argv` 不經 shell 解釋；需要 shell 語法時，由模型明確寫 `["sh", "-c", ...]`，同樣受本節所有限制。

**狀態：** `running`、`exited`、`timed_out`、`cancelled`、`failed_to_start`。`job.read` 以 base64 回傳輸出 bytes；句柄只屬於啟動它的會話和題目。

**採同次工具等待終態，移除模型參數 `wait_ms`，不保留試驗用 `completion: terminal` 雙模式。** `running` 是宿主內部在途狀態，不作正常提前返回。Solver 在此工具等待中不取得早期句柄、不發模型輪詢；完成後以 `job.read` 分頁讀取保存輸出。等待中的進度觀察與停止由第 7.2.1 節的 Coordinator 契約承接，不授予 Coordinator 任意讀取 Solver 私有工作區。`job.cancel` 保留作已有合法句柄的取消入口，不依賴 Solver 在 pending 工具中再發 cancel。取消可使原工具返回錯誤；宿主仍保存作業結果與清理狀態，unknown 不冒充已回收。舊短等待原型及失敗證據保留，模型產品接口已接入主工作區。

### 5.3 執行環境

| 項目 | 規則 |
| --- | --- |
| 工作目錄 | 綁定會話的 `work/` |
| 環境變數 | 固定白名單：`PATH`（採 F 固定的鏡像值，不繼承宿主；原型仍未符合）、`HOME` 與 `TMPDIR`（指向 `work/`）、`LANG=C.UTF-8`、`CTF_WORK`、`CTF_MATERIALS`、`CTF_PUBLISHED`（三者為真實路徑，只給作業，不進工具回傳）。其餘變數一律不傳，尤其不傳任何 provider、RPC、平台憑據 |
| 標準輸入 | 連到 `/dev/null` |
| 程序組 | 每個作業獨立程序組；超時或取消時先送 `SIGTERM` 給整組，2 秒後 `SIGKILL` |
| 輸出 | stdout、stderr 各自寫入 `jobs/<會話 ID>/<作業 ID>/`，每流上限 1 MiB，超出後丟棄並標 `truncated`；由 `job.read` 續讀 |
| 安裝依賴 | 不提供。作業只運行鏡像預裝的解譯器與工具；缺少時 `failed_to_start` 並說明，不臨時下載（design v1 1.5） |

### 5.4 OS 層隔離（產品部署仍受阻）

**邊界不變：** 作業不得讀取控制狀態、provider／RPC 憑據、oracle 私有資料及他題材料；不得訪問他會話 work、進程環境／記憶體或向其發信號。本題 materials／published 可讀不可改，只有本會話 work 可寫；宿主仍能發布、讀輸出、停止整組，CPU／記憶體限制須實際生效。

| 候選 | 驗證後的決定 |
| --- | --- |
| 每會話 uid＋每題唯讀群組 | 開發者注入 uid 後文件／進程邊界成立，但非 root、零 capability 的產品宿主不能切換 uid 或停止跨 uid 程序組。**在目前權限契約下不採用**；建置時建帳號不等於運行時能切換身份 |
| 非 root user／mount／PID namespace | 本次預設 Docker 部署的 unshare 返回 EPERM，沒有放寬 seccomp 或加特權；不據此否定所有 rootless runtime |
| 每會話獨立容器 | 兩題、同題雙會話、正反向文件／進程邊界、發布與輸出、CPU／記憶體及整容器停止均成立。**採為作業隔離方向，產品部署方案未選定**：啟停由開發者端 Docker 完成，產品宿主沒有允許的生命週期入口 |

下一個設計決定是隔離環境由誰建立與回收、如何以最小權限接入現有宿主並保存狀態。這會增加部署責任，不能把開發者 Docker 權限隱含進「非 root、無 socket 的單容器產品」，也不能退回同 uid 共享視圖。本輪未接產品 JobManager／C/RPC；CPU 節流、CPU 軟限及記憶體 OOM 的實測值是 fixture 約束，不是產品預設或磁碟配額。

舊 G-V6 完成說法仍不作依據；本次獨立機制驗證見第 9 節，不能替代部署接線。network=none 只用於此隔離 fixture，不證明授權目標可達和其他網路受限可同時成立。

### 5.5 作業網路 scope：底層機制可行，產品契約未定

**目前產品只強制 http.request 的 origin，作業直連仍未受 scope 約束。** Engineer 的「默認無目標網路」及 Verifier 的「本地重算」也不能只靠工具可見性成立。

| 候選 | 驗證後的去向 |
| --- | --- |
| 只設 proxy 環境 | 淘汰為獨立隔離方案：Python socket 不理會環境，curl 可清除代理或直接連線 |
| 網路 namespace＋預設拒絕出口 | 採為底層隔離機制。固定地址／協議／端口可攔截已測 TCP、UDP、IPv6、映射地址及 DNS 改址後的越界連線；**不能區分共享 IP／port 的不同 origin**，不得靜默將原 target origin 擴成地址授權 |
| 只准受管 HTTP proxy socket | 本 fixture 可強制 origin 並攔截越界重定向，但直接 TCP／UDP 不可用；未驗 HTTPS／CONNECT、SOCKS 或透明代理，不否定其他組合 |

同 origin 的管理路徑在兩種候選都仍可訪問，應由第 4.5 節可信操作描述處理，不能靠封包規則辨認。網路 scope 的可信來源、協議表達、控制／oracle 地址是否與目標分離、DNS 合法換址及角色無網路模式仍需決定。禁止僅靠 prompt 保證。

測試由可信初始化側配置 NET_ADMIN 規則，作業非 root、capability 為零且無 socket；產品尚無相應建立／回收接線。此候選須與第 5.4 節一起定部署責任。動態 scope 更新、既有連線撤銷、瀏覽器及經授權目標轉送均未驗；不能宣稱完整作業 scope 通過。條件與反例見第 9 節。

### 5.6 限制與計量

| 項目 | 可配置初始預設（適用性未校準） |
| --- | --- |
| 每會話同時運行作業 | 2 |
| 每題同時運行作業 | 8 |
| 超過上限 | 拒絕並說明，不排隊 |

作業與 HTTP 不計入模型調用准入（design v1 1.4）。2／8 的並發機制已驗，數值適用性未校準；**run 級工具次數／資源時間總額及持久恢復尚未實作**，本輪不新增數字預算。

採宿主分開記錄嘗試、拒絕、已接受啟動、HTTP 跳數與讀取次數；啟動前原子保留，已發生的次數不因失敗退款。讀取既有證據和 cancel／清理保留入口。run wall deadline、並行資源時間與 CPU 時間分開；unknown 明示未結算，不記零。持久帳本及恢復不重置仍需設計；模型呼叫數或逐工具 timeout 不能代替總額。

**啟動與結算：** 先登記操作並準備 stdout／stderr 文件，再啟動程序；文件準備失敗不得留下已啟動但未登記的進程。返回 job 句柄不釋放槽位，必須等程序組與輸出完成結算；回收不完整時保留 `reapIncomplete`／unknown 及配額。正常退出也要回收殘留程序組。驗證依據見第 9 節 G-V5 及 C／RPC。

---

## 6. 角色能力（H 落地增量）

在 C design 第 5 節的能力表上增列以下各項；兩層約束（`opencode.json` 的可見性與控制服務的執行許可）同時適用。

| 角色 | 本文新增 | 不授予 |
| --- | --- | --- |
| `coordinator` | `challenge.assign`、`challenge.unassign`、受管 `task.stop`；原生早期引用與完成交付（依 §7.2.2；未新增通用進度工具） | 任意私有工作區讀取、HTTP、作業 |
| `recon` | `workspace.*`（讀三根，寫 `work/`）、`http.request`、`job.*` | 寫 `materials/`、`published/` |
| `domain-solver` | 同 `recon` | 同 `recon` |
| `engineer` | `workspace.*`、`job.*`（作業的網路未受限，見第 5.5 節） | `http.request`（H：默認無目標網路） |
| `verifier` | `workspace.list`、`workspace.read`、`workspace.search`、`workspace.write`（僅 `work/`）、`job.*`（本地重算用途；隔離尚未成立） | `http.request`；`published/` 之外的他會話工作區。安全重放的 HTTP 能力待 D 的驗證模式決定 |
| `intake` | 無新增 | 工作區寫入、HTTP、作業；E 最小流程由宿主固定材料，Intake 讀取後經 task 交接，沒有新增寫入需求 |
| 其餘 | 無 | 無 |

`verifier` 的 `workspace.write` 僅為本地重算的中間文件，不得改寫他會話產物。**維持 Intake 唯讀與 Verifier 普通 HTTP 拒絕**：已驗流程沒有增加這些權限的必要，總 design H／C 表格對齊此最小範圍。

受管接口拒絕不等於實際隔離：同 uid 的 Verifier job 已實測能讀寫其他會話、修改材料／published 並直連範圍外 loopback。這項失敗由第 5.4／5.5 節承接；「本地重算」是用途，不能宣稱已強制。

**安全重放仍待 D：** 可信驗證模式須綁定題目／會話、候選與依賴版本、請求序列及狀態，而非由模型自稱安全。測試側候選可用新 jar 重建登入，拒絕限次／未知 GET、錯誤綁定與越界，未知不重送；不能推定真實端點可分類或 D 證據鏈已完成。依賴原連線或不可安全重放時採 evidence_audit／inconclusive；產品繼續拒絕 Verifier 普通 HTTP。

---

## 7. 控制服務、停止與長作業

### 7.1 停止與資源歸屬

停止先改綁定狀態並拒絕新操作，再回收資源。run 停止取消全部 HTTP／job；單一會話撤銷只取消該會話的資源。到期或撤銷後，已有句柄的調用也拒絕；已保存輸出保留。

HTTP／job 由 run、session、call 關聯，job 自啟動起一直登記至資源結算，RPC 返回或中斷不自動解除歸屬。只有完成結算才能釋放配額；回收失敗或超時記 unknown，不報「已清空」。控制服務重啟不恢復舊句柄，保留輸出並標為不可續；按 design v1 1.4 停止舊作業再重建，重啟後回收尚未驗證。現原型重建 ControlService 會清空記憶體帳本，launcher 收尾快照不等於持久准入記錄；空表不能證明舊作業停止，也不能用來重置已耗額度。

**採用受管 `task.stop(task_id)` 語義。** 宿主以本 run 的分派及 binding 核實直接父子關係、角色和有效期；task_id 只用來選擇，不能授權任意會話。先撤銷，再在隊列外回收資源與調公開 session.abort；資源回收和會話中止的確認／unknown 分開記錄，重複停止冪等，不重發已完成的動作、不重複歸還配額。取消不等於成功完成；已完成任務的停止回報原終態，不能改寫結果。

原 SDK 人工時序結果仍只證明局部接線；前台 task 阻塞與 SDK abort 不回收已交付 job 的原失敗保留。後續聯合驗證以原生 background 入口自然分派，由另一任務的完成通知喚醒父會話，再由父調用產品 task.stop；HTTP、job／孫進程回收及停止後 sibling 工作在各自完整 run 成立（§9）。已自然完成的執行保留原終態；host revoke 仍撤銷會話，不因已完成而失效。

### 7.2 慢工具的執行方式

**採「短暫串行登記，隊列外等待」。** C 的身份／有效性復核、准入扣次、分派和資源登記序列化；SDK、文件、DNS、HTTP 和 job 等待在隊列外。理由是卡住一個工具不能阻塞其他會話的准入或停止。任何異步準備返回後，都須在登記／啟動前再次核實停止、撤銷與到期。

執行次序：

1. 插件的公開 before hook 將 session、call 和參數交 C 核准。ToolContext 公開類型沒有 callID，採用 before 的 output.args 私有 Symbol 把可信 callID 和核准時限帶到 execute，單次消費，不加入模型 schema／JSON。
2. C 在啟動資源前登記 `{run, sessionID, callID}`、取消信號及 deadline；適配器只接收宿主提供的操作上下文。
3. 等待型 RPC 時限為宿主核准的 `min(工具等待上限, 綁定剩餘時間) + 5 秒`。HTTP 用 timeout_ms，job.run 用 timeout_ms + 4000ms 收尾；普通 hook 維持 15 秒。傳輸收尾餘量不能延長工具執行。
4. 客戶端在 response 尚未 writableFinished 前放棄，取消該操作；job 已產生句柄但響應未完成時也保留取消監聽。舊短等待原型正常 response finish 後仍運行的 job 由 job.cancel／session／run／deadline 管理；新終態等待不正常提前返回 running，收尾 unknown 仍由宿主追蹤。finish 不等於客戶端應用收到句柄，交付未知不自動重發。
5. 結算時保存結果類別及資源狀態，再釋放名額。C 的資源收尾暫取 4000ms，逾時保留 unknown；HTTP 和程序組的收尾限制分別見第 4.2.1、5.3 節。

Symbol 關聯已在 OpenCode 1.19.3／plugin 1.19.0 驗證，包括同會話同工具並發；若升級後不再保留關聯，必須拒絕並重新驗證，不能按 session/tool 猜測。數值的產品適用性仍見第 10 節。

### 7.2.1 長作業、異步子任務與 Coordinator 停止的統一契約

**設計已選定：Solver 等 job 終態；Coordinator 異步分派解題子任務，保有控制權，完成結果自動交付同一邏輯任務。** 兩層等待分開，不讓父會話被前台 task 鎖住，也不靠模型反覆查詢完成與否。

| 階段 | 契約 |
| --- | --- |
| 分派與啟動 | Coordinator 先 assign，再分派。首次返回啟動狀態與宿主核實的任務引用，child 可以繼續執行；引用須與 run、父子會話、角色、題目及該次分派關聯，模型提供的 ID 不構成授權。首次綁定及模型准入不得跳過 |
| Solver 等待 | `job.run` 同次 execute 等待終態。輸出持續有界保存，不必等 artifact 封存；宿主可讀在途輸出，Solver 完成後以句柄續讀。既有終態等待證據支持此層，不證明下面的父層協議 |
| Coordinator 控制 | 父會話取得控制權後可處理其他結果；有意義的進度／異常事件提供重新判斷機會，所需狀態入口僅返回授權任務的狀態和必要摘要。不得新增高頻模型輪詢、監工 Agent 或任意私有工作區讀取；本切片採原生早期引用及其他授權任務的完成通知提供控制機會，未新增高頻進度／輪詢工具 |
| 自動完成交付 | child 完成後，將成功／失敗／取消結果與證據引用交付原父會話並關聯同一邏輯任務。首次分派工具回覆保持原樣；後續完成訊息不冒充修改那次工具返回。重複通知不得重複消費結果；恢復同一 session 時須區分前後執行，不把舊結果當新結果 |
| 主動停止 | Coordinator 用可信任務引用調 `task.stop`；C 依第 7.1 節撤銷、回收與 abort。停止與完成競態由宿主保存實際終態，輸出保留，資源 unknown 不歸還額度。宿主 deadline／預算停止獨立生效，不等模型決定 |
| 父會話 idle 與 run 結束 | 父 idle 或一則 assistant 完成不是 run 完成；有活動 child、待綁定分派或待交付結果時不得因此 stopAll。正常完成須由可信收束狀態確認任務已處置、結果已交付且資源已結算；主動結束則走全局停止並保留 unknown。完成喚醒也須經 C 准入，run 已停時只保存結果、不重新喚醒模型。launcher 以 C 的 execution、pending、待准入交付及未結算資源判定，原生父 idle 只作可收束條件之一 |

**驗收語義明確調整：** 不再要求「原父 native task 工具調用一直 pending，最後由同次返回結果」，改為「同一邏輯任務、可信關聯、自動最終交付且無模型輪詢」。Solver 的 job 工具仍是同次終態等待。這是為等待中控制而作的設計取捨，不能把舊 promptAsync 恢復或前台停止失敗改標通過；新父層契約的固定候選 runtime 證據見 §9；舊失敗不改標通過。

**固定採原生公開路徑：** OpenCode 1.19.3 在 server 環境啟用 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 後，實際 schema 暴露 `background`，原生 `task(background=true)` 提供早期 child 引用及後續 synthetic 完成通知。關閉時無此字段的原結果亦保留；不是升級二進制或僅憑保存源碼作判斷。SDK 備案本片不啟用。

C 在 before 生成執行 ref，經原生 `description` 傳遞固定 `[ctf:<ref>]` 標記；模型不維護此欄位。它是原生通知的關聯載體，不是從模型自由文字授權：必須同時核對 runtime synthetic、原父、原 child、宿主 execution 表和原生 callID／metadata。首次綁定用 SDK parentID／agent 及父 tool part 的 callID→sessionId 精確核實；父＋角色單獨不夠。恢復同 session 必須上一執行已終結，再建立新 ref；並行 extend 同一執行拒絕。不同 ref 不混淆，首次 running 回覆獨立保存且不改寫。

完成通知分 `queued`、經共享准入後 `consumed`、停止／預算拒絕後 `suppressed`；重複／遲到通知留痕並拒絕再次喚醒。取消的原生 background 不保證另發完成通知，本片以 C task.stop 的關聯終態回覆交代取消，資源及 SDK unknown 另存；不得稱為成功完成。公開 hook 的文本封裝及 metadata 保留性依賴固定版本，升級須重驗。

代價是多出一個需可信關聯、去重及喚醒的父層交付邊界；收益是 Solver 保持簡單阻塞工具語義，Coordinator 能處理進展及主動停止。批次作業暫不提供 Solver 等待中互動輸入；PTY／TCP 的原產品目標不變，仍按第 1 節延後。

### 7.2.2 聯合驗證結論與邊界

本切片的原生公開映射可行；不是產品代碼已合併或自主解題完成。證據統一見 §9「異步生命週期聯合驗證」。

- **runtime：** 同一固定候選六個獨立完整情境：6.5 秒 job 的同次終態返回與自動父交付、HTTP 停止、job／孫進程停止、同 child session 再執行、父活動時通知到達，以及完成喚醒遇預算拒絕。兩個停止 run 均由 sibling 原生結果提供自然控制機會，父自行調 stop，隨後 sibling 再執行真實 job；沒有測試側 SDK 恢復 child。
- **確定性邊界：** 父先准入／child 延遲綁定、公開啟動 error 釋放、unknown 不釋放、遲到 child 精確拒絕、重複／遲到結果、恢復世代、首次回覆不變、早期引用停止、全局／重複停止、預算准入、完成／停止交錯、角色／外來／到期拒絕，以及 HTTP/job cleanup unknown 保額。這些故障注入不冒稱全有 runtime 覆蓋。
- **收束：** 活動／starting execution、pending、queued 結果或非 settled 資源阻止正常 idle 收尾；不能用任意 SDK busy 快照替代可信執行帳本。完成／取消結果、共享准入及回收記錄各自保存。
- **限制：** 只驗當次進程內生命週期；無跨重啟恢復或用量重建，無真實模型、OS／網路隔離或 D/oracle 結論。產品合併與角色說明的最終接入不在本片。原型 C 保留舊 direct-host 測試所用的顯式 wait_ms/completion 路徑，但模型 schema 已移除兩者，正常入口只同次終態等待；不把舊內部路徑稱為當前模型契約。

job RPC 按 min(timeout_ms + 4000ms, 綁定剩餘時間) + 5000ms 核准；609000ms 仍只為邊界值，未真等十分鐘。重複原生通知與 cleanup unknown 的 runtime 故障注入尚未做，已有 C／適配器確定性證據，後續整合不得混稱全面 runtime 通過。

### 7.3 審計

分派、綁定、進度、終態及交付記同一邏輯任務與該次執行的可信關聯，分開保存初始回覆、後續結果與交付狀態；每筆 tool.execute 記 tool、callID 與結果類別；資源登記／結算記 run、session、題目、job 句柄、deadline 和狀態；RPC 放棄記原 session/call/job。控制審計不記 HTTP body 或作業輸出正文，只記必要大小、hash 與狀態；正文保存在對應輸出文件。

### 7.4 插件清單

產品插件註冊本設計的 challenge.assign／unassign、workspace 四工具、http.request、job.run／read／cancel，launcher 傳入工具清單並按第 6 節設角色權限。模型可見性與 C 執行核准兩層都保留。受管 task.stop 與原生 background 映射已在隔離原型註冊並驗證（§7.2.2）；主線已接入，未新增通用進度工具。

移除已退場的 workspace.patch、workspace.unpack、observation.read、hypothesis.propose／conclude。candidate.register 屬 D，G 不註冊。接線經獨立工作區驗證及主 session 複核後，已接入主線。

---

## 8. 實作邊界與目前位置

| 責任 | 實作位置 | 目前狀態 |
| --- | --- | --- |
| 題目宣告、綁定、資源登記、配額與停止 | apps/launcher/src/control-service.ts | 既有接線與異步 pending／聯合契約已在隔離原型驗證，已接入主區 |
| 三根文件、HTTP、受管作業 | apps/launcher/src/workspace-tools.ts、http-tools.ts、job-tools.ts | 原型與產品入口已驗證；隔離及缺口不能由此推定成立 |
| RPC 信號與等待、工具參數及角色可見性 | control-rpc.ts、apps/opencode-plugin、launch.ts、product/opencode/opencode.json | 模型新參數、原生背景交付與 idle 收束已在隔離原型驗證，已接入主區 |
| E/G 共用讀取實作 | intake-tools.ts、workspace-tools.ts 與 file-page.ts | c323 已共用 UTF-8 分頁／cursor／binary 判定；路徑授權仍由各適配器負責，同材料 parity 回歸通過；已接入主區 |
| 產物發布、候選、獨立驗證與 oracle | D 的責任 | 本文不接線，不作 G 通過條件 |

上述已定接線已按核實的候選逐文件整合到主工作區，沒有另寫一套原型；整合驗收見 §9.2。可行性已確認的部分，以正文契約作後續實作依據；當前接入直接依賴的未定部分先解決設計問題，不能由實作者自行選定；第 10 節延後項不阻斷已確認部分拆實作 plan。本文不授權整合或新一輪運行。

## 9. 設計依據與驗證範圍

以下記錄支撐正文決定的結論，不作執行日誌。驗證日期均為 2026-10-23；runtime 使用 OpenCode 1.19.3、SDK/plugin 1.19.0 和 loopback 確定性替身 provider，沒有真實模型請求。各批獨立保存，不拼接為同一次通過。另列的 OS／網路與配額 fixture 不經 OpenCode，僅使用本地非秘密資料與測試服務。

| 驗證 | 結論及其限制 | 證據 |
| --- | --- | --- |
| G-V1 跨輪宣告與分派 | execute 生效、跨輪保留、task 消費、恢復及失敗清理成立。T1–T9 確定性 14 項；runtime 覆蓋 T1/T5/T7/T8，T7/T8 為 RPC 邊界注入，其他項不冒稱 runtime 通過。舊同輪預檢生效／下輪刪宣告規則不採用 | [跨輪報告](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md) |
| G-V2 原生 shell | plugin 公開類型沒有可同時限定 cwd、uid 的接口，因此維持受管 job；僅類型檢查，未驗 shell.env 運行時合併／清除或所有權限配置可能性 | [原生 shell 檢查](../../gates/g-solver-verification-20261023/G-V2-native-shell.md) |
| G-V3 三根映射 | 真實 E prepareRun、同題雙會話正向讀寫及唯讀／路徑拒絕成立，定向 10/10，含舊九項。0444 只防誤寫；128MiB、OS 隔離、並發路徑替換和共用讀取不由此證明 | [三根報告](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md) |
| G-V4 HTTP | 舊 scope／cookie／header／截斷／代理／自簽 TLS 九項保留；全程 deadline／取消補驗 20/20。實際 socket 固定 A、DNS 後變 B 仍零連線；持久化阻塞保留 unknown。該批 HostBoundary 無 challengeId，不能證明每題配額 | [HTTP 生命週期報告](../../gates/g-solver-verification-20261023/g-v4-http-lifecycle/REPORT.md) |
| G-V5 作業 | 舊九項證明環境白名單、空 stdin、輸出分頁／截斷、啟動失敗、句柄與併發規則；只殺 leader 的變異使孫程序回收測試失敗。原型不證明 OS 隔離；會話／run／到期及 unknown 補驗由下一行支持 | 舊完整報告缺失，舊結論與來源保留於[整理前記錄](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/design-before-editorial-rewrite.md)；補驗見下一行 |
| C／RPC 真實產品接線 | 同一次 runtime/accepted 完成綁定→材料讀→同輪雙寫→HTTP 16004ms→job 增量讀／16054ms 等待→停止；12 次替身請求對應 12 次准入，9 個資源結算。確定性邊界另驗短隊列、每題配額、放棄／交付競態、session/run/expiry、孫進程與 unknown。全套 291/291、typecheck/build，主會話獨立 46/46；不稱每個競態都有 runtime 覆蓋 | [C／RPC 報告](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/REPORT.md) |
| 長作業公開完成／恢復候選 | 測試側觀察真實 job 結算後調公開接口；同 child 恢復、去重與取消對照成立，但父 task 已結束、輸出不變。候選不足，未通過完成交回。這是測試通知器，不是產品已具備自動通知 | [恢復結果](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/completion-probe/first/resume-and-duplicate/result.json)、[取消對照](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/completion-probe/first/cancel/result.json) |
| 長作業同次終態等待候選 A | 原型可行性通過；該批契約為提案，現按 §7.2.1 選定 Solver 終態等待，不增加父層通過證據。runtime 的 success：16 秒作業超過 20ms 初始等待，原父 task 期間 running、最終 completed 且含同 job 終態／輸出，等待中無 child provider 請求；timeout 與公開 abort 各獨立運行。確定性補驗 6 項覆蓋增量、其他會話准入、取消冪等／call 重複拒絕、到期、RPC 斷開、609000ms 核准與 unknown 保額。全套 297/297，typecheck/build；早期句柄及 10 分鐘實時等待未驗 | [長作業決策報告](../../gates/g-solver-verification-20261023/decision-long-job/REPORT.md) |
| 配額與預設 | 新增 16 項、本地定向合計 50/50，全套 307/307、typecheck/build。單次 1 MiB 與 HTTP8／job2及8的並發、取消／失敗／unknown 支持所列局部機制；128 MiB 總量、固定 PATH、持久工具計量的成立性檢查仍失敗。非 root ARM64 1 MiB tmpfs 實測 ENOSPC 與並發硬容量，但重啟清空、稀疏邏輯大小可超容量；不能採為產品持久方案或校準數值 | [配額報告](../../gates/g-solver-verification-20261023/decision-resource-limits/REPORT.md)、[逐項判據](../../gates/g-solver-verification-20261023/decision-resource-limits/criteria.json) |
| 受保護操作責任驗證 | 本地 11/11：GET 計時與 POST 觀察反例、發送前持久化、限次／並發別名、斷線 unknown 及重開 SQLite、普通觀察保留、直接／重定向／selector 拒絕、200 無業務回執。舊 PlatformService 換 generation 可重發、E 啟動 TCP 探測會連線的缺口均保留。全套 302/302、typecheck/build 通過；只為測試側 adapter 原型，不是產品完整保護或真實平台驗收 | [受保護操作報告](../../gates/g-solver-verification-20261023/decision-protected-operations/REPORT.md) |
| Intake／Verifier 最小權限 | 真實 E prepareRun＋C 定向 8/8：Intake 無寫入可列題讀材料；Verifier 私有 work 重算、受管路徑與雙 hook 拒絕成立。獨立產品 runtime 一次完成 Intake task 交接及 Verifier 重算；14 次替身請求對應 14 次准入、受管 HTTP 零目標請求。測試側重放候選驗新 jar、綁定、scope、限次拒絕和未知不重試，並非 D 已實作。另一次實際 job 邊界探針退出 1：同 uid 檔案與直接 HTTP 均可繞過，完整角色隔離不通過 | [角色權限報告](../../gates/g-solver-verification-20261023/decision-role-permissions/REPORT.md) |
| Coordinator 停止入口 | 部分通過：task.stop 候選權限／回收成立，9 項新定向測試；與 C 停止准入等共 55/55，全套 300/300，typecheck/build。真實產品入口以 SDK 時序 fixture 分別驗 HTTP/job 等待、孫進程回收與 sibling 繼續。無 SDK 的前台 task 對照只在等待結束後才放行父下一輪；原生 SDK abort 不收已交付作業。該舊批完整產品主動停止判據未通過；後續原生聯合驗證另列下一行，舊結果不改標 | [停止入口報告](../../gates/g-solver-verification-20261023/decision-coordinator-stop/REPORT.md) |
| 異步生命週期聯合驗證 | 原生公開路徑可行：固定 OpenCode 1.19.3 開關 false/true 實際 schema 對照；同候選六個完整 runtime 情境均符合預期（五個 completed、一個預期 budget_exceeded）。6.5s job 超過舊 5s 初始等待，父 idle 保留、無 child 模型輪詢、自動交回且首次回覆不變；自然 HTTP/job stop、孫進程於 stop 回覆前消失及 sibling 停止後工作；同 session 不同 ref、通知遇父活動及預算拒絕成立。定向 86/86、全套 319/319、typecheck/build；來源與候選 hash 零漂移。重複／遲到、啟動失敗、unknown 等為確定性覆蓋，非全 runtime；本片無 SDK 備案、真實模型或隔離結論，主 session 已完成獨立複核（見本節複核記錄） | [聯合報告](../../gates/g-solver-verification-20261023/joint-async-lifecycle/REPORT.md) |
| G-V6 OS 隔離 | Ubuntu 24.04 原生 aarch64、kernel 6.12.76-linuxkit、Docker 29.5.3；同一最終 run-4 完成兩題／同題雙會話、文件／進程／控制哨兵、宿主發布及輸出、CPU 節流與 SIGXCPU、記憶體 OOM、開發者端整容器回收。每 uid 方法缺非 root 啟動／回收權，user namespace EPERM；獨立容器機制成立但產品外生命週期責任未定，故產品仍受阻。首輪父目錄所有權 fixture 失敗保留，不拼接為通過 | [OS 隔離報告](../../gates/g-solver-verification-20261023/decision-os-isolation/REPORT.md) |
| 作業網路候選 | 同一 accepted 批次四組各 35 個探針，15 項服務端日誌不變核對；非 root／capless／raw socket 與改規則拒絕成立。IP／port 機制可行；共享 IP 另一 origin、同 origin 管理路徑可達，完整 scope 未通過。只設代理可繞過，強制 HTTP 代理不提供普通 TCP／UDP 直連；未跑瀏覽器或 OpenCode | [網路候選報告](../../gates/g-solver-verification-20261023/decision-network-scope/REPORT.md) |
| 真實模型工具使用 | 本批未運行；OS／網路的機制證據與產品部署限制見上述獨立項 | 不由無模型結果推定自主解題能力 |

主 session 已對聯合驗證的 368 項交付 hash 與 100 項候選源碼 hash 核對一致，並在保留原始 final 批次的前提下獨立重跑六個完整 runtime 情境和 86 項定向測試，均符合判據；預算情境按預期 budget_exceeded。原批次與主 session 複跑分開保存於[複核記錄](../../gates/g-solver-verification-20261023/joint-async-lifecycle/parent-review.json)，不拼接為同一次運行。主線只同步文檔及證據。

C／RPC 代碼基線為 d83a0c3024271dbf212db319e900fcf527e68b0f 加獨立工作區未提交修改，Node v26.3.0、Vitest 2.1.8；來源、配置及最終 hash 見該報告目錄。公開恢復探針與 runtime/accepted 是不同運行。

主會話已核對七項來源 hash、原始輸出與判據；獨立復跑長作業 6、配額 16、受保護操作 11、角色 8、停止 9 項，共 50 項通過，並完整重跑 OS fixture。網路以四組原始輸出、權限設定及 15 項服務端日誌作獨立離線核對，未重跑封包探針。各目錄 parent-review.json 區分原始批次與主會話複核；上述通過不抵銷產品未定項。

**影響設計的失敗均保留：** 跨輪宣告被提前清理、共同根接口不符真實佈局、DNS 超時後仍連線、落盤／目錄準備阻塞收尾、先 spawn 再開輸出文件導致未登記進程，以及首次准入前未建目錄。各報告保留修正前後的證據和測試 fixture 失敗；舊 V3–V5 完整報告未找到，不補造。舊敘述及詳細執行記錄保存在整理前快照，不作當前設計規則。

### 9.1 G 已定接入的實作與主 session 核對（2026-10-24）

**本節記錄整合前的獨立工作區驗收；後續主區接入見 §9.2。** 候選位於 `/Users/caihaoming/.codex/worktrees/c323/pentest-agent`，基線 HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f` 加未提交修改。按 §10.1 接入題目綁定、三根文件、HTTP／job、RPC、原生背景交付、恢復、停止與可信收束，並補既定角色權限及使用說明。九項職責保留，未另建 Solver／編排器；未加入 §10.2 延後工程，未新增 D 工具、schema 或發布 stub。

原 joint 工作區已不存在；子 session 從有 manifest 的 C/RPC 原型及保存增量恢復，恢復檔案與原候選 hash 一致後才接入。主 session 核對本次 290 項交付 hash 全部一致，主區基線在回寫前零漂移。E/G 只共用文件分頁，沒有擴展為全域重構。

- **同入口複跑：** 真實 E prepareRun → Intake 原生交接 → Reference／Strategy、Recon 工具操作 → Domain Solver 腳本失敗後恢復同 child 修正 → Engineer／Verifier 各自材料重算 → 結果交回及收束。同次 40 次替身請求／准入、5 次背景 execution、12 項資源 settled；兩次 Solver 執行 ref 不同，原始失敗輸出保留。published 為空，沒有預置發布文件冒充 D 交接。Recovery Critic 未因一次普通腳本錯誤觸發，原職責與持續停滯條件保留。
- **生命週期複跑：** 同一候選完整六情境五個 completed、一個預期 budget_exceeded；自然 job／HTTP 停止、孫進程回收、sibling 繼續、父 idle／活動、同 child 恢復及預算拒絕符合判據。停止由原生 sibling 完成提供控制機會，無測試側 SDK 恢復 child。
- **檢查層次：** 主 session 獨立定向 60/60，並核對新批原始事件、結果關聯與 stdout／stderr；子 session 全套 323/323、typecheck/build 退出 0 的原始記錄已核對，主 session 未再跑整套。重複／遲到及 unknown 的故障注入仍分開標為確定性覆蓋，不冒稱全部 runtime。
- **保留的失敗：** 子 session 首批兩個 stop 情境因 fixture 全文搜尋撞到新 Coordinator 指令中的工具名稱而沒有發 stop；修正為讀 assistant.tool_calls，產品與 deadline 未改。首批失敗及完整修正批均保留，不拼接結果。

**D 仍是完整團隊做題流程的直接缺口：** Engineer／Verifier 各自得出本地輸出 42，只證明工具與角色接線，不證明 Solver 產物已發布、候選已固定或獨立驗證結果有效。D 接口沒有自行設計。完整做題流程、真實模型能力與 solved 均未成立；OS／網路隔離、持久總配額及跨重啟恢復限制不變。舊 direct-host wait_ms/completion 只留內部回歸路徑，模型 schema 不暴露，不能稱已清理所有舊內部接口。

版本仍為 OpenCode 1.19.3、SDK/plugin 1.19.0，全部 runtime 使用本地確定性 provider；沒有真實模型調用。本節核對時產品及測試尚在未合併 worktree；後續接入狀態見 §9.2。依據與必要原始證據見 [主 session 核對](../../gates/g-solver-verification-20261023/integration-20261024/parent-review.json)、[交付來源及命令報告](../../gates/g-solver-verification-20261023/integration-20261024/REPORT.md)、[同入口複跑](../../gates/g-solver-verification-20261023/integration-20261024/parent-team-runtime/summary.json)、[六情境原始核對](../../gates/g-solver-verification-20261023/integration-20261024/parent-verification.json)。

### 9.2 主工作區接入與驗收（2026-10-24）

使用者在 §9.1 核對完成後授權整合、提交推送及子 session 清理。主工作區選取 33 個產品／測試檔案，逐文件 hash 與 c323 已驗收候選一致；保留主區最新設計及歷史失敗證據，沒有整份覆蓋子區文檔。§2–7 的已定接線及 E/G 共用分頁現已在主區，D 未定接口、隔離部署與其他延後項沒有加入。

主區重新執行 typecheck、build、全套 42 檔／323 項測試，均退出 0；同入口無模型複跑 40 次請求／准入、5 次 execution、12 項資源結算，退出 0。複跑只改測試輸出目錄以保留舊批次，沒有修改產品候選。這支持 G 接線整合，不代表 D 完整交接、真實模型能力或 solved；§9.1 的限制保持不變。來源與命令輸出見 [主區整合核對](../../gates/g-solver-verification-20261023/integration-20261024/main-integration-review.json)，[同入口原始結果](../../gates/g-solver-verification-20261023/integration-20261024/main-team-runtime/summary.json)。

## 10. 當前接入範圍與延後項

**當前目的是盡快接入一道題，按核心 design v1 的既定多 Agent 設計跑通做題流程。G 的產品目標及角色架構不變。** E §7 已以三道本地 Web 題驗證材料固定、Intake 讀題及 Coordinator 分派；當時解題角色缺少工具，不能動手。現在承接這條鏈路，不重新研究取題，也不新增「先選定一題才可推進 G」的前置。

流程沿用核心 design v1：Intake 交接 → Coordinator 組織既定團隊 → 觀察、假設、實驗並依反饋修正或換路 → Engineer 整理候選與 Verifier 獨立驗證 → Coordinator 根據驗證與可信結果決定後續或結束。Reference、Strategy、Recovery Critic 按既定職責與觸發條件參與；不要求每個簡單動作都重跑全部角色，也不把流程縮成單一 Solver。

### 10.1 當前要接入的部分

以下已定 G 接線在 c323 的實作與主 session 核對已完成（§9.1）；已按使用者授權接入主區（§9.2）；表內契約仍是維護依據。D 前兩接口現已按 D §3–4 接入；後三接口依賴保持未定，不因 G 完成而消失。

| 部分 | 當前工作與完成邊界 | 設計狀態 |
| --- | --- | --- |
| E → 團隊分派、題目綁定（§2） | 沿用 Intake 原生 task 交接；接入 assign／unassign、跨輪宣告、首次綁定及同題會話恢復。身份與題目由宿主固定，Coordinator 負責分派 | 已有可行性證據，按已選契約拆實作 plan，不重做取題研究 |
| 工作區與文件工具（§3） | 接入真實 E materials、本會話 work、本題 published 三根及既有讀寫／搜尋能力；保持角色間 work 分離。E/G 共用分頁已在 c323 驗證（§9.1），已接入主區；不把公共重構擴成獨立前置 | 三根原型已驗；published 寫入仍屬 D，不能把空目錄當成交接完成 |
| HTTP 與受管作業（§4、§5） | 接入已驗工具及 C/RPC 等待、輸出續讀、deadline、取消和資源結算，使既定解題角色能實際操作工具並取得反饋 | 受管工具接線已驗；不由此推定作業 OS／網路隔離成立 |
| 角色能力與使用契約（§6、§7.4） | 按既定角色註冊工具、配置權限及必要使用說明；讓 Coordinator 正確使用宣告、背景分派、結果引用、恢復與停止。沿用核心設計的協作與交付要求 | 不另建 Solver、角色或宿主解題流程；Verifier 普通 HTTP 仍拒絕 |
| 長作業、結果交付與收束（§7） | 接入已選原生背景分派、Solver 工具終態等待、自動父交付、可信 execution 關聯、pending／idle／准入及 task.stop；Coordinator 能依結果繼續、換路或停止 | 聯合無模型驗證已完成；後續是主線接入，不重開同類可行性研究 |
| Engineer／Verifier 及可信結果的直接交接（D 邊界） | G 保存題目、會話、產物及輸出關聯，核對既定團隊交接缺口；必要的產物固定、候選與驗證結果接口由 D 定義，不能以自由文字或私有 work 路徑假裝完成 | 是完整做題流程的直接依賴，不是可選角色；未定契約先回到 D 設計，不在 G 臨時另造發布協議或展開全部 D 能力 |

已確認且有證據的部分可以進入實作計劃；只有當前流程直接依賴的未知接口才繼續設計與必要驗證。章節編號及歷史驗證分組不代表執行順序，不要求等整份 G 定稿才接入，也不再把隔離部署、通用網路及完整配額研究列為下一組必做工作。

接入驗收須在同一次產品入口中串起 E 交接、既定團隊分派、實際工具操作、結果交回與 Coordinator 後續決策；包含聲稱已接通的 Engineer／Verifier 交接。現有分項證據不能拼成整條流程已通過。無模型驗證證明接線與控制，不證明模型自主解題能力；只有候選、獨立驗證及可信完成依據均符合核心 design v1 §1.3 才可稱 solved。

### 10.2 當前延後的工程

| 延後項 | 本輪不展開的工作 | 保留的條件與限制 |
| --- | --- | --- |
| OS 隔離部署（§5.4） | 容器建立／回收者、宿主最小權限部署接口、外部執行服務、多部署及 rootless 相容方案 | 原型機制與同 uid 失敗證據保留；不聲稱產品隔離完成，不將控制憑據或 Docker socket 交給求解程序 |
| 通用作業網路部署（§5.5） | 全協議出口、代理架構、DNS 合法換址、動態 scope 與既有連線撤銷 | 已有受管 HTTP scope 保留；腳本直連限制未完成，不把 HTTP 工具檢查說成所有出口均受控 |
| 持久容量與完整資源計量（§3.3、§5.6） | 持久卷硬配額、累積寫入及 CPU 時間帳本、數值校準與發布環境完善 | 保留已有 timeout、輸出／單次大小、並發、取消、unknown 保額及當次預算記錄；128 MiB 總量與固定 PATH 未完成的結論不變 |
| 跨重啟恢復 | 工作區／帳本自動恢復、存活作業接管與自動重跑 | 中斷後保存已知用量及 unknown，不重建服務清空額度，不假定舊作業已停止 |
| 展示及通用調度 | 完整進度 UI、頻繁進度通知、通用排程或新增監工 Agent | 沿用已選自動交付與必要控制機會，不增加模型輪詢 |

以上是延後工程，不是取消核心 design v1 的運行邊界。當前可先完成文檔、接線與授權的無模型核對；正式運行仍須滿足實際路徑的 scope、憑據與資料邊界。若具體執行被已知隔離缺口阻斷，指出受影響的最小路徑及條件，不以延後名義宣稱安全或啟動不符合邊界的運行，也不自動恢復整套部署研究。

### 10.3 只在具體依賴出現時提回的能力

| 依賴觸發條件 | 屆時的必要工作 | 當前安排 |
| --- | --- | --- |
| 平台提交、啟停／重置、限次操作或連線即計時 | D/E 提供該接入的可信語義、發送前意圖、限次與 unknown 處理；接入前處理 E 的探測副作用 | 通用 adapter schema、跨平台描述與自動對帳／解鎖延後；未知結果不盲目重發 |
| 獨立驗證必須 HTTP 重放 | D 定所需可信驗證模式、候選與依賴版本、請求序列／狀態綁定 | 不開放 Verifier 普通 HTTP 代替；本地重算或 evidence_audit 須實際足以支持結論，否則 inconclusive |
| 題目需要 TCP、PTY、瀏覽器或特殊依賴 | 補該能力及其實際出口邊界 | 延後未用接口、套件與 ARM64 驗證，不增加無關工具清單，不以換題冒充缺口已解決 |

這些項目不是順序研究清單，不重新打開 E 已完成的接入。既有有效結論、失敗證據與尚未驗證的限制均保留；完整 G 尚未定稿。此處只確定文檔範圍，不新增 plan、驗證 session、模型運行或產品實作授權。
