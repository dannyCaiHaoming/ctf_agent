# design v1 G 最小版詳細 design：解題角色的工作區、HTTP／作業與題目綁定

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 2 節 G 的詳細 design 子文件，**最小版**：解題角色（Target Recon、Domain Solver、Solution Engineer、Verifier）能在自己的題目工作區讀寫文件、經受控 HTTP 訪問授權目標、在受控環境執行腳本，且其會話綁定到單一題目。**本文是部分驗證的設計草案**：G-V1 修訂後的跨輪協議已以控制服務原型及 OpenCode 1.19.3 替身 runtime 驗證（第 2.1、9 節），正式產品接線另見本輪 §7.2.1；G-V2 保留維持受管作業的判斷，G-V3 三根映射原型已完成真实 E prepareRun 双会话补验及旧九项回归（定向 10/10，见第 3、9 节），G-V4 已完成 HTTP 适配器生命周期补验（当时为宿主边界替身；本轮真实 C／RPC 接线结果见 §7.2.1）；G-V5 保留既有局部原型結果（2026-10-23，見各章與第 9 節）；G-V6、G-V7 未做，產品級隔離與真實模型使用不得宣稱成立。本文只定義設計，不構成執行授權，也不授權任何真實模型調用。

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

design v1 第 3 節待決項：原生 `task` 的待綁定分派只按「父會話 + 角色」匹配，不帶題目。候選有兩項：

- **甲（G-V1 修訂協議原型驗證通過，正式接線另驗）**：Coordinator 在 `task` 之前經受管工具 `challenge.assign` 宣告「下一個 `<角色>` 負責題目 `<id>`」。控制服務在該工具實際執行時核實題目屬本 run、角色可接受題目範圍後寫入宣告；子會話綁定時把宣告掛在的待綁定分派上取出題目。選題仍是 Agent 決策，宿主只核實與固定。生效點的結論見第 2.1 節。
- **乙（否決）**：從 `task` 的自由文字 `prompt` 解析題目。模型可以在文字中寫入任何題號，解析結果不可靠，也無法區分「描述」與「指派」。

採甲的理由：它只在 C design 既有的「同父、同角色一筆待綁定分派」規則上增加一個欄位，不改變 `task` 參數，也不增加第二條分派循環。

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

**宣告、失敗與恢復的語義（G-V1 修訂原型已驗證，條件見下）：**

- 一個父會話／角色只有一筆宣告；重複宣告（含同題）拒絕且原記錄不變。需要放棄或換題時，Coordinator 調用 `challenge.unassign(role)` 清除未消費宣告，無宣告時冪等成功；已有待綁定分派時拒絕，不能撤回在途 task。插件 id 為 `ctf_challenge_unassign`，只接受上述四個解題角色，返回 `{cleared: boolean}`。
- 正常順序是 `assign` 成功返回 → 下一輪 `task`。同輪 task 若先於宣告完成，明確拒絕且不建立分派；宣告稍後成功仍保留，下一輪可重試 task。已完成的宣告可以被同輪 task 消費，但不要求此順序成立。
- task 登記前拒絕不消費宣告；登記成功後宣告已消費。task 若在子會話綁定前失敗，C 於父會話下一次准入清理未消費的待綁定分派；不自動恢復宣告，Coordinator 須重新 assign。已綁定會話保留原題目。
- 恢復既有 `task_id`：無宣告時按 C 核實並恢復；同題宣告在恢復核准時消費，不建立新 pending；異題宣告拒絕且保留，不改既有會話。核實失敗不改任何記錄。

**G-V1 歷史觀察（2026-10-23，OpenCode 1.19.3、替身 provider、真實模型 token 0）：** 舊方案在 `tool.execute` 寫宣告時，同輪 task.before 先到而拒絕；改成 assign.before 寫入後，特定同輪順序 T1 3/3、T4 1/1、T5 1/1、T7 通過，子會話綁定早於首次准入。這些觀察保留，但**不代表跨輪協議成立**：舊 T4 把正常下一輪分派所需宣告刪除，舊「候選 B 通過」不能作為本節修訂方案通過的依據。原先「execute 生效不成立」僅限同輪探針，不否定等待 assign 返回後再分派。

歷史證據原件仍在未合併工作區 `.claude/worktrees/e-intake-tools-0168da/docs/gates/g-solver-verification-20261023/REPORT.md` 及其 `evidence/`；本輪獨立工作區已按 hash 保留副本，未改寫原件。

**G-V1 修訂協議結果（2026-10-23，獨立工作區，OpenCode 1.19.3、SDK/plugin 1.19.0、Node v26.3.0）：通過本切片。** 宣告在 execute 生效、跨父會話准入保留，task 登記原子消費，恢復不建 pending，同題消費／異題保留，失敗後只清 pending，停止後不新增有效狀態。T1–T9 的 14 項可控 Promise／SDK 替身用例通過；真實 OpenCode＋loopback 確定性替身完成 T1、T5、T7 early/late、T8 登記前/後失敗。子綁定早於首次准入及替身請求，每次請求快照可對應同一 session、題目與准入。T7/T8 是 RPC 邊界可控屏障／錯誤注入，不宣稱任意 native 內部故障或同輪 hook 天然有序。到期狀態在有效性檢查時惰性清除；到期後訪問全部拒絕。

