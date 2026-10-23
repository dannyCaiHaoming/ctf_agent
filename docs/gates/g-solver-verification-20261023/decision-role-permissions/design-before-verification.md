# design v1 G 最小版詳細 design：解題角色的工作區、HTTP／作業與題目綁定

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 G 的詳細 design 子文件。本文定義解題角色的題目綁定、工作區、HTTP 與腳本執行能力；細節以本文為準。**部分設計已確認，整體尚未定稿**：長作業完成交回、作業隔離與資源總量仍有未定項（第 10 節）。已選做法寫在正文；驗證條件集中於第 9 節。

本文只定義設計，不構成執行或真實模型調用授權。產品入口接線已在獨立工作區做無模型驗證；主工作區只同步了文檔與證據，產品代碼未合併。

**前提：** [E 最小版詳細 design](2026-10-23-design-v1-e-intake-minimal.md)（下稱 E design）已定題目材料的固定與 Intake 的唯讀接入（`workspace/<id>/materials/`）；[C 詳細 design](2026-10-23-design-v1-c-control-service.md)（下稱 C design）已定控制服務、會話綁定、分派登記與逐次准入。本文沿用這些機制，只補解題角色需要的能力與題目範圍。

**用詞：** 「宿主」指啟動器與其進程內的控制服務（design v1 1.2）；「解題會話」指經分派綁定到某題的 `recon`、`domain-solver`、`engineer`、`verifier` 會話（下稱解題角色）；「作業」指經受管工具啟動的一次本地程序執行。

---

## 1. 範圍

**做：**

- 題目綁定：Coordinator 分派解題角色前先宣告題目，宿主在綁定時把會話與題目固定（第 2 節）；
- 工作區：列出、讀取、寫入、搜尋本題的材料、本會話工作目錄與已發布產物（第 3 節）；
- HTTP：經控制服務發出的受控請求，限授權目標（第 4 節）；
- 作業：在受控環境執行腳本，回傳句柄、可續讀輸出、取消（第 5 節）。

**不做：**

| 延後項 | 待何時 | 首版替代 |
| --- | --- | --- |
| PTY、TCP 連線與 stdin 互動 | 出現需要持續互動的題目時（design v1 G 的 PTY/TCP 列） | 作業 stdin 固定為空；需互動的題目不在本切片 |
| 瀏覽器 | 瀏覽器接口與 ARM64 依賴定稿後 | 無 |
| 產物發布、候選登記、驗證結果登記 | D | `published/` 目錄預留，只由宿主寫入，本文不定寫入方式 |
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
- task 登記前拒絕不消費宣告；登記成功後宣告已消費。task 若在子會話綁定前失敗，C 於父會話下一次准入清理未消費的待綁定分派；不自動恢復宣告，Coordinator 須重新 assign。已綁定會話保留原題目。
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

每題的工作區位於運行資料目錄的 `workspace/<challenge-id>/` 之下（E design 第 3 節）：

| 目錄 | 寫入者 | 解題角色的權限 | 說明 |
| --- | --- | --- | --- |
| `materials/` | 宿主（E design 第 3 節，唯讀） | 讀 | 題面與附件，逐字節固定 |
| `work/` | 宿主建立；綁定的會話寫入 | 讀寫 | 只屬於綁定它的會話；目錄名不含會話 ID，對模型以 `work/` 呈現 |
| `published/` | 宿主（待 D 定義寫入方式） | 讀 | 已發布產物；G 只預留目錄與讀取權限 |
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

單題工作區寫入總量預設上限 128 MiB，超過時 `workspace.write` 拒絕並說明。數值是預設提案，首次真實運行前須確認。

### 3.4 唯讀的實際邊界

受管工具不提供寫入 `materials/` 的路徑，這是工具層的邊界。然而作業以程序形式運行（第 5 節），若與宿主同一 OS 用戶，程序可以直接寫入或改權限。因此產品運行時，**必須有 OS 隔離，使作業對 `materials/`、`published/`、控制服務的狀態目錄與其他題目的目錄沒有寫權限**；同題會話間也要隔離。具體採用不同 uid 或獨立執行環境仍未定（第 5.4 節）。開發機單用戶運行時無法滿足此條件，本文不把開發機結果當作唯讀證明。

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

