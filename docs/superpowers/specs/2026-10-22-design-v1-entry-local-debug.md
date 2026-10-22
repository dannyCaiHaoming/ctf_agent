# design v1 詳細 design：產品入口與本地調試

記錄日期：2026-10-22（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.2 的詳細 design 子文件，涉及第 2 節 A、C、E；入口形態、文件分區與本地調試流程以本文為準。本文只定義設計，不構成執行授權。原列的兩項未知數已於 2026-10-22 的無模型探針驗證並定稿（第 6 節）。

**範圍：** 先做好本地調試入口，使其與發布後的運行方式一致；Docker 鏡像打包（design v1 F）暫不展開，本文只保證路徑劃分可直接映射到鏡像。

---

## 1. 運行形態

產品運行時無須人工輸入命令：啟動後按運行配置自動接題、做題、換題，結束後保存結果並退出。題目來源（平台或已接好的靶場、附件）由開發者在運行前修改運行配置決定。

**一個啟動腳本，本地調試與發布共用：**

1. 讀取運行配置（題目來源、模型 profile、預算）；秘密從運行時環境讀取（本地為 git 忽略的 `.env`）。
2. 為本次 run 建立運行資料目錄（第 2 節），把產品資產複製到 OpenCode 配置目錄（[A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md) 第 2 節）。
3. 在啟動腳本進程內啟動宿主控制服務（第 3 節）。
4. 以無頭方式啟動真實的 OpenCode CLI，讓 Coordinator 接收一則固定的啟動訊息後自主運行；啟動腳本不參與編排。
5. OpenCode 結束、預算或時間耗盡時，停止全部會話，保存結果與證據，退出。

**OpenCode 無頭啟動方式：`opencode serve` 加一次 SDK 啟動訊息。** 啟動腳本經 `startManagedOpenCode` 啟動 `opencode serve`，用 SDK 建立一個 Coordinator 會話並送出一則啟動訊息，之後只做三件事：等待根會話進入 idle、在預算或時限到達時停止全部會話、結束後讀取會話與訊息以保存結果。它不建立子會話、不轉發工具調用、不寫入任何後續提示詞，多 Agent 流程完全由 OpenCode 驅動。

不採用 `opencode run`：兩者都能完整跑完多 Agent 流程（探針 E1、E5），但 `run` 只能由進程退出判斷結束，且退出碼 0 不代表任務成功——子 Agent 失敗時退出碼仍為 0，失敗只出現在根會話 `task` 工具結果與 stderr（探針 E2、E3）。`serve` 可由 `session.idle` 取得準確完成時刻、逐一讀取根會話與子會話狀態，並在停止時先 `session.abort` 再保存狀態，符合第 1 節第 5 步與 design v1 1.4 的停止與保存要求。

**啟動訊息：** 不含題目內容的固定短句，隨產品資產發布；題目內容一律經 Intake 的接入工具取得（design v1 E）。

**權限：** 無頭運行時權限不得設為 `ask`——探針觀察到 `ask` 與外部目錄權限一律被自動拒絕，不等待回答，且會使該子 Agent 整個失敗（E2）。產品配置與插件須對每項能力明確 allow 或 deny。禁止使用 `--auto`。

**本地調試** 即在開發機執行同一啟動腳本，運行配置指向本地或授權的遠端靶場；不另設測試專用入口或測試專用 Solver（design v1 1.6）。

**角色：** 產品角色按 design v1 第 1 節九項責任（Coordinator、Intake/Triage、Target Recon、Reference、Strategy、Domain Solver、Solution Engineer、Verifier、Recovery Critic）定義，Coordinator 為發布入口的 primary Agent，其餘角色經原生多 Agent 分派。不設單一 Solver 角色，也不設任何過渡 Solver。