真實模型 token 預算與消耗均為 0；只有 stub provider 可選，臨時 HOME/XDG 與白名單環境，不讀真實 key，未做 OS 抓包。T5 首次因沿用 12 次替身准入上限而失敗，完整保留；修正為腳本長度+10後，原腳本／斷言在 T5-2 一次 runtime 完整通過，不拼接前次成功。全套 237/237、typecheck/build 與探針類型檢查通過。T2/T3/T4/T6/T9 未做 runtime，僅有確定性回歸。報告、原始事件、失敗及版本／配置：[G-V1 跨輪證據](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md)。

上述 G-V1 批次结束时：原型實作仍在 `/Users/caihaoming/.codex/worktrees/g-v1-cross-round/pentest-agent`（基線 `d83a0c3024271dbf212db319e900fcf527e68b0f`，未提交）；已核對的結論與 cross-round-v1 證據已同步回主工作區；本次同步不帶入原型代碼，也不代表主線已具備 G 綁定能力。產品插件用 scratch 註冊 assign/unassign、產品 hooks 轉發，**正式產品插件／launcher G 接線與綁定時建立工作目錄仍未驗證**，不由本次協議通過推定。

### 2.2 分派與綁定

對 C design 第 3 節的改動：

1. **分派登記（`task` 的 `tool.execute.before`）**：若被分派角色是解題角色，必須存在該父會話與角色的宣告。登記的待綁定分派附帶題目 id，並消費該宣告。沒有宣告時拒絕（理由寫入審計，回覆固定短碼）。
2. **首次綁定**：子會話綁定時，綁定內容多出 `challengeId`（來自待綁定分派；run 範圍角色為空）與工作目錄（第 3.1 節）。宿主在綁定時建立該目錄，早於子會話第一次模型請求。
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

**宿主到工具的根目錄接口（G-V3 原型补验通过，正式接线另验）：** `WorkspaceRoots = { materialsDir, workDir, publishedDir }`。`materialsDir` 直接使用 E 的 `PreparedChallenge.materialsDir`；`workDir` 是已綁定會話的實際目錄；`publishedDir` 是本題宿主發布目錄。每項由宿主解析，不能由模型傳入。工具先把虛擬首段映射到對應根，再在該根內核實餘下路徑。不能把共同父目錄當作模型的 `work/`，不能靠符號連結拼接三根（第 3.2 節禁止符號連結）。目錄由宿主在首次綁定時準備；`published/` 未有產物時為空，發布仍屬 D。

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

**G-V3 历史单根原型结论（2026-10-23，確定性測試，9/9 通過，`npm run typecheck` 退出 0）：当时单根原型測試佈局下的路徑過濾成立，当时尚未驗證真實三根映射；本轮补验见下一段。** 覆蓋：`..`、`./x`、空段、絕對路徑、反斜線、`\0`、首段非三根均拒（讀寫皆然）；路徑中段或末段為符號連結一律拒，即使目標在根內；指向根外的符號連結在讀、列、寫均拒且外部文件不變；寫 `materials/`、`published/` 拒且內容與 sha256 不變；分頁不切斷 UTF-8、續讀游標落在續接字節時拒；`search` 字面匹配（`.*` 不匹配）；501 條目錄列 500 並標 `truncated`；逾 1 MiB 寫入拒且不留目標或 `.tmp`。測試含正向對照，拒絕不會因調用必失敗而假性通過；停用 origin／規則後對應判據會失敗（變異檢查）。保留與缺口：第 3.3 節的 128 MiB 單題配額**未實作**（不在九條判據內，仍為提案）；第 5 項的 `0444` 只驗證測試 fixture，不證明模組強制權限（實際唯讀邊界見第 3.4 節，依 G-V6）；`realpath` 容器檢查因 `lstat` 逐段攔符號連結而實際不可達，作縱深防禦保留，未單獨測試。当时旧原型 `apps/launcher/src/workspace-tools.ts` 只接受共同根目錄，與第 3.1 節的真實佈局不相容；本轮补验原型已改用 `WorkspaceRoots`，正式接线另验，由宿主綁定，不向模型增加會話／角色參數。證據：分支 `claude/g-v3-workspace-tools-32ad90`（未合併）。