每題一個 cookie jar，由控制服務持有（不寫入工作區）。`Set-Cookie` 寫入 jar，之後同 origin 的請求自動帶上（路徑以前綴匹配，不實作完整的 domain 規則）。同題的所有解題會話共用一個 jar，使 Recon 登入後的狀態可被 Solver 使用；Verifier 的獨立性不靠 jar 隔離，而是由 D 的驗證模式決定是否重放（D 的範圍）。jar 不跨題、不回傳模型。

### 4.4 併發與取消

每題同時進行中的 HTTP 請求上限暫取 8，由 C 按 challengeId 登記，同題會話共用、跨題容量獨立。完成或確認取消後釋放；unknown 不歸還名額。run／session 停止按第 7 節取消歸屬請求。配額機制已驗證，數值仍是預設提案。

---

## 5. 作業（腳本執行）

### 5.1 為何用受管作業，而非原生 `bash`

**採用受管 `job.run`，原生 bash 維持拒絕。** 原生 bash 繼承 OpenCode 的 provider／RPC 環境；已查的 plugin 1.19.0 公開接口不能同時限定工作目錄與 uid。受管作業讓宿主固定工作目錄、環境和程序組，不把控制憑據交給腳本。這個選擇不等於已完成 OS 隔離，隔離方案仍須按第 5.4 節驗證。公開接口判斷的範圍見第 9 節 G-V2。

### 5.2 工具

`job.run`、`job.read`、`job.cancel`（`ctf_job_run` 等），授予 `recon`、`domain-solver`、`engineer`、`verifier`（`verifier` 僅限本地重算，見第 6 節）。

| 工具 | 參數 | 回傳 |
| --- | --- | --- |
| `job.run` | `argv`（1–32 項，每項 ≤ 4 KiB，無 `\0`）、`timeout_ms`（預設 60000，上限 600000）、`wait_ms`（預設 5000，上限 30000） | `job`（UUID 句柄）、`state`；若在 `wait_ms` 內結束則直接給出退出碼 |
| `job.read` | `job`、`stream`（`stdout` 或 `stderr`）、`cursor`（字節偏移，可省） | 最多 32 KiB 的一頁、`nextCursor`、`state`、`exitCode`、`signal`、`done` |
| `job.cancel` | `job` | 最終 `state` |

`argv` 不經 shell 解釋；需要 shell 語法時，由模型明確寫 `["sh", "-c", ...]`，同樣受本節所有限制。

**狀態：** `running`、`exited`、`timed_out`、`cancelled`、`failed_to_start`。`job.read` 以 base64 回傳輸出 bytes；句柄只屬於啟動它的會話和題目。

**本接口尚未完成長作業設計：** 超過 wait_ms 時只交付 running 句柄，不能自動把最終結果交回原等待任務。這是現有契約的缺口，不是要求模型輪詢的設計決定；待選方案見第 7.2.1 節。

### 5.3 執行環境

| 項目 | 規則 |
| --- | --- |
| 工作目錄 | 綁定會話的 `work/` |
| 環境變數 | 固定白名單：`PATH`（鏡像固定值）、`HOME` 與 `TMPDIR`（指向 `work/`）、`LANG=C.UTF-8`、`CTF_WORK`、`CTF_MATERIALS`、`CTF_PUBLISHED`（三者為真實路徑，只給作業，不進工具回傳）。其餘變數一律不傳，尤其不傳任何 provider、RPC、平台憑據 |
| 標準輸入 | 連到 `/dev/null` |
| 程序組 | 每個作業獨立程序組；超時或取消時先送 `SIGTERM` 給整組，2 秒後 `SIGKILL` |
| 輸出 | stdout、stderr 各自寫入 `jobs/<會話 ID>/<作業 ID>/`，每流上限 1 MiB，超出後丟棄並標 `truncated`；由 `job.read` 續讀 |
| 安裝依賴 | 不提供。作業只運行鏡像預裝的解譯器與工具；缺少時 `failed_to_start` 並說明，不臨時下載（design v1 1.5） |