**退場（已執行）：** 舊 `ctf-agent solve`（`apps/cli/src/commands/solveM1.ts`、`openCodeTask.ts`）由宿主經 SDK 建立會話、寫入 prompt、綁定單一 Solver 並轉發工具回調，屬 design v1 1.2 所稱「硬編碼的 Agent 編排器」，連同其單一 Solver 角色與 Solver prompt 一併移除；其中可復用的宿主能力（候選封存、獨立驗證、oracle 提交等）按 design v1 D 遷入控制服務。`--trajectory` 本地 job 路徑及其硬編碼 fixture flag 屬測試專用 Solver，不遷移。上述入口、軌跡路徑及其專屬測試已於 2026-10-23 刪除；刪除後在控制服務按 design v1 C 實作完成前沒有可用的解題路徑。

## 2. 文件分區

開發、產品資產、運行配置與運行資料四類文件分開存放，任何一類都不出現在另一類的位置。

| 類別 | 位置 | 內容 | 規則 |
| --- | --- | --- | --- |
| 開發 | 倉庫根目錄與 `apps/`、`packages/`、`tests/`、`docs/` | 開發用 `AGENTS.md`、`CLAUDE.md`、源碼、測試、文檔 | 不被運行中的 OpenCode 讀取 |
| 產品資產 | `product/`（共用層 + `product/opencode/`） | 產品 `AGENTS.md`、角色、Skills、References、基礎 OpenCode 配置 | 只經啟動腳本白名單複製進入運行；不放運行配置、秘密或運行資料 |
| 運行配置 | `config/` | 題目來源、模型 profile、預算；`*.example.*` 入庫，開發者本地實際配置不入庫 | 不含秘密值，只含 env 引用名；不放產品指令或角色。模型 provider 暫定為火山引擎 token plan（使用者 2026-10-23 決定），apiKey 以 `{env:ARK_API_KEY}` 引用、值放本地 `.env`；需按 OpenCode 配置格式編寫，清理前的舊直連 provider 配置格式已不被接受，只沿用其端點與 env 名 |
| 秘密 | 運行時環境；本地為 `.env`（git 忽略） | 平台 token、provider key 等 | 不寫入任何文件或證據；平台憑據只進控制服務進程 |
| 運行資料 | 運行資料根目錄下 `<runId>/`，**位於倉庫之外** | 見下表 | 每次 run 新建；不在倉庫內、不在 `product/` 內 |

運行資料根目錄預設為 `~/.ctf-agent/runs/`，可由運行配置改為其他路徑，但必須位於倉庫與 `product/` 之外，啟動腳本對此檢查並拒絕倉庫內路徑。全部運行路徑在建立後解析為真實路徑（realpath）再交給 OpenCode：探針在 macOS 上觀察到工作目錄含符號連結時（`/var` → `/private/var`），OpenCode 把工作目錄內的文件判為外部目錄並拒絕讀取。理由：運行目錄若在 git 倉庫內，OpenCode 可能以倉庫根目錄作專案根，讀到開發用 `AGENTS.md` 或倉庫內其他文件；放在倉庫外即無此可能，不需另行驗證。現行 `solveM1` 預設的倉庫內 `runs/` 不沿用。

| `<runId>/` 下的子目錄 | 內容 |
| --- | --- |
| `opencode/` | OpenCode 工作目錄，只含宿主寫入的 `config/`（配置目錄與產品資產副本）、`data/`、`state/`、`cache/`；遵守 design v1 1.5 的工作目錄邊界 |
| `workspace/` | 題目材料、解包產物、Agent 寫入的腳本與文件；按題目分子目錄 |
| `state/` | 控制服務的運行狀態、預算帳本、可恢復記錄 |
| `evidence/` | 產物封存、候選與驗證證據、最終結果 |

## 3. 宿主控制服務

控制服務是產品中不交給模型、由程式確定性執行的部分。它在啟動腳本進程內運行，與 OpenCode 進程分開；OpenCode 內的產品插件經本地 RPC 調用它（沿用現有 `OpenCodeBridgeRpcServer` 的接法，具體是否復用在實現時判斷）。本地調試與發布使用同一控制服務，它不是調試監控工具，日誌與證據只是附帶產物。