**G-V3 三根补验（2026-10-23）：** 在独立 managed worktree、HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f` 上将原型改为 `WorkspaceRoots`，使用真实 E `prepareRun` 材料及两个同题 work，共享 published；两会话正向读写、四工具路径拒绝、只读文件 hash 不变、list/search 不泄露另一 work 均通过。旧九项回归布局保留，最终定向 10/10，typecheck/build/全套 233/233 通过（Node 与依赖实际版本见证据）。保留共同根接口失败及根目录 list 误拒失败。历史完整 G-V3 报告未找到，不补造旧执行结果；本轮新证据在 [g-v3-three-roots/REPORT.md](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md)。G-V3 結論與必要證據已經主會話核對並同步回主工作區；原型代碼仍只在獨立工作區，未正式接線。128MiB 配额、OS 隔离、并发路径替换、绑定自动建目录、E/G 共用读取未验证，0444 只防误写。

### 3.3 配額

單題工作區寫入總量預設上限 128 MiB，超過時 `workspace.write` 拒絕並說明。數值是預設提案，首次真實運行前須確認。

### 3.4 唯讀的實際邊界

受管工具不提供寫入 `materials/` 的路徑，這是工具層的邊界。然而作業以程序形式運行（第 5 節），若與宿主同一 OS 用戶，程序可以直接寫入或改權限。因此產品運行時，**作業必須以獨立 OS 用戶運行，且該用戶對 `materials/`、`published/`、控制服務的狀態目錄與其他題目的目錄沒有寫權限**（第 5.4 節）。開發機單用戶運行時無法滿足此條件，本文不把開發機結果當作唯讀證明。

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
- **TLS：** 授權 origin 的自簽憑證視為可接受，僅對該 origin 放寬；其他 origin 不存在此例外。這是 CTF 靶場的常見情況，屬本文提案，須在第 9 節 G-V4 中記錄為明確選擇。
- **代理：** 忽略環境中的代理設定，避免請求經未核實的路徑出去。
- **憑據：** 工具不注入任何平台或 provider 憑據；`Authorization` 只能來自模型自己提供的頭。

**G-V4 历史局部结论（以下只描述旧原型，不作当前缺口状态；2026-10-23，確定性測試，9/9 通過，`npm run typecheck` 退出 0；授權與越界兩個本地 `node:http`／`node:https` 服務，越界服務記連線數）：原型所覆蓋的 origin／重定向／cookie 檢查成立，TLS 放寬為明確選擇；完整執行與停止邊界未驗證。** 覆蓋：scheme／host／port 任一不符以 `scope` 拒、越界服務 0 連線；授權 origin 的越界重定向在該跳停止、`redirectChain` 末端記 `{stopped: 'out_of_scope'}`、越界服務 0 連線；IP 字面量 host 0 次解析；`Set-Cookie` 只回同 origin 同 path、不入他題 jar；拒 `connection`／`content-length`／`proxy-authorization`、允許 `Host`；1.5 MiB 響應標 `bodyTruncated` 且存檔 ≤ 1 MiB；代理環境變數被忽略、直連；TLS 第 9 項**已實際驗證**（`openssl` 在場）：授權 https origin 接受自簽憑證，重定向到同憑證的他 origin 被停止且 0 連線。關停 origin 檢查後第 1、9 項會失敗（變異檢查）。保留與缺口：第 4.2 節「連線位址須與核實位址一致」的 DNS 重綁定拒絕分支**已寫但無測試觸發**（解析器只被調用一次並連到核實位址，不一致分支未覆蓋）。補驗核對解析位址是否固定到實際 socket；不為不可達分支虛構第二次解析。DNS 等待期間超時仍連線的原型缺陷在引用審計對話中已有復現，旧记录当时未重跑，须补全程取消回归（本轮补验结果另见§4.2.1）。實作未明說而由執行者定的選擇（記錄備查，非判據）：逾 60 s 的 `timeout_ms` 截到 60 s 而非拒絕；響應頭封頂 16 KiB 並標 `headersTruncated`；模型提供的 `Cookie` 頭覆蓋 jar；含憑據的 URL 被拒；5 跳上限記 `hop_limit`（無測試覆蓋）；每請求 `agent: false` 不復用連線。實作模組 `apps/launcher/src/http-tools.ts`（`createHttpTools({target, jar, workDir, resolve?})`）。證據：分支 `claude/g-v4-http-tools-555451`（未合併）。

### 4.2.1 G-V4 本轮生命周期补验（2026-10-23）

本轮仅验证 HTTP 适配器，原型位于独立 managed worktree `/Users/caihaoming/.codex/worktrees/g-v4-http-lifecycle/pentest-agent`（基线 HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`，未合并、未提交）。本轮结论与必要证据已由主会话核对并同步主工作区（仅文档与证据，原型代码未合并）；主会话独立重跑定向验证 20/20 通过。验证时文档从主工作区复制，旧原型从 `claude/g-v4-http-tools-555451` 工作区复制；来源/hash 与原型原件在 [本轮证据](../../gates/g-solver-verification-20261023/g-v4-http-lifecycle/REPORT.md)，未找到旧 G-V4 完整报告，不补造日志。上段旧九项结果保持历史，本轮重新回归其全部九项（含 openssl 自签 TLS），不改写 G-V1／G-V3。

**局部接口选择：** `createHttpTools({target, jar, workDir, resolve?})` 由宿主绑定题目目标、题目 jar 与会话目录；`request(args, operation)` 第二参数仅由已完成核实／登记的宿主提供 `HttpOperation = {run, sessionID, callID, signal: AbortSignal, deadline}`。`deadline` 为绝对 Unix 毫秒时刻，宿主按 run／session 有效期封顶；HTTP 再取 `min(deadline, 开始时间 + timeout_ms)`，整条重定向链只设一个计时器。身份不从模型 args 读取。HTTP 适配器只消费这份可信上下文；核实绑定、登记、停止标记、配额与终态留存属于 C，不能由模型构造 operation，也不能以本接口替代 C 的授权检查。

- DNS 等待与停止信号竞争；取消／到期立即结束等待，解析迟到返回没有开 socket 的续执行。系统 resolver 本身不能被 AbortSignal 终止，底层解析可继续，**不意味着 DNS 后仍可连接**。
- 每次解析后、每跳启动前与返回结果前检查同一信号／deadline。中止销毁已开请求，`finally` 等待请求 `close` 后适配器才结算；body 落盘也与停止竞争，`writeFile` 接受内部 AbortSignal；目录等待返回后再次检查信号，不在停止后启动写入。请求关闭／落盘最多额外等待 1000ms 收尾（本轮局部接口选择，不增加 HTTP 执行时间），逾时返回 `cleanup_unknown`；宿主必须保留未知资源登记与名额，待后续核对，不能宣称已回收。该原型不是 OS 层实时保证；已开始写入仍可能留下部分文件，不作为成功 body 返回。
- `HostBoundary` **仅在测试文件**，按 run／session 登记取消控制器，登记早于 DNS，停止先标记再 abort，终态保存后释放名额；它用于核对适配器契约；**该历史G-V4批次没有验证真实C、产品插件/launcher/RPC、到期或RPC放弃**，本轮增量见§7.2.1。§7.2 其他要求不因该历史批次通过而完成；本轮真实C增量另见§7.2.1。