### 5.4 OS 層隔離（產品運行的前提）

**必須滿足的邊界：** 作業不能讀取控制狀態、provider／RPC 憑據、oracle 私有資料及其他題目材料；不能讀寫其他會話的私有 work 或讀其進程環境／記憶體、向其發信號；本題 materials／published 可讀不可修改；只有本會話 work 可寫。宿主仍須能發布、保存輸出及取消整個作業。獨立工作區與 Verifier 邊界不因實作困難而放寬。

**候選方案（均未驗證，不視為已選定）：**

- (a) 宿主與作業不同 uid，且每會話使用不同作業 uid；每題唯讀群組提供 materials／published 訪問，私有 work 只授予該會話。實測必須同時核實目錄遍歷權限、檔案所有者／群組、進程訪問和宿主回收；不能只檢查環境白名單。
- (b) 每會話受隔離的執行環境，只暴露本題唯讀 materials／published 與本會話可寫 work，隔離其他會話進程與宿主控制資料；由宿主控制啟動及取消，不向作業暴露 Docker socket。具體公開運行機制在 G-V6 核實，不預設平台可用。

G-V6 先檢查 (a) 的能力與權限需求；不能滿足全部邊界時評估 (b)，仍不能滿足則記錄產品作業隔離阻塞，不以「單一 ctfjob 用戶、記為限制」替代。選擇必須兼容總設計的非 root 產品運行；若依賴額外權限，須明確列出並先解決架構衝突，不能默認授予特權。

**成立條件：** 在 ARM64 產品執行環境，同時證明本題材料可讀、本會話 work 可寫、宿主能發布與回收，以及跨題／跨會話文件、進程和控制資料不可訪問；唯讀文件在拒寫後內容不變，CPU／記憶體限制實際觸發。使用非秘密哨兵並記錄 uid／gid、掛載與權限，不能以所有操作都不可用、環境白名單或特權運行代替隔離成立。

舊「單一作業用戶＋每題群組」只能回答部分宿主／跨題隔離，不能證明同題會話隔離。未找到可核對的 G-V6 報告，本節仍未驗證；handoff 的「已在 ARM64 驗證」不作依據。CPU／記憶體限制仍以 `prlimit` 或等效方式在同一環境驗證；網路隔離另見第 5.5 節。

### 5.5 網路限制（明確不宣稱）

作業可以直接以 `curl`、`nc`、Python socket 等訪問網路，這些路徑不經過 `http.request` 的 origin 核實。在 design v1 第 3 節的網路隔離方案定稿並實測之前：

- **只有 `http.request` 的 scope 核實成立**；
- **作業的網路訪問不被宣稱受 scope 限制**，`engineer` 獲授予作業但 H 中「默認無目標網路」一項在首版不能被強制；
- 不得把作業的結果寫成「已遵守 scope」。

這是本文最大的已知缺口，不能靠 Agent 指令補上。

### 5.6 限制與計量

| 項目 | 預設提案 |
| --- | --- |
| 每會話同時運行作業 | 2 |
| 每題同時運行作業 | 8 |
| 超過上限 | 拒絕並說明，不排隊 |

作業與 HTTP 不計入模型調用准入（design v1 1.4：工具資源與模型成本分開）；其時間與次數的 run 級總上限本文不定，列為第 10 節待定。

**啟動與結算：** 先登記操作並準備 stdout／stderr 文件，再啟動程序；文件準備失敗不得留下已啟動但未登記的進程。返回 job 句柄不釋放槽位，必須等程序組與輸出完成結算；回收不完整時保留 `reapIncomplete`／unknown 及配額。正常退出也要回收殘留程序組。驗證依據見第 9 節 G-V5 及 C／RPC。

---

## 6. 角色能力（H 落地增量）

在 C design 第 5 節的能力表上增列以下各項；兩層約束（`opencode.json` 的可見性與控制服務的執行許可）同時適用。