- 職責：會話身份綁定、預算准入與計量、產物封存、候選登記與獨立驗證、平台／oracle 提交、停止與資源回收（design v1 1.2、D、H）。
- 平台憑據與 oracle 私有資料只存在於控制服務進程，不進入 OpenCode 的環境變數：OpenCode 進程內的插件可讀取其全部環境變數（A／B 詳細 design 第 3 節），因此只把模型調用必需的 provider 憑據交給 OpenCode。
- RPC 傳輸憑據由控制服務每次 run 隨機產生，經插件配置傳入。
- 不採用的做法：把控制服務寫在 OpenCode 插件內（平台憑據與 oracle 資料須進入 OpenCode 進程，該進程內任何被載入的插件都可讀取）；不設控制服務、由 Agent 自行提交與判定完成（違反 design v1 1.3、1.5、H）。

## 4. 工具與環境依賴

啟動腳本不硬編碼任何具體工具或版本檢查。

- 本地調試使用開發機 PATH 上已安裝的工具；OpenCode 自身依賴的外部程式（例如原生 `skill` 需要的 ripgrep）屬開發機環境準備，記錄在開發文檔，由開發者在 run 外安裝。
- 工具缺失時由該工具在被調用時明確返回缺能力錯誤（design v1 G），不由啟動腳本預設一份清單。
- 鏡像內預裝哪些工具、是否需要啟動前核對，在 Docker 打包時決定（design v1 F 與第 3 節待決項）。

## 5. 會話綁定與題目接入

- 根會話由啟動腳本經 SDK 建立，送出啟動訊息前即取得其 ID，因此可由宿主預先綁定；子會話由 OpenCode 原生 `task` 建立。根會話與子會話的身份綁定、預算准入與停止機制見 [C 詳細 design](2026-10-23-design-v1-c-control-service.md)。
- 一次 run 只啟動一個 OpenCode 實例，Coordinator 在同一 run 內處理多道題並共用預算（design v1 1.4）。
- Intake 經受管接入工具按運行配置取得題目；接入工具由控制服務提供，Agent 看不到平台憑據（design v1 E、H）。

## 6. 已驗證的前提

2026-10-22 無模型探針（真實 OpenCode 1.19.3、本地確定性替身 provider、token 0、五個場景、未使用 `--auto`）的結論，報告見 [`docs/gates/entry-headless-probe-20261022/REPORT.md`](../../gates/entry-headless-probe-20261022/REPORT.md)：

| 前提 | 結論 | 依據 |
| --- | --- | --- |
| 多 Agent 流程完整運行 | 成立。單一與並行子會話都在全部完成、Coordinator 收尾後才結束；`serve` 下只送一次 SDK 訊息即跑完整個流程，完成時刻由 `session.idle` 判斷 | E1、E5 |
| 產品 `AGENTS.md` 作用於子會話 | 成立。經原生 `task` 建立的子會話，其系統訊息均含產品指令，且只含自身角色標記。共同約定只寫在產品 `AGENTS.md`，不在每個角色定義中重複 | E4 |
| 權限詢問行為 | 無頭運行時 `ask` 被自動拒絕並使該子 Agent 失敗（見第 1 節「權限」） | E2 |
| 結果狀態判讀 | `run` 的退出碼不足以判斷任務成功（見第 1 節不採用 `run` 的理由） | E3 |
| 隔離環境 | 探針以 `startManagedOpenCode` 的旗標清單運行，配置目錄的角色與 `AGENTS.md` 均被載入，內建 agent 停用有效，無額外模型請求 | E6 及報告第 6 節 |

探針未覆蓋：分鐘至小時級的長時間運行（最長單場景約 16 秒）；OS 層的對外連線抓包（無外部請求由代理設定、隔離旗標與替身日誌推斷）。

## 7. 與其他文件的關係

- 產品資產目錄與載入方式：[A／B 詳細 design](2026-10-22-design-v1-ab-product-assets.md)；其中「啟動器檢查 `rg`」已按本文第 4 節改為不由啟動腳本硬編碼。
- 本文已定稿，依次生成：啟動腳本與控制服務的框架實現 plan、現行 `solveM1` 編排與測試專用路徑的精簡 plan。多 Agent 綁定機制見 [C 詳細 design](2026-10-23-design-v1-c-control-service.md)。