**观察：** 原始 DNS 超时缺陷重现：到期时未结算、释放 DNS 后返回 allowed，授权服务收到 1 条连接；原始失败日志完整留存。修订后 timeout／取消在 DNS 返回前结算，释放后授权与越界服务均 0 连接；TLS 握手、重定向二跳 DNS、body 读取期间取消均结束，真实连接关闭后释放名额。共享题目请求中单 session 停止不影响另一 session，run 停止不影响另一个 run；已停止 session 不再登记，替身登记表的 8 个在途名额全部结算并可复用。fixture 以整张 active 登记表计数，没有 challengeId，未验证每题配额分组或跨题独立配额；设计的每题 8 名额目标保持不变。此处停止选择与配额是宿主替身行为，不能据此宣称实际 C 已实现。

地址固定测试在同端口监听 A=`127.0.0.1`、B=`::1`：解析核实 A 后答案变 B，实际服务端 socket 地址为 A，A 1 条连接、B 0 条，resolver 1 次调用。没有伪造第二次解析或宣称原不可达不一致分支被覆盖。跨重定向在第 70ms 放行第一跳，body 等待在总第 100ms 到期，不能重置为第二个 100ms。

本轮定向 20/20 通过（旧九项＋DNS timeout 回归＋10 项生命周期测试）；typecheck／build 通过，全套 243/243 通过。独立只读评审发现落盘等待可无限拖延，新增取消／到期两项屏障先失败后修复：1000ms 收尾后返回 cleanup_unknown，保留名额；释放屏障后不启动已取消写入。首次环境与测试时序失败也保留，详见本轮证据。只有本地无秘密 fixture；解题 provider 请求及真实模型 token 消耗均为 0。本轮不是 G 整体定稿、真实停止接线或解题能力验证。

### 4.3 cookie 與會話

每題一個 cookie jar，由控制服務持有（不寫入工作區）。`Set-Cookie` 寫入 jar，之後同 origin 的請求自動帶上（路徑以前綴匹配，不實作完整的 domain 規則）。同題的所有解題會話共用一個 jar，使 Recon 登入後的狀態可被 Solver 使用；Verifier 的獨立性不靠 jar 隔離，而是由 D 的驗證模式決定是否重放（D 的範圍）。jar 不跨題、不回傳模型。

### 4.4 併發與取消

每題同時進行中的 HTTP 請求上限 8（預設提案），由宿主短暂登记管理。run 停止時中止全部在途請求（第 7.1 節）。历史 G-V4 仅验证无 challengeId 的宿主替身；本轮真实 C 已覆盖同题两个 session 共用八槽、另一题独立容量和停止释放，见 §7.2.1。unknown 不归还名额。

---

## 5. 作業（腳本執行）

### 5.1 為何用受管作業，而非原生 `bash`

design v1 G 要求原生 shell 若不能受同等限制，就走受管作業入口。現行判斷：原生 `bash` 在 OpenCode 進程內運行，繼承該進程的環境變數，其中含 provider 憑據與 RPC 傳輸憑據（C design 第 2 節）；公開插件接口是否能清空環境或限定 uid 尚未驗證。因此首版採受管 `job.run`，原生 `bash` 維持拒絕。第 9 節 G-V2 負責確認這一判斷；若結果相反，才另議替換，不以原生工具替代本節而不先驗證。

**G-V2 結論（2026-10-23，只讀檢查 `@opencode-ai/plugin` 1.19.0 類型定義，目標運行時 1.19.3，未在運行時驗證）：維持受管 `job.run`。** 依據：公開 hook `shell.env`（`index.d.ts` 第 242–247 行）可寫 `output.env`，但只有 input 側的 `cwd`、沒有輸出 `cwd`，無法改工作目錄；類型中無 `uid`／用戶切換接口；`permission.ask` 只有 `ask｜deny｜allow`，插件層不能按命令或路徑篩選。三項裡 `cwd` 與 `uid` 都達不到，故原生 `bash` 保持拒絕，本節方向不變。限制：只依類型定義，`shell.env` 的實際合併／清除語義未在運行時驗證（不影響結論，因 `cwd`、`uid` 已否定）；`opencode.json` 權限模式能否按命令模式限 `bash` 未查，日後重評原生 shell 時須補。證據：[`docs/gates/g-solver-verification-20261023/G-V2-native-shell.md`](../../gates/g-solver-verification-20261023/G-V2-native-shell.md)。

### 5.2 工具

`job.run`、`job.read`、`job.cancel`（`ctf_job_run` 等），授予 `recon`、`domain-solver`、`engineer`、`verifier`（`verifier` 僅限本地重算，見第 6 節）。