| 角色 | 本文新增 | 不授予 |
| --- | --- | --- |
| `coordinator` | `challenge.assign`、`challenge.unassign` | 工作區、HTTP、作業 |
| `recon` | `workspace.*`（讀三根，寫 `work/`）、`http.request`、`job.*` | 寫 `materials/`、`published/` |
| `domain-solver` | 同 `recon` | 同 `recon` |
| `engineer` | `workspace.*`、`job.*`（作業的網路未受限，見第 5.5 節） | `http.request`（H：默認無目標網路） |
| `verifier` | `workspace.list`、`workspace.read`、`workspace.search`、`workspace.write`（僅 `work/`）、`job.*`（本地重算） | `http.request`；`published/` 之外的他會話工作區。安全重放的 HTTP 能力待 D 的驗證模式決定 |
| `intake` | 無新增 | 工作區寫入：H 表原列「必要工作區寫入」，本文不授予，因 E design 的 Intake 只需唯讀接入。若 D 或實測證明需要寫入，再修訂 H 表 |
| 其餘 | 無 | 無 |

`verifier` 的 `workspace.write` 僅為本地重算的中間文件；不得改寫他會話的產物（D 的範圍）。

### 6.1 本項待驗候選與判據（角色權限）

本項只比較以下做法，不接線 D 的候選／結果登記，也不擴大原型工具權限。

| 候選 | 要回答的問題 | 結果去向 |
| --- | --- | --- |
| A：維持 Intake 唯讀、Verifier 私有 work 本地重算 | E prepareRun 已固定題面及材料，Intake 是否可列題、讀取並經 task 返回而不寫文件；Verifier 的受管工具是否只映射本會話 work，拒絕材料／published／他會話寫入及普通 HTTP | 流程成立則不增加權限，H／C 的廣義能力表對齊本最小範圍；失敗只修具體缺口 |
| B：給 Intake 一般 workspace.write 或給 Verifier 一般 http.request | 是否存在 A 無法完成的既定操作；是否會把整理／重放權限擴成任意實驗 | 沒有具體缺口就不採用；D 尚未定義的重放不能成為擴權依據 |
| C：D 可信模式按次發放最小 HTTP 重放能力（未定、測試側候選） | 可信主體把候選／依賴版本、會話、題目 scope、固定請求序列與安全性判定綁定；新 jar 重建可重放狀態，保留請求／回應 hash；一次性、限次、未知副作用或舊連線依賴不執行重放，轉 evidence_audit；意圖先消耗，未知結果不重送 | 本地 fixture 只判接口可表達及拒絕行為，不證明一般端點可安全分類；D 定稿前不授予產品權限 |

獨立 cookie jar 與克隆 Solver jar 是兩個待比較方式。前者可重新取得可重放登入狀態，後者引入原連線／會話狀態依賴，不能僅靠「同題」推定安全；fixture 不能決定所有題目的選擇。HTTP 動詞不作安全判據，未知／限次 GET 也須拒絕。

須同時檢查受管接口與 job 的實際邊界：現原型 job 未有 OS／網路隔離，若腳本能直接連線或越出 work，應記為已復現的限制並保留 §5.4／5.5 依賴，不能因工具可見性與路徑測試通過宣稱 Verifier 已被限制為本地重算。隔離修補不在本項。

---

## 7. 控制服務、停止與長作業

### 7.1 停止與資源歸屬

停止先改綁定狀態並拒絕新操作，再回收資源。run 停止取消全部 HTTP／job；單一會話撤銷只取消該會話的資源。到期或撤銷後，已有句柄的調用也拒絕；已保存輸出保留。

HTTP／job 由 run、session、call 關聯，job 在初始等待返回後仍留在登記表。只有完成結算才能釋放配額；回收失敗或超時記 unknown，不報「已清空」。控制服務重啟不恢復舊句柄，保留輸出並標為不可續；按 design v1 1.4 停止舊作業再重建，重啟後回收尚未驗證。

單會話撤銷目前有宿主方法，給 Coordinator 的產品停止工具尚未定義；不把宿主測試調用視為該工具已存在。

### 7.2 慢工具的執行方式

**採「短暫串行登記，隊列外等待」。** C 的身份／有效性復核、准入扣次、分派和資源登記序列化；SDK、文件、DNS、HTTP 和 job 等待在隊列外。理由是卡住一個工具不能阻塞其他會話的准入或停止。任何異步準備返回後，都須在登記／啟動前再次核實停止、撤銷與到期。

