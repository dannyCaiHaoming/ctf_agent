# design v1 A／B 詳細 design：產品運行資產包與原生 Skill

記錄日期：2026-10-22（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 2 節 A、B 的詳細 design 子文件；A、B 的細節以本文為準。本文只定義設計，不構成執行授權。

**依據：** 2026-10-22 兩次無模型實測：OpenCode 1.19.3（npm SDK／插件 1.19.0），經未修改的 `startManagedOpenCode` 與現行隔離旗標啟動，只用 loopback 替身 provider，token 0。第一步驗證產品資產的原生載入與題目同名文件（判據 J1–J8），第一步 b 驗證工作目錄 `.opencode/` 的插件／工具／命令與請求級 `directory`（判據 K1–K6）。兩份報告保存在 [`docs/gates/a0-assets-probe-20261022/`](../../gates/a0-assets-probe-20261022/REPORT.md)（[第一步](../../gates/a0-assets-probe-20261022/REPORT.md)、[第一步 b](../../gates/a0-assets-probe-20261022/REPORT-1b.md)）；報告內的 `evidence/` 原始證據未保留。下文以 J、K 編號引用；未經實測的推斷明確標註。

---

## 1. 產品資產目錄

倉庫根目錄新增 `product/`，集中全部產品運行資產；開發用 `AGENTS.md` 與 `CLAUDE.md` 留在根目錄，不進入 `product/`。`product/` 分兩層：與 Agent 底座無關的**共用層**，以及每個底座一個子目錄的**專屬層**。首版只有 OpenCode 一個底座，只建 `product/opencode/`；以後確需適配其他底座時再新增對應子目錄（例如 `product/codex/`），共用層不搬動。不預先實作把同一份內容轉成多種底座格式的組裝器。

| 路徑 | 層 | 內容 | 說明 |
| --- | --- | --- | --- |
| `product/AGENTS.md` | 共用 | 產品運行指令 | 共同運行約定，不複述角色正文、方法或知識（design v1 1.2）；`AGENTS.md` 是多個底座共認的指令文件名 |
| `product/skills/<name>/SKILL.md` | 共用 | Skill | Agent Skills 格式，frontmatter `name`、`description`（第 4 節） |
| `product/skills/<name>/references/` | 共用 | Skill 附屬短 Reference | 隨 Skill 發布，經 `skill` 返回的路徑讀取 |
| `product/references/<topic>/` | 共用 | 共用知識目錄 | 接法見第 4 節；首版可為空 |
| `product/opencode/agents/<role>.md` | OpenCode | 角色定義 | OpenCode agent 格式：frontmatter 至少 `description`、`mode`，正文即角色 prompt。Coordinator 為唯一 `primary`，其餘 `subagent`（J2）。角色文件清單按 design v1 第 1 節九項責任與 H 權限表在實作步驟確定，簡單職責可合併；不設單一 Solver 角色或任何過渡 Solver。各底座的角色格式不同，因此角色放專屬層 |
| `product/opencode/opencode.json` | OpenCode | 產品基礎 OpenCode 配置 | 只放靜態、非秘密的行為配置（停用內建 agent、權限基線、壓縮與輸出限制等）；不含 provider、model、憑據或任何運行時欄位 |

目錄命名：不在倉庫根目錄使用 `.opencode/`、`.codex/`、`.agents/`、`.claude/` 等底座約定目錄名存放產品資產。這些位置會被開發者在本倉庫使用的工具自動掃描（`.opencode/` 會被 OpenCode 載入角色並執行插件，見 K1–K3），使產品資產混入開發會話，違反開發與產品指令分開（design v1 第 1 節）；`product/` 及其子目錄不是任何底座的掃描點。

不放入 `product/`：provider／model 配置與憑據引用（留在 `config/` 的 release profile 與 OpenCode 配置，運行時注入）；控制層插件代碼（留在 `apps/opencode-plugin`，由宿主以 `plugin` 配置傳入）；任何 `plugin(s)/`、`tool(s)/`、`command(s)/` 目錄。

根目錄 `skills/web-session-diagnosis/` 在實作步驟移入 `product/skills/web-session-diagnosis/` 並補 frontmatter，根目錄 `skills/` 隨之刪除，不保留兩份。

鏡像對應（與 design v1 F 對齊，路徑名在 F 實作時定稿）：`product/` 隨鏡像發布到固定唯讀路徑；每次 run 的 OpenCode 工作目錄與題目工作區位於持久資料目錄，彼此分開（第 3 節）；工具提供方式見第 5 節。

## 2. 載入方式