| 工具 | 參數 | 回傳 |
| --- | --- | --- |
| `job.run` | `argv`（1–32 項，每項 ≤ 4 KiB，無 `\0`）、`timeout_ms`（預設 60000，上限 600000）、`wait_ms`（預設 5000，上限 30000） | `job`（UUID 句柄）、`state`；若在 `wait_ms` 內結束則直接給出退出碼 |
| `job.read` | `job`、`stream`（`stdout` 或 `stderr`）、`cursor`（字節偏移，可省） | 最多 32 KiB 的一頁、`nextCursor`、`state`、`exitCode`、`signal`、`done` |
| `job.cancel` | `job` | 最終 `state` |

`argv` 不經 shell 解釋；需要 shell 語法時，由模型明確寫 `["sh", "-c", ...]`，同樣受本節所有限制。

**狀態：** `running`、`exited`、`timed_out`、`cancelled`、`failed_to_start`。

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

**G-V5 結論（2026-10-23，確定性測試，9/9 通過，三次重跑皆綠，`npm run typecheck` 退出 0）：原型的環境白名單、單作業取消與並行規則通過；不包含會話／run 回收、C 接線或 OS 隔離。** 覆蓋：環境白名單生效（`env` 輸出無哨兵 `CTF_PROBE_SENTINEL` 名或值，`PATH`／`HOME`／`TMPDIR`／`CTF_WORK` 在）；stdin 接 `/dev/null`（`cat` 即退 0）；超時與取消都殺掉孫程序（狀態 `timed_out`／`cancelled`，程序組清空）；32 KiB 分頁逐字節一致、末頁 `done`；1 MiB 封頂（讀回與磁碟皆截在 1 MiB）；缺程序回 `failed_to_start`；並行上限（同會話第 3 個、同題第 9 個被拒、不排隊，他會話與他題仍可起）；句柄隔離（他會話／他題讀取或取消被拒，持有者仍可用）。變異檢查：改為只對 leader pid 發信號後，孫程序清理的兩項測試失敗，故非空測試。實作未明說而由執行者定的選擇（記錄備查）：`job.read` 以 base64 回傳 `data`（保分頁逐字節一致）；並行槽位到作業完全結算（程序組消失、輸出關閉）才釋放，非退出即釋放；`PATH` 預設取 `process.env.PATH` 而非鏡像固定值（鏡像固定值待 F）。保留與缺口：正常退出時也對殘餘程序組補 `SIGTERM`／`SIGKILL`（防孤兒佔管道，非判據，待復核）；`reapIncomplete` 超時路徑無測試；第 7.1 節的「撤銷時取消該會話全部作業」未實作（不在判據內）；控制服務未接線、`JOB_TOOLS` 未註冊；作業網路按設計不受限、未測（第 5.5 節）。實作模組 `apps/launcher/src/job-tools.ts`（`JobManager`，`jobsRoot` 由調用方給）。證據：分支 `claude/g-v5-job-tools-b426e6`（未合併）。

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

---

## 7. 停止、審計與插件清單

### 7.1 停止

- 全局停止（C design 第 6 節）時，控制服務先標記綁定，再：中止全部在途 HTTP 請求；對全部作業送取消；已結束的作業保留其輸出。
- 單一子會話撤銷時，只取消該會話的作業與請求。
- 作業與 HTTP 句柄只對綁定它的會話有效；綁定到期或撤銷後，已有句柄的調用一律拒絕。
- 控制服務重啟後，前一進程的作業句柄不恢復；其輸出目錄保留，狀態記為不可續，依 design v1 1.4 的「停止舊作業再重建」處理。

### 7.2 控制服務與慢工具的執行接口（部分接线通过，长作业完成接线未定）

- **短暫串行、外部等待分離：** C 的身份核實、模型准入、工具資源配額及登記保持串行狀態變更；HTTP 連線／DNS、作業等待與取消回收不占用全局 RPC 隊列。異步核實返回後、實際登記或啟動前，再核對停止／撤銷／到期。
- **先登記後啟動：** 宿主以 `{run, sessionID, callID}` 登記本次工具操作及取消信號，再啟動資源；HTTP／作業適配器接受該信號。停止先標記並拒絕新操作，再取消所屬資源。啟動中收到取消也必須回收，不能留下未登記作業。完成／取消／啟動失敗均保存結果後釋放名額；未知回收結果明示，不能報成功。
- **時限：** HTTP 的 timeout 覆蓋 DNS、連線、重定向和讀取全程；DNS 返回時已取消／超時就不得連線。插件的等待型 RPC 時限取宿主核准的 `min(工具等待上限, run 剩餘時限) + 5 秒傳輸收尾餘量`，不再套用固定 15 秒；餘量不是工具執行時間。普通 hook 維持短時限。HTTP 等待用 timeout_ms，job.run 等待用 wait_ms；cancel／回收須有界，逾時返回 cleanup unknown 並留存記錄。
- **斷開：** RPC 客戶端放棄仍在進行的操作時，由服務端取消該操作；若作業已完成交付句柄，則由 job.cancel／run 停止管理。交付競態保留已登記句柄與結果，不自動重發 job.run 或 HTTP；停止按 session／run 可掃到所有未回收資源。
- **長作業等待仍是未知數：** 現有 run/read/cancel 不等於完成總設計的「無須模型持續輪詢」。候選優先使用公開 OpenCode 工具的有界等待（同一次工具調用等待作業結束，輸出落盤仍可由其他授權調用增量讀取），其次核實公開完成事件／會話恢復接線。需驗證取消、完成回傳與不新增 provider 循環；都不成立時保留為能力缺口，不把輪詢改寫成滿足要求。選定前不擅自改動第 5.2 節既有 wait_ms 契約。