執行次序：

1. 插件的公開 before hook 將 session、call 和參數交 C 核准。ToolContext 公開類型沒有 callID，採用 before 的 output.args 私有 Symbol 把可信 callID 和核准時限帶到 execute，單次消費，不加入模型 schema／JSON。
2. C 在啟動資源前登記 `{run, sessionID, callID}`、取消信號及 deadline；適配器只接收宿主提供的操作上下文。
3. 等待型 RPC 時限為宿主核准的 `min(工具等待上限, 綁定剩餘時間) + 5 秒`。HTTP 用 timeout_ms，job.run 用 wait_ms；普通 hook 維持 15 秒。傳輸收尾餘量不能延長工具執行。
4. 客戶端在 response 尚未 writableFinished 前放棄，取消該操作；job 已產生句柄但響應未完成時也保留取消監聽。正常 response finish 後仍運行的 job 由 job.cancel／session／run／deadline 管理。finish 不等於客戶端應用收到句柄，交付未知不自動重發。
5. 結算時保存結果類別及資源狀態，再釋放名額。C 的資源收尾暫取 4000ms，逾時保留 unknown；HTTP 和程序組的收尾限制分別見第 4.2.1、5.3 節。

Symbol 關聯已在 OpenCode 1.19.3／plugin 1.19.0 驗證，包括同會話同工具並發；若升級後不再保留關聯，必須拒絕並重新驗證，不能按 session/tool 猜測。數值的產品適用性仍見第 10 節。

### 7.2.1 長作業完成交回：尚未選定

**要解決的問題：** 作業超過初始 wait_ms 後，仍須把最終結果交回原等待任務，等待期間不依賴模型反覆查詢。輸出可增量讀取、作業可取消，不能代替完成交回。

| 做法 | 已知結果 | 設計去向 |
| --- | --- | --- |
| 同一次工具 execute 有界等待 | 真實產品入口已驗證 16 秒等待；作業在自己的 wait_ms 內結束可直接返回 | 保留此能力，但不足以處理超過 wait_ms 的作業 |
| 完成後經公開 promptAsync 恢復同一 child | 探針能恢復原 child、按 messageID 去重並在取消後抑制通知；但原父 task 已完成，恢復不更新其返回結果 | 不能單獨採作「原等待任務完成交回」方案 |
| 調整工具的等待契約 | 尚未設計／驗證；需確定等待上限與現有 wait_ms、deadline 的關係 | 候選，未採用 |
| 明確父子任務的完成通知／恢復協議 | 尚未設計／驗證；需確定原任務完成狀態、結果接收者、取消及重複通知語義 | 候選，未採用 |

**成立條件：** 真實作業超過初始 wait_ms 後，最終結果仍關聯原 session／call／job 並交回原等待任務；完成、取消、到期、重複通知和斷開競態不得重複啟動或錯誤交回，unknown 保留登記與配額。驗證須使用公開 OpenCode 接口及真實產品入口，分開記錄可控邊界測試與 runtime；以請求／事件順序證明等待期間沒有模型輪詢，不自建 provider 循環。其餘時限、非阻塞及停止邊界沿用第 7.1–7.2 節。

**當前決定：長作業判據仍未通過，G 不定稿。** 第 5.2 節的現有契約保留，不擅自延長 wait_ms 或增加 job.wait；也不把恢復 child 稱為原 task 已交付。下一個設計工作是比較上表兩個未定方向並選擇可驗證做法，而不是再驗一遍已通過的 HTTP／停止鏈路。未穷盡其他公開接口組合，不推論 OpenCode 整體不支持。實測條件與原始證據見第 9 節。

### 7.3 審計

每筆 tool.execute 記 tool、callID 與結果類別；資源登記／結算記 run、session、題目、job 句柄、deadline 和狀態；RPC 放棄記原 session/call/job。控制審計不記 HTTP body 或作業輸出正文，只記必要大小、hash 與狀態；正文保存在對應輸出文件。