**統一採「宿主複製到每次 run 的配置目錄」。** 啟動器已為每次 run 新建 `<工作目錄>/config/opencode/` 作 `OPENCODE_CONFIG_DIR`；宿主在啟動 OpenCode 前，按白名單把共用層與 `product/opencode/` 專屬層的內容複製進去，OpenCode 以原生機制載入副本。

| 資產 | 來源 | 複製到 | 原生機制 | 依據 |
| --- | --- | --- | --- | --- |
| 產品指令 | `product/AGENTS.md` | `<cfg>/AGENTS.md` | 配置目錄指令 | J4（CD） |
| 角色 | `product/opencode/agents/*.md` | `<cfg>/agents/*.md` | 配置目錄 agent 定義 | J2；角色沒有路徑配置，只能走配置目錄 |
| Skill（含附屬 Reference） | `product/skills/<name>/` | `<cfg>/skills/<name>/` | 配置目錄 Skill 發現 + 原生 `skill` | J3、J5、J7（CD／SK） |
| 基礎配置 | `product/opencode/opencode.json` | 與宿主運行時欄位合併後經 `OPENCODE_CONFIG_CONTENT` 注入 | 既有注入方式 | 現行啟動器 |

選擇理由：

- 一種機制覆蓋全部文檔資產；角色本來就只能走配置目錄。
- 每次 run 讀的是副本，運行中修改倉庫或鏡像源文件不影響進行中的 run；副本即本次 run 的固定版本。
- 不使用 `instructions` 載入產品指令，配置中 `instructions` 保持空陣列：配置目錄 `AGENTS.md` 與 `instructions` 同存會重複載入（第一步觀察項 `BOTH`）。
- 不使用 `skills.paths`：J3 證實其可用，但它讀源路徑而非副本，且引入第二條機制。

複製規則：

- 白名單只含上表四個來源；配置目錄內的 `plugin(s)/`、`tool(s)/`、`command(s)/` 一律不由產品資產產生（配置目錄與工作目錄根部 `.opencode/` 同屬原生掃描點，K1–K3 證實插件與工具會被執行）。共用層與專屬層出現同名目標時拒絕啟動，不做覆蓋。
- 複製後對每個副本計算 sha256，連同 `product/` 的來源版本（倉庫 commit 或鏡像 digest）寫入本次 run 的啟動記錄，取代現行 `method_material` 單項記錄。
- 啟動前沿用現行做法掃描副本，含控制憑據或 oracle 私有值即拒絕啟動。

退場：`apps/cli/src/commands/solveM1.ts` 讀取 `SKILL.md` 全文並塞入初始輸入、硬編碼並覆寫 Solver prompt 的做法，隨現行 SDK 編排入口與單一 Solver 角色一併退場（[入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md) 第 1 節）；角色 prompt 來自 `product/opencode/agents/`，運行約定來自 `product/AGENTS.md`；題目與動態事實經接入工具與控制服務提供，不寫入啟動訊息。內建 agent（`build`、`plan`、`general`、`explore` 等）沿用現行做法停用，移入 `product/opencode/opencode.json`。

## 3. 工作目錄與題目工作區分離（硬性邊界）

**事實（K1–K4、J6）：** 固定版本在 `OPENCODE_DISABLE_PROJECT_CONFIG=true` 等現行旗標下，仍載入 OpenCode 工作目錄根部 `.opencode/` 的角色、Skill 與命令，並在實例啟動時執行其中的插件與自訂工具模組；插件所在進程的環境變數包含 `OPENCODE_SERVER_PASSWORD`、`OPENCODE_CONFIG_CONTENT` 與 provider key 的 env 名。SDK 請求帶 `directory` 指向另一目錄時，該目錄 `.opencode/` 的插件同樣被執行。子目錄下的 `.opencode/` 不被載入；根部其餘同名文件（`AGENTS.md`、`CLAUDE.md`、`opencode.json`、`.claude/`、`.agents/`、`skills/`）不被載入。

**規則（不得以過濾或約定替代）：**

1. OpenCode 工作目錄由宿主為每次 run 新建，只含宿主寫入的內容（配置目錄及其中的產品資產副本），不放題目材料。
2. 題目材料、解包產物、Agent 寫入的文件與腳本輸出只存在於題目工作區，題目工作區不位於 OpenCode 工作目錄之內。
3. 宿主對 OpenCode 的全部 SDK 請求使用啟動時固定的工作目錄；不得以題目工作區或任何非宿主建立的目錄作請求 `directory`，有界 SDK 接線（design v1 C）同樣適用。
4. 啟動器在啟動 OpenCode 前檢查工作目錄：根部存在 `.opencode/`，或存在宿主未寫入的條目，即以 `blocked_configuration` 拒絕啟動。
5. Agent 的寫入能力（原生 `write`／`edit`、受管工作區寫入、腳本執行）不覆蓋 OpenCode 工作目錄；原生工具到達題目工作區只經限定該工作區路徑的 `external_directory` 規則或受管工具。