**当前设计判定（下节给出证据）：** 短暂串行、先登记后启动、宿主核准时限、有界回收与 unknown 保留的机制已在所列版本和测试条件内验证，可作为后续实现依据；私有 Symbol 关联是限定 OpenCode 1.19.3／plugin 1.19.0 的已验证做法，不是跨版本保证。并发配额与收尾数值经过测试，不等于第 10 节的产品数值默认值已定稿。产品代码尚未整合，G 整体仍是部分验证草案。

**尚未定稿的设计问题：** 保持“长作业无需模型持续轮询，并将完成结果交回原等待任务”的目标。现有 `job.run` 在 `wait_ms` 后返回句柄的契约不满足这一点；直接通知并恢复同一 child 的候选也不能更新已结束的原 task。下一步需要在本文中选择等待契约调整或父子任务完成交回机制，再按选定候选验证；两个方向都未选定、未获可行性结论，不因局部接线通过而默认采用。第 5.2 节现有契约保持，不能把读句柄／轮询改称自动完成。

### 7.2.1 本轮 C／RPC 产品接线结果（2026-10-23，独立工作区）

**结论：接线、资源登记与停止边界已通过本轮无模型验证；第 7.2 节长作业超过 `wait_ms` 的自动完成交回仍未通过，不宣布 G 或第 7.2 节整体完成。** 工作区 `/Users/caihaoming/.codex/worktrees/g-c-rpc-slow-tools/pentest-agent`，代码基线 `d83a0c3024271dbf212db319e900fcf527e68b0f` 加未提交改动；适用文档、历史证据及必要原型来源 hash 均留存。验证期间主工作区与旧 worktree 未修改；本轮结论与必要证据已由主会话核对并同步主工作区，仅同步文档与证据，产品代码仍在独立工作区。未 commit／push／合并。报告与原始证据：[C／RPC 本轮报告](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/REPORT.md)。

**核对与证据范围：** 本轮全套 291/291、typecheck/build 通过；主会话独立重跑控制服务与慢工具回归 46/46，通过前的 16 项旧 fixture 失败亦保留。真实产品入口与公开恢复探针分别记录，不拼接为同次整体通过。

**本轮接口选择与条件：**

- `handle` 的串行区只做身份与存活状态复核、准入扣次、分派／工具登记等短暂状态变更；SDK 查询、根目录准备、文件、HTTP 与 job 等待在队列外。所有异步准备返回后，在登记与启动前复查停止／撤销／到期。根目录按第 3.1 节的真实映射，在子会话 `chat.message` 返回和首次模型准入前准备；同一初始化 Promise 被后续 hook 共用。
- 公共 plugin 1.19.0 的 `ToolContext` 无 `callID`；使用公开 `tool.execute.before` 的 `output.args` 注入插件私有 Symbol，携带宿主 hook 的 callID 与控制服务核准的 RPC 时限，execute 单次消费，不加入模型 schema／JSON 参数，也不读取非公开 context。OpenCode 1.19.3 产品 runtime 实证保留此关联；并发同 session／同 tool、逆序 execute 的确定性用例及 runtime 同轮双写均通过。若后续版本不再保留 Symbol，应拒绝并重新验证，不降级按 session/tool 猜测。
- 工具登记键为 run/session/call；HTTP 在登记后启动，按 challengeId 计八个在途或 unknown 名额。job 句柄、原始 call 与 session/challenge 继续登记到程序组与输出结算，初始 `wait_ms` 返回句柄不释放槽位。每 session 两个、每 challenge 八个由同一个 JobManager 管理，跨题容量独立。
- 插件等待时限来自控制服务 `min(HTTP timeout_ms／job.run wait_ms, 绑定剩余时限)+5000ms`；普通 hook 保持 15 秒。HTTP 单一 deadline 覆盖 DNS 到落盘，host deadline 的 abort 记 timeout，收尾不延长执行。HTTP 清理等待上限 1000ms；C 停止资源收尾上限 4000ms；job 程序组先 TERM、2000ms 后 KILL，再最多等待约 1000ms，输出关闭等待 500ms。达到边界仍不能确认时记 `cleanup_unknown` 并保留配额。
- response 未 `writableFinished` 就关闭，RPC AbortSignal 取消本次操作；job.run 已产生句柄但 response 尚未 finish 的窗口仍保留监听，审计 `rpc.abandoned` 关联原 session/call/job 并取消。正常 response finish 后的 running job 不因连接关闭取消，改由 job.cancel／session／run／deadline 管理。`writableFinished` 是服务端传输完成边界，不是客户端应用接收回执；finish 后客户端是否实际收到句柄仍未知，保留登记，不自动重发。