### 7.4 插件清單

產品插件註冊本設計的 challenge.assign／unassign、workspace 四工具、http.request、job.run／read／cancel，launcher 傳入工具清單並按第 6 節設角色權限。模型可見性與 C 執行核准兩層都保留。

移除已退場的 workspace.patch、workspace.unpack、observation.read、hypothesis.propose／conclude。candidate.register 屬 D，G 不註冊。接線在獨立工作區已驗證，主線尚未整合。

---

## 8. 實作邊界與目前位置

| 責任 | 實作位置 | 目前狀態 |
| --- | --- | --- |
| 題目宣告、綁定、資源登記、配額與停止 | apps/launcher/src/control-service.ts | 獨立工作區已接線並驗證 |
| 三根文件、HTTP、受管作業 | apps/launcher/src/workspace-tools.ts、http-tools.ts、job-tools.ts | 原型與產品入口已驗證；隔離及缺口不能由此推定成立 |
| RPC 信號與等待、工具參數及角色可見性 | control-rpc.ts、apps/opencode-plugin、launch.ts、product/opencode/opencode.json | 獨立工作區已接線並驗證 |
| E/G 共用讀取實作 | intake-tools.ts 與 workspace-tools.ts | 仍須避免兩套讀取語義分叉，尚未驗證共用 |
| 產物發布、候選、獨立驗證與 oracle | D 的責任 | 本文不接線，不作 G 通過條件 |

上述代碼位於未合併的獨立工作區；主工作區只有文檔與證據同步。不是在主線上再實作一套同樣的原型。可行性已確認的部分，以正文契約作後續實作依據；未定部分先解決設計問題，不能由實作者自行選定。本文不安排整合或新一輪運行。

## 9. 設計依據與驗證範圍

以下記錄支撐正文決定的結論，不作執行日誌。驗證日期均為 2026-10-23；runtime 使用 OpenCode 1.19.3、SDK/plugin 1.19.0 和 loopback 確定性替身 provider，沒有真實模型請求。各批獨立保存，不拼接為同一次通過。

| 驗證 | 結論及其限制 | 證據 |
| --- | --- | --- |
| G-V1 跨輪宣告與分派 | execute 生效、跨輪保留、task 消費、恢復及失敗清理成立。T1–T9 確定性 14 項；runtime 覆蓋 T1/T5/T7/T8，T7/T8 為 RPC 邊界注入，其他項不冒稱 runtime 通過。舊同輪預檢生效／下輪刪宣告規則不採用 | [跨輪報告](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md) |
| G-V2 原生 shell | plugin 公開類型沒有可同時限定 cwd、uid 的接口，因此維持受管 job；僅類型檢查，未驗 shell.env 運行時合併／清除或所有權限配置可能性 | [原生 shell 檢查](../../gates/g-solver-verification-20261023/G-V2-native-shell.md) |
| G-V3 三根映射 | 真實 E prepareRun、同題雙會話正向讀寫及唯讀／路徑拒絕成立，定向 10/10，含舊九項。0444 只防誤寫；128MiB、OS 隔離、並發路徑替換和共用讀取不由此證明 | [三根報告](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md) |
| G-V4 HTTP | 舊 scope／cookie／header／截斷／代理／自簽 TLS 九項保留；全程 deadline／取消補驗 20/20。實際 socket 固定 A、DNS 後變 B 仍零連線；持久化阻塞保留 unknown。該批 HostBoundary 無 challengeId，不能證明每題配額 | [HTTP 生命週期報告](../../gates/g-solver-verification-20261023/g-v4-http-lifecycle/REPORT.md) |
| G-V5 作業 | 舊九項證明環境白名單、空 stdin、輸出分頁／截斷、啟動失敗、句柄與併發規則；只殺 leader 的變異使孫程序回收測試失敗。原型不證明 OS 隔離；會話／run／到期及 unknown 補驗由下一行支持 | 舊完整報告缺失，舊結論與來源保留於[整理前記錄](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/design-before-editorial-rewrite.md)；補驗見下一行 |
| C／RPC 真實產品接線 | 同一次 runtime/accepted 完成綁定→材料讀→同輪雙寫→HTTP 16004ms→job 增量讀／16054ms 等待→停止；12 次替身請求對應 12 次准入，9 個資源結算。確定性邊界另驗短隊列、每題配額、放棄／交付競態、session/run/expiry、孫進程與 unknown。全套 291/291、typecheck/build，主會話獨立 46/46；不稱每個競態都有 runtime 覆蓋 | [C／RPC 報告](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/REPORT.md) |
| 長作業公開完成／恢復候選 | 測試側觀察真實 job 結算後調公開接口；同 child 恢復、去重與取消對照成立，但父 task 已結束、輸出不變。候選不足，未通過完成交回。這是測試通知器，不是產品已具備自動通知 | [恢復結果](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/completion-probe/first/resume-and-duplicate/result.json)、[取消對照](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/completion-probe/first/cancel/result.json) |
| G-V6／G-V7 | OS 隔離未驗；真實模型工具使用未運行 | 不能由確定性工具測試推定成立 |

