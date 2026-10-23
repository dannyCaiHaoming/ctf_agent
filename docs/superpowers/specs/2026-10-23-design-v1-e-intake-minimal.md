# design v1 E 最小版詳細 design：題目來源與 Intake 接入

記錄日期：2026-10-23（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 2 節 E 的詳細 design 子文件，**最小版**：只解決「題目進得來」——已運行的本地／遠端靶場與直接提供的題面／附件，經運行配置進入 run，Intake 能讀到它們。平台 API adapter 與開發測試靶場的部署不在本文（design v1 E 的另兩行來源）；為 G、D 服務的部分延後，見第 6 節。細節以本文為準。本文只定義設計，不構成執行授權。

**前提：** [入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）已定運行形態、文件分區與運行資料目錄；[C 詳細 design](2026-10-23-design-v1-c-control-service.md)（下稱 C design）已定控制服務、會話綁定、逐次准入與角色能力的執行方式。2026-10-23 真實模型冒煙顯示：沒有接入工具時，Intake 會把「讀取全被拒」理解為缺權限並請求宿主開放讀取（見 C design 第 8 節）。本文補上該缺口。

**用詞：** 本文的「宿主」指啟動腳本與其進程內的控制服務（design v1 1.2），不是運行 Docker 的機器。本地調試與發布共用同一啟動腳本（入口 design 第 1 節），發布時它與 OpenCode 同在產品容器內；本文所說的記錄都由控制服務寫進運行資料目錄，發布時該目錄是容器的持久資料目錄（design v1 F）。

**與首題的關係：** 本文只讓題目進得來。解題角色（Recon、Domain Solver 等）要能動手，還需要 design v1 G 的工作區與實驗工具；首題的真實模型驗證在本文與最小 G 都接通後進行。

---

## 1. 範圍

**做：** 運行配置中的題目清單；宿主在啟動 OpenCode 前檢查題目環境並把材料固定進題目工作區；Intake 列出題目與讀取材料的兩個受管工具。

**不做：** 平台 API adapter 與平台憑據；靶場的部署、啟動、停止、重置；運行中途的可達性監測；HTTP、腳本、瀏覽器等實驗工具（design v1 G）；候選登記、驗證與提交（design v1 D）；第 6 節列出的延後項。

| 來源 | 本文做法 |
| --- | --- |
| 已運行的本地或遠端靶場 | 運行配置給出已獲授權的入口與協議，宿主在啟動前檢查可達；不假設一定是 HTTP |
| 直接提供題面與附件 | 運行配置指向本地的題面文字／文件與附件；宿主複製進題目工作區並記錄來源 |

## 2. 題目清單

運行配置是 `config/` 下的非秘密文件（入口 design 第 2 節）。release profile 新增欄位 `challenges`，指向一份**題目清單**文件（相對路徑相對於 release profile 所在目錄）。缺少該欄位、文件不存在或清單為空時，啟動器拒絕啟動：沒有題目是配置錯誤，在宿主側擋下，不讓模型運行後自行發現。入庫範例為 `config/challenges.example.*`，開發者本地實際清單不入庫。

| 欄位 | 必填 | 含義 |
| --- | --- | --- |
| `id` | 是 | 穩定標識，只含 `[\w.-]`，清單內唯一；用於工作區目錄名與證據關聯 |
| `title` | 否 | 題目名稱 |
| `statement` | 否 | 題面的行內文字。題目公開提供的登入帳密等寫在題面裡，屬題目材料，不是秘密 |
| `statementFile` | 否 | 題面文件的路徑；與 `statement` 最多填一個，兩者同時出現時拒絕啟動。不按字串內容猜測是文字還是路徑 |
| `materials` | 否 | 附件路徑清單，每項是一個普通文件（含歸檔）；不接受目錄，多個文件請先打包 |
| `target` | 否 | 已獲授權的入口：`{ protocol: "http"|"https"|"tcp", url 或 host+port }`；離線題留空。首版授權範圍即 `target` 本身 |

規則：

- 路徑由宿主解析，必須存在；相對路徑相對於題目清單文件所在目錄。
- `statement`／`statementFile`、`materials`、`target` 全缺時拒絕啟動——這樣的題目沒有任何可做的輸入。其餘欄位缺省時標為未知或不適用（design v1 E），不要求開發者為簡單靶場手寫繁複 manifest。
- 題目清單不含秘密值。

## 3. run 準備

宿主在啟動 OpenCode 之前（入口 design 第 1 節第 2 步之後、第 4 步之前）完成以下步驟。**任一題任一步驟失敗，整個 run 拒絕啟動**，原因寫入證據後退出；不跳過該題繼續運行，使實際運行的題目始終與配置一致。

1. 在運行資料目錄建立 `workspace/<challenge-id>/materials/`。
2. 把題面寫成 `materials/statement.md`（`statement` 的行內文字，或複製自 `statementFile`），`materials` 中的文件複製進 `materials/`，保留原檔名。檔名彼此相同、與 `statement.md` 相同或以 `.` 開頭的，拒絕啟動。
3. 對每個固定下來的文件計算 sha256，與原始路徑一併寫入 `evidence/`（與產品資產副本清單同一做法，A／B 詳細 design 第 2 節）。
4. 把 `materials/` 下的文件設為唯讀，防止誤寫；唯讀的主要邊界是受管工具不提供寫入（第 4 節）。
5. 任一材料或題面含控制憑據（provider 憑據、RPC 傳輸憑據）時拒絕啟動，沿用現行啟動器對產品資產的掃描。
6. **可達性檢查**：對每個有 `target` 的題目，宿主建立一次 TCP 連線後即關閉，不送任何內容；超時由實作定並可配置。不可達即拒絕啟動，結果與檢查時間寫入證據。發布時該檢查在產品容器內執行，即從實際運行環境驗證連通（design v1 1.6）。
7. 題目工作區不在 OpenCode 工作目錄之內，其根部不得出現 `.opencode/`；這是 design v1 1.5 的硬性邊界，沿用現行檢查。

準備階段的檢查只覆蓋啟動當時；運行中途靶場失效，表現為之後實驗工具（design v1 G）返回的連線錯誤，不在本文。

## 4. Intake 的接入工具

兩個受管工具，由控制服務執行，**只授予綁定為 `intake` 的會話**。接法沿用 C design 第 5 節的兩層約束：經產品插件的受管工具清單註冊；`product/opencode/opencode.json` 只在 `intake` 角色設 allow、其餘角色 deny；每次調用再由控制服務按綁定的會話與角色核准。Intake 的範圍是整個 run，以題目 `id` 指明對象，宿主核實該 `id` 屬於本 run。工具名為 `challenge.list` 與 `challenge.read`，在 OpenCode 中的工具 id 為 `ctf_challenge_list` 與 `ctf_challenge_read`（C design 第 5 節的命名規則）。

| 工具 | Agent 提供 | 宿主返回 | 邊界 |
| --- | --- | --- | --- |
| 列出題目 | 無 | 每道題的 `id`、`title`、`target`（無則標「無網路目標」）、可達性檢查時間、材料文件清單與 sha256 | 只列本 run 的題目；不返回宿主路徑等其他細節 |
| 讀取材料 | 題目 `id`、材料相對路徑、可選的續讀游標 | 文字內容，或二進位的大小與開頭簽名（沿用現行 `readText` 的語義）；大文件分頁讀取並給出續讀游標（下一頁的字節偏移，分頁不切斷 UTF-8 字符） | 路徑限於該題 `materials/`；拒絕符號連結與越界路徑；不提供寫入 |

**身份、hash、目標由宿主給出**（design v1 1.2）：列題結果來自宿主，Intake 只做類別判斷、未知項與建議。Intake 經原生 `task` 把這些交給 Coordinator；首版不另設交付工具與可信記錄（第 6 節）。

**scope 不可由題面改寫**（design v1 1.5）：授權範圍只來自運行配置的 `target`。題面、附件或模型輸出中出現的其他地址不成為授權範圍；Intake 可以如實報告，宿主不據此擴大。

**材料只經受管工具讀取**：題目工作區在 OpenCode 工作目錄之外，原生 `read` 讀取它需要放開 OpenCode 的外部目錄權限，會使可見性一層失效、只剩執行許可一層（違反 C design 第 5 節）。因此原生 `read` 的範圍維持 C design 原樣，不擴展到題目工作區。

## 5. 驗收

驗收層級為「確定性工具接線」（design v1 1.6），邊界判據：

- 配置缺題目、路徑不存在、目錄型材料、同名材料、材料含控制憑據、目標不可達時，拒絕啟動、OpenCode 未被啟動，且證據記錄原因；
- 材料逐字節一致、唯讀，證據含來源路徑與 sha256；OpenCode 工作目錄不含題目材料；
- 非 `intake` 角色調用接入工具被拒，包括可見性設定出錯時由執行許可層拒絕；
- 越界路徑與符號連結被拒，任何受管工具都不能寫入 `materials/`。

真實模型驗證在最小 G 接通後與首題一起進行，須另行授權。

## 6. 延後項

以下在本文不做，在其使用方出現時再設計，不預先定格式：

| 延後項 | 待何時 | 首版替代 |
| --- | --- | --- |
| 結構化 scope（host／port／路徑前綴）與給模型的範圍說明 | G 的網路檢查 | 授權範圍即 `target` |
| 解包歸檔 | G 的文件／腳本工具 | 歸檔照普通文件固定；首題可選不需歸檔的題目 |
| 交付工具、版本化做題輸入記錄、Coordinator 的任務狀態讀取 | D 或其他需要可信記錄的下游 | Intake 經原生 `task` 返回 |
| local oracle 的配置、文件格式與邊界 | D | 無；沒有可信完成判定，任何題目都不得記為 solved（design v1 1.3） |
| 可信操作描述與連線即計時的接入 | 平台／目標 adapter 與 D 的受保護操作契約設計時 | 現行清單不帶操作描述、仍一律做 TCP 探測；本地反例確認準備階段確實會連線，因此不能宣稱對連線即計時的來源無副作用。需可信來源策略決定探測／啟動方式，不能由模型宣告安全或由 G 事後補救；責任與限制見 [G 第 4.5 節](2026-10-23-design-v1-g-solver-minimal.md#45-受保護操作的責任界面) |
| 解題子會話與題目的綁定 | G（design v1 第 3 節待決項） | Intake 以整個 run 為範圍，不需要 |

## 7. 實作與驗證記錄

2026-10-23 已按本文第 2–4 節實作並合併：題目清單與 run 準備在 `apps/launcher/src/challenges.ts`、`run-prep.ts`；兩個接入工具在 `apps/launcher/src/intake-tools.ts`，由控制服務在 `tool.before` 與 `tool.execute` 兩處核對角色與題目後執行。第 5 節的邊界判據均有定向測試（`tests/contract/run-prep.test.ts`、`intake-tools.test.ts`）。

| 結論 | 條件與關鍵觀察 |
| --- | --- |
| 題面拆為 `statement` 與 `statementFile` | 原為單一欄位，實作只能按字串內容猜測是文字還是路徑：純網址的題面會被當成路徑而拒絕啟動，含空白的路徑會被當成題面文字 |
| 插件註冊的工具受 per-agent 權限控制，並觸發 `tool.execute.before` | 零 token 運行，真實 OpenCode 1.19.3、本地確定性替身 provider，經 `launch()` 跑一輪：`intake` 的模型請求含兩個接入工具，`coordinator` 與 `recon` 的請求不含；兩次調用在審計中依序為 `tool.before`、`tool.execute`、`tool.after` 並返回預期內容。結論已記入 C design 第 8 節 |
| 帶真實題目的取題鏈端到端成立 | 真實模型冒煙（`deepseek-v4-1-flash-261017`，三道本地 Docker Web 題 mfw／throwback／seizure）：run 準備三題皆可達、材料已固定；Intake 經 `ctf_challenge_list`／`ctf_challenge_read` 讀到三題，Coordinator 分派解題角色；run 自然結束（40 次准入，約 7.65 萬 token，無 provider 錯誤，無憑據洩漏）。最小證據見 [`docs/gates/e-intake-smoke-20261023/REPORT.md`](../../gates/e-intake-smoke-20261023/REPORT.md) |

驗收層級到此為止：取題鏈成立，但被分派的解題角色尚無工具可用（待 design v1 G），冒煙中它們被分派後無法動手。

**已知限制：** 審計中 `tool.execute` 一筆不記工具名，只能經相鄰的 `tool.before` 對應；以同一個 `runId` 重跑被拒的 run 會因拒絕證據文件已存在而失敗（`runId` 預設隨機）。