| 判据 | 本轮证据与结果 |
| --- | --- |
| 慢 I/O 不占全局队列 | 真 C 卡住 HTTP body，另一题 session 的 model.call 在释放屏障前完成；撤销该 HTTP 会话即可取消，另一会话不受影响 |
| 合法等待超过旧 15 秒 | 同一次 `runtime/accepted`：产品 launch/entry 插件/C/OpenCode 1.19.3/loopback provider，HTTP 16004ms、job 16054ms 正常完成；stub 请求与准入均 12 次 |
| deadline 与有界收尾 | fake-clock 先确认已登记并连接再到期，工具 timeout；落盘屏障造成 HTTP cleanup_unknown，登记后目录屏障造成 C 4 秒后 unknown，释放屏障后不启动 job |
| RPC 放弃／交付竞态 | 本地真实 RPC 的未完成 HTTP、已产出 job 句柄但响应屏障未释放、正常 finish 三种路径各有确定性测试；前两者取消，后者保留 running 到撤销 |
| stop／revoke／expiry 与配额 | C 同题双会话 HTTP 八槽、跨题独立；job 每会话两／每题八；撤销实测孙进程消失而另一会话孙进程仍活，run stop 再清后者；到期取消已交付 job 并拒绝句柄；注入程序组探测 unknown 后不归还作业配额 |
| 同一产品入口全链路 | `runtime/accepted` 绑定→材料读→同轮两次私有 work 写→HTTP→短 job 的 early/late 增量读→16 秒 job→保留 running job→Coordinator 完成后的统一 stop；全部资源终态 settled |
| 超过初始 wait_ms 自动交回等待任务 | **未通过。** 短 job 在 wait_ms=200ms 返回 running，约 762ms 结算；后续读取由新 scripted provider 请求发起。这只证明现有契约与输出可用，不证明自动完成交回或无需模型轮询 |

**公开完成／恢复候选的实际探针：** [completion-probe/first](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/completion-probe/first/resume-and-duplicate/result.json) 继续使用真实产品入口、C、OpenCode 1.19.3 与 loopback 替身，通过测试侧 wrapper 观察真实 JobManager.waitSettled 后调用公开 `event.subscribe`／`session.promptAsync`，没有增加产品 notifier 或改 wait_ms。job.run 在 wait_ms=50 返回 running（1792758106799）；原生父 task 在 job 完成前已经 completed，父会话在1792758106833恢复；job在1792758107803结算；host在1792758107810向绑定的同一child通知，child恢复为第3次请求。重复相同messageID后仍只有一条通知消息、child请求仍为3。原父task对象及输出前后完全相同，仍为“Waiting for host job completion.”。取消对照中真实job结算cancelled，测试通知器抑制通知，无恢复请求。

这给出了**直接完成通知→同child promptAsync恢复**候选在当前契约下的具体不足：可以恢复原child，能在该探针去重并保持归属，却不能将结果送回已经结束的原native task；没有靠反复模型请求等待完成，但原任务也没有保持等待。工具 execute 的16秒等待只证明 job 在wait_ms内结束的路径。探针未穷尽其他公开组合，不能断言OpenCode整体不支持；保留“更改工具/等待契约”或“额外父子等待/恢复协议”作为尚未选定的设计选项，不在本轮擅自实现。未新增job.wait、未更改第5.2节wait_ms、未自建provider循环。两次探针独立于runtime/accepted，不拼接为同次整体通过。

**失败保留：** 初始六项缺接线失败；HTTP host deadline 被误记 cancelled、目录准备造成 stop 无界；旧 job 原型先 spawn 后开输出文件，开 stderr 失败会产生未登记进程，marker 回归先失败再修复为两流准备后才 spawn；根目录首次工具才创建不符合第 2.2 节，回归先失败后修为首次准入前初始化；旧 C/V1 测试使用不存在的材料目录导致最后一次回归失败，改为临时真实材料目录后保留原业务断言。首次全套、类型错误与主会话独立失败记录均原样保留，不拼接成功。

**边界：** 全部是确定性工具接线和本地 runtime，不是求解能力。只有 loopback 替身 provider，真实模型 token 0；usage 是替身回报零，不推断真实模型计费。V6 OS／进程隔离、作业网络 scope、128MiB 工作区配额、run 级工具总量及 D/oracle 未验证或未实现，限制不变；产品配置已注册 job 并不代表可绕过第 5.4 节产品运行前提。主工作区尚未合并本轮代码。

### 7.3 審計

历史 E 的 `tool.execute` 審計不記工具名；本轮独立工作区已让 `tool.execute` 记录 tool、callID 与结果类别，`tool.registered`／`tool.settled` 记录身份、句柄、deadline 与状态，`rpc.abandoned` 保留断开关联。控制审计不记录 HTTP body 或作业输出内容；实际内容仍在各自输出文件及会话工具结果中。主工作区旧实现的限制仍保留到代码整合。

### 7.4 插件清單

`apps/opencode-plugin` 的 `schemas` 與 `descriptions` 須改為本文的工具集。現有清單中的 `workspace.patch`、`workspace.unpack`、`observation.read`、`hypothesis.propose`、`hypothesis.conclude` 屬已退場的單一 Solver 設計，不納入 G，應從清單移除；`candidate.register` 屬 D，本文不納入。本轮独立工作区的 `launch.ts` 已传入 MANAGED_TOOLS，产品配置按角色 allow／deny，控制服务再次按绑定执行核准；不再注册上述退场工具或 D 的 candidate.register。产品 runtime 只加载产品 entry 插件，未用 scratch 插件代替。

---

## 8. 與現有代碼的關係

- `apps/launcher/src/intake-tools.ts` 的 `readMaterial` 泛化為根目錄讀取，供 E 與 G 共用；E 的 `challenge.read` 語義不變。
- `apps/launcher/src/control-service.ts` 的 `pending` 增加 `challengeId`，新增宣告表與 `challenge.assign`／`challenge.unassign` 處理；`bindFromSdk` 把題目寫入綁定。
- `packages/supervisor` 的候選與驗證模組仍保留，屬 D，本文不接線。