現行接法已符合規則 1–3 的結構（工作目錄 `out/.opencode-control/<runId>`，材料在 `out/workspaces/`），尚未有規則 4 的檢查。

**仍未驗證（在上述規則下不構成前置）：** 同一實例啟動後才在根部出現的插件是否被載入（K5 只覆蓋角色與 Skill）；K4 中 `W` 的角色與 Skill 為何未被載入；自訂工具被模型調用時的行為。原生 shell 的工作目錄與寫入範圍能否限制在題目工作區，屬 design v1 G 待決項，未定稿前不放行原生 shell。

## 4. Skill 與 Reference

**Skill：**

- frontmatter 必須含 `name`（與目錄名一致）與 `description`；缺 frontmatter 的 Skill 被靜默忽略（第一步觀察項 `EXNOFM`），宿主在複製時檢查並拒絕缺項 Skill，不依賴 OpenCode 報錯。只驗過 `name` 與目錄名一致的情形。
- 首個請求只帶 Skill 名稱、描述與位置，正文經原生 `skill` 按需載入（J5、J7）。
- 審核與版本：Skill 在 run 外審核後進入 `product/skills/`，版本由倉庫歷史與每次 run 的副本 hash 記錄；暫不依賴 frontmatter 的額外欄位（未驗證 OpenCode 是否接受）。

**Skill 附屬 Reference：** `skill` 返回 Skill 基準目錄與 `<skill_files>` 中的附屬文件絕對路徑，Agent 以原生 `read` 讀取；調用 `skill` 會自動放行該 Skill 目錄的讀取，不需額外 `external_directory` 規則（J7）。最小權限為 `skill: allow`、`read: allow`。

**共用知識目錄：** 固定版本的本地 `references` 配置被接受但無可觀察效果（第一步觀察項 `EXREF`），不作為載入路徑。共用知識以唯讀目錄發布，由宿主隨 run 提供到工作目錄之外的固定路徑，Agent 經限定該路徑的唯讀規則以原生 `read` 查閱；不建檢索服務、不在運行時拉取。具體路徑、唯讀限制方式與來源／版本記錄在共用 Reference 步驟定稿；首版先接通 Skill 附屬 Reference。

**與插件的關係：** 現行插件 `tool.execute.before` 拒絕全部非受管工具，包括 `skill` 與 `read`（遷移記錄 3.4）。目標是按 H 權限表放行：持有「知識讀取」能力的角色可用 `skill`，`read` 只限該 run 的 Skill 副本與共用知識目錄，以及經授權的題目材料。按角色核實身份依賴 C.1；`read` 的路徑限制由原生權限、插件或受管工具哪一層執行，依賴 design v1 第 3 節「接口的原生／受管映射」待決項。內建 Skill `customize-opencode` 會出現在列表中（J3），能否按名稱停用未驗證。

## 5. `rg` 依賴

OpenCode 安裝包不含 ripgrep；1.19.3 在需要時從 GitHub 下載 `ripgrep-15.1.0` 到自身數據目錄 `bin/`。啟動器每次 run 使用全新的臨時數據目錄並禁止運行時下載，因此宿主無 `rg` 時原生 `skill` 失敗（J7）。

按 [入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md) 第 4 節，啟動腳本不硬編碼工具檢查：本地調試由開發者在 run 外安裝 ripgrep（`brew install ripgrep`），記錄在開發文檔；鏡像內的提供方式在 Docker 打包時決定。OpenCode 優先使用 PATH 上的 `rg` 而不下載，是依其代碼的推斷，安裝後確認。

## 6. 未定稿項

| 項目 | 依賴 | 影響 |
| --- | --- | --- |
| 角色文件清單與各角色正文 | design v1 第 1 節、H；C.1 決定分派方式 | 第 1 節 `product/opencode/agents/` |
| 產品指令是否同樣作用於子會話 | [入口與本地調試詳細 design](2026-10-22-design-v1-entry-local-debug.md) 第 6 節的探針 | 第 2 節 |
| 插件按角色放行 `skill`／`read` 與路徑限制的執行層 | C.1；design v1 第 3 節原生／受管映射 | 第 4 節 |
| 原生 shell 的工作目錄與寫入範圍限制 | design v1 G 待決項 | 第 3 節規則 5 |
| 共用知識目錄的路徑、唯讀限制與來源記錄 | 共用 Reference 步驟 | 第 4 節 |
| 鏡像內 `product/`、工作目錄、題目工作區的具體路徑 | design v1 F | 第 1、3 節 |
| 內建 Skill 能否停用 | 未驗證 | 第 4 節 |