C／RPC 代碼基線為 d83a0c3024271dbf212db319e900fcf527e68b0f 加獨立工作區未提交修改，Node v26.3.0、Vitest 2.1.8；來源、配置及最終 hash 見該報告目錄。公開恢復探針與 runtime/accepted 是不同運行。

**影響設計的失敗均保留：** 跨輪宣告被提前清理、共同根接口不符真實佈局、DNS 超時後仍連線、落盤／目錄準備阻塞收尾、先 spawn 再開輸出文件導致未登記進程，以及首次准入前未建目錄。各報告保留修正前後的證據和測試 fixture 失敗；舊 V3–V5 完整報告未找到，不補造。舊敘述及詳細執行記錄保存在整理前快照，不作當前設計規則。

## 10. 未定稿項

| 要決定的問題 | 已知約束／候選 | 尚需完成的設計工作 |
| --- | --- | --- |
| 長作業完成如何交回原等待任務 | 現有 wait_ms 契約與直接恢復 child 都不足；第 7.2.1 節兩個方向未選定 | 定義等待與完成交回語義，選擇公開接口做法，再驗取消、去重與同一任務交回 |
| 宿主、跨題及同題會話 OS 隔離 | 第 5.4 節的每會話 uid 或獨立執行環境；兼容非 root 產品運行 | 驗證候選的文件、進程、憑據隔離與 CPU／記憶體限制；都不成立則記產品阻塞 |
| 作業網路 scope | 腳本繞過 http.request；不能靠角色 prompt 限制 | 比較按題／會話的網路命名空間與預設拒絕出口、受管代理出口兩種候選；腳本直接 TCP／UDP／IPv6 與 DNS 不能繞過。候選未選定，不能宣稱現有作業已受限 |
| 配額與數值預設 | 128MiB 寫入總量未實作；HTTP／job 併發及收尾數值僅按所列值驗證 | 比較宿主統一帳本與 OS 資源配額的責任分工，驗證並發記帳及直接作業寫入邊界；數值可行性與產品適用性分開，鏡像固定 PATH 依 F 定稿 |
| 受保護的目標操作 | G 不辨識端點的重置、計時、限次語義 | 比較沿用 D／E 可信操作描述與 G 新增端點分類的必要性；不得用 HTTP 方法或模型自述推定副作用，未知結果不自動重試 |
| Intake 寫入及 Verifier HTTP | 本文不給 Intake 寫入；Verifier 只做本地重算，HTTP 重放依 D | 比較維持 Intake 唯讀／Verifier 本地重算與按 D 驗證模式增加最小權限；只因具體能力缺口才改 H，不默認擴權 |
| Coordinator 的停止入口 | 宿主 revoke 已驗，產品停止工具未定 | 比較 Coordinator 受管停止工具與公開原生任務控制；宿主核實直接分派關係，不讓模型指定任意會話，不用宿主測試冒稱完成 |

G 的下一個待解設計問題是長作業完成交回；不是缺一次全套測試。OS／網路隔離另有各自的能力前提。這些事項未解決前，只能使用已驗證部分的有限結論，不能宣布 G 定稿或具備完整自主解題能力。