---

## 9. 待驗證項

以下各項的結論回寫本文，並決定去向。**在結論回寫前，本文所有「候選」與「提案」都不得視為已成立。** 本文不授權任何真實模型調用；G-V7 另須授權。

| # | 要回答的問題 | 檢驗方式 | 結果去向 |
| --- | --- | --- | --- |
| G-V1 | 跨輪宣告、分派、恢復與失敗清理是否符合第 2 節 | 真實 OpenCode＋確定性替身，順序／同輪競態及停止測試 | 修訂協議原型通過：T1–T9 確定性回歸及 T1/T5/T7/T8 runtime，綁定先於首次准入/請求；T5 初次上限失敗保留。條件、版本、限制見 §2.1 與跨輪證據，本轮正式产品链路见 §7.2.1（不替代历史其余runtime缺口）；舊 T4 仍撤回 |
| G-V2 | 原生 shell 能否受同等限制 | 已有公開類型檢查 | 維持 job.run；依 plugin 1.19.0 類型、目標 runtime 1.19.3，非運行時證明。無新證據不重跑 |
| G-V3 | 三根映射、跨會話工作區與既有路徑規則 | E 實際輸出＋兩個同題會話的文件測試 | 保留旧局部结论；三根原型补验及旧回归 10/10，全套 233/233、typecheck/build 通过，失败与条件见 §3.2；128MiB 配额与 OS 隔离未验证 |
| G-V4 | HTTP scope／cookie、全程超時與取消 | 历史适配器替身；本轮真实C接线见§7.2.1 | 旧九项全部回归；适配器生命周期定向20/20通过（含落盘阻塞回收unknown），DNS原始失败及修正留存、实际socket固定A/B零连接、单一deadline、阶段取消与宿主边界替身验证，见§4.2.1；本轮真实 C／RPC 停止与产品入口结果见 §7.2.1；旧HostBoundary不冒充每题配额证据 |
| G-V5 | 作業環境、輸出、取消及會話／run 回收 | 既有程序組測試＋啟動／停止競態及 C 接線 | 舊 9/9 和變異結果保留；本轮会话／run／到期取消、真实 RPC 与产品入口验证见 §7.2.1；超过 wait_ms 的自动完成交回仍未通过 |
| G-V6 | 第 5.4 節檔案、進程隔離及資源限制 | ARM64 產品環境，兩題、同題兩會話、宿主非秘密哨兵 | 未驗證。按第 5.4 節選擇 (a)／(b)；失敗不降低邊界，不宣稱產品隔離 |
| G-V7 | 真實模型能否使用工具協作 | 另行授權目標、模型／provider、批次和 token 預算 | 未運行；只證明工具使用，不證明解題能力 |

**證據與狀態：** V2 報告在主工作區 `docs/gates/g-solver-verification-20261023/G-V2-native-shell.md`；V1 原件仍在第 2.1 節歷史工作區；修訂協議報告、runtime 原始證據與原件 hash 副本在 [cross-round-v1](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md)，已按原內容同步至主工作區；原型代碼仍只在獨立工作區。旧 V3–V5 的既有數字來自本文件已回寫的執行結論，旧原型／測試仍在各節所列分支；旧 V3–V5 的完整报告未找到，標為待核對收錄（本轮新 G-V4 生命周期报告与旧报告缺失分别记录，见§4.2.1），不刪除已有結論、不补造历史日志。本轮 G-V3 三根补验的新报告与失败/最终日志已保存于 [g-v3-three-roots](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md)，与旧 V3 报告缺失分别记录。補驗時只重跑受改動影響的判據；缺失證據無法核對時保留缺失，不補造歷史結果。

V1–V5 的局部結果不能替代產品入口＋產品插件＋控制服務的無模型接線驗證。G 的目標保持不變；D 的發布／候選／oracle 仍是相鄰能力，不納入 G 通過條件。V6 依賴產品執行環境，V7 另行授權。

---

## 10. 待定與缺口

- **长作业自动完成交回（第 7.2.1 节）：** 当前run/read/cancel不满足超过wait_ms后交回原等待任务；公开promptAsync已实测恢复同child、去重和取消对照，但原native task已返回且输出不更新（§7.2.1）。其他公开组合未穷尽，进一步等待协议/契约候选未选定，wait_ms保持。
- **網路隔離（第 5.5 節）：** 作業的網路不受 scope 限制，是當前最大缺口；須待 design v1 第 3 節網路隔離方案定稿。
- **宿主、跨題與同題會話的 OS 隔離（第 5.4 節）：** 取決於 G-V6 結果。
- **數值預設（第 3.3、4.4、5.6 節）：** 目前為提案，首次真實運行前須確認；不應由模型或 run 過程調整。
- **run 級工具資源總量：** design v1 1.4 要求工具資源與模型成本分別管理，但本文只定單次與併發上限，總量與計時策略未定。
- **受保護操作：** 本文的 HTTP 與作業不分類目標端點的副作用。若靶場端點有重置、計時或限次語義，它們不會被 G 識別為受保護操作；design v1 1.4 的受保護操作規則目前只約束平台操作。是否需要把目標端點納入，待 D 與 E 的平台 adapter 決定。
- **Intake 的工作區寫入：** 與 design v1 H 表不一致，見第 6 節，待 D 或實測決定。
