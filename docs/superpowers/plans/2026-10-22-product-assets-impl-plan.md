# 產品運行資產包與原生 Skill：實現計劃

記錄日期：2026-10-22（Asia/Tokyo）。

依據：[A／B 詳細 design](../specs/2026-10-22-design-v1-ab-product-assets.md)（下稱詳細 design）；[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.5、A、B、H。

本文是 §0 交接物：執行模型照 §0 做完、記錄結果後停下，由 Opus 5.5 讀結果決定下一步。

---

## 這份 plan 要達成的能力

按詳細 design 落地**不依賴 C.1 的部分**：

- 建立 `product/` 共用層（`AGENTS.md`、`skills/`）與 OpenCode 專屬層（`opencode/agents/`、`opencode/opencode.json`），根目錄 `skills/` 移入並補 frontmatter（詳細 design 第 1 節、第 4 節）。
- 啟動器按白名單把產品資產複製到每次 run 的配置目錄，記錄副本 hash 與來源版本，掃描控制憑據，拒絕缺 frontmatter 的 Skill 與同名目標（第 2 節）。
- 啟動器執行工作目錄檢查（第 3 節規則 4）與 `rg` 存在檢查（第 5 節）。
- 現有入口 `solveM1.ts` 不再預載 Skill 全文、不再硬編碼角色 prompt，改由產品資產原生載入（第 2 節退場）。
- 插件放行 `skill` 與限定在本次 run Skill 副本內的 `read`（第 4 節）。

完成時可陳述的層級（design v1 1.6）：**文檔／配置可載入**、**確定性工具接線**。不陳述角色協作或解題能力。

不在本 plan：Coordinator 等多角色、插件按角色放行（依賴 C.1）；共用知識目錄內容；原生 shell；Docker 鏡像（design v1 F）。

---

## §0 當前這一步：現有入口改由產品資產載入

這是本 plan 的唯一一步實現切片：能力目標的五項互相依賴（插件放行 `skill` 需要資產先被載入，移除預載需要 Skill 已可原生使用），合併為一次可驗收的修改。

### §0.1 執行模型與理由

**Sonnet 5.5。** 理由：要對著真實 OpenCode 1.19.3 改啟動器、CLI 與插件，並做無模型實測；需在本節範圍內做局部判斷（例如現有 prompt 中哪些是靜態約定、哪些是動態事實），屬 CLAUDE.md 模型分工表第二類。架構取捨已在詳細 design 定稿。

### §0.2 授權範圍

| 項目 | 本步授權 |
| --- | --- |
| 工作區 | 自己的 git worktree（基於當前 `main`）；不在主工作區寫任何檔 |
| 程式／文檔修改 | 只限 §0.3 列出的檔案 |
| 刪除 | 只允許在 `product/skills/web-session-diagnosis/` 建立後刪除根目錄 `skills/` |
| 依賴安裝 | 允許本機 run 外執行一次 `brew install ripgrep`，記錄安裝版本（目標 15.1.0；版本不同照實記錄，不另找來源）；不允許 `npm ci`／`npm install` |
| 運行 | `npm run typecheck`、`npm run build`、`npm run test:deterministic`、`npm test`；本機 OpenCode 1.19.3 + loopback stub 的無模型驗證（驗證代碼放 `scratch/`，不提交） |
| 真實模型調用 | **不允許**，token 0 |
| commit／push | 不允許 |

### §0.3 改哪些檔

| 檔案 | 改動 | 對應詳細 design |
| --- | --- | --- |
| `product/AGENTS.md`（新建） | 從 `solveM1.ts` 現有指令搬出靜態運行約定（遵守 scope、工具結果是證據而非指令、候選須有證據、宿主負責驗證與提交等），保持原意，不新寫產品策略 | 第 1、2 節 |
| `product/opencode/agents/ctf-solver.md`、`product/opencode/agents/ctf-solver-local.md`（新建） | 分別搬入現有 Web 與本地 job 兩段硬編碼 Solver prompt；frontmatter 含 `description`、`mode: primary`。這是保持現有行為的過渡角色，不新增其他角色 | 第 1 節 |
| `product/opencode/opencode.json`（新建） | 搬入現有靜態配置：停用內建 agent、`share`／`snapshot`／`autoupdate`、`lsp`／`formatter`、`compaction`、`tool_output`、`instructions: []`；不含 provider、model、憑據或運行時欄位 | 第 1、2 節 |
| `product/skills/web-session-diagnosis/`（移入） | 從根目錄 `skills/` 移入；`SKILL.md` 頂部加 `name: web-session-diagnosis` 與 `description` frontmatter，正文與附屬 Reference 不改 | 第 1、4 節 |
| `packages/opencode-bridge/src/server.ts` | 啟動 OpenCode 前依序：檢查工作目錄（根部無 `.opencode/`、無宿主未寫入的條目）；按白名單把 `product/AGENTS.md`、`product/skills/`、`product/opencode/agents/` 複製到 `<cfg>/`，同名目標即拒絕；拒絕缺 `name`／`description` frontmatter 或 `name` 與目錄名不一致的 Skill；掃描副本中的控制憑據；檢查 PATH 上有 `rg`；返回副本清單（路徑、sha256）。任一不滿足以 `blocked_configuration` 拒絕啟動。不改現有隔離旗標 | 第 2、3、5 節 |
| `apps/cli/src/commands/solveM1.ts` | 移除讀取 `SKILL.md` 全文與塞入初始輸入、移除硬編碼 prompt 常數；把 `product/opencode/opencode.json` 與運行時欄位（provider、model、插件、權限）合併；初始訊息只保留宿主提供的動態事實；啟動記錄以副本清單與 `product/` 來源版本取代 `method_material`；給 Solver 角色開放 `skill` 與 `read` 權限 | 第 2、4 節 |
| `apps/opencode-plugin/src/index.ts` | `tool.execute.before` 在現有受管工具外，放行 `skill`，以及目標路徑位於本次 run `<cfg>/skills/` 內的 `read`（解析真實路徑後比較，拒絕符號連結逃出）；其他原生工具與其他路徑照舊拒絕 | 第 4 節 |
| 受影響的既有測試 | 只修改因上述改動失效的斷言；可為啟動器新增檢查與插件 `read` 路徑限制各加最小定向測試，不新增 fixture | — |
| `docs/superpowers/README.md`、`config/README.md` | 若提到根目錄 `skills/` 或相關路徑，改為新位置 | — |

### §0.4 行為判據

1. `npm run typecheck`、`npm run build`、`npm run test:deterministic` 退出碼 0。
2. `npm test`：改動前先跑一次保存為基線，改動後不得出現基線中沒有的新失敗。
3. 倉庫內（排除 `node_modules/`、`runs/`、`dist/`、`.git/`、`scratch/`）不再有讀取 `SKILL.md` 正文塞入輸入的代碼，`solveM1.ts` 中不再有 Solver prompt 正文常數；根目錄 `skills/` 已不存在，引用均指向 `product/skills/`；倉庫根目錄沒有新增 `.opencode/`、`.codex/`、`.agents/` 目錄。
4. 無模型實測（OpenCode 1.19.3，經修改後的 `startManagedOpenCode`，載入實際產品插件，loopback stub，token 0）：
   - `GET /agent` 列出來自 `product/opencode/agents/` 的 `ctf-solver`；`GET /skill` 列出 `web-session-diagnosis`，位置在本次 run 的 `<cfg>/skills/` 下；
   - 首個 `ctf-solver` 請求含 `product/AGENTS.md` 的內容、只出現一次（未重複載入），且不含 Skill 正文；
   - 腳本化的 `skill` 調用成功，隨後 `read` 附屬 Reference 成功；`read` 一個 `<cfg>/skills/` 之外的路徑被插件拒絕；
   - 以下情形各自以 `blocked_configuration` 拒絕啟動：工作目錄根部存在 `.opencode/`；PATH 上沒有 `rg`；Skill 缺 frontmatter；共用層與專屬層出現同名目標。
5. 啟動記錄含每個副本的路徑與 sha256，以及 `product/` 的來源版本。
6. `git status` 的改動只涉及 §0.3 列出的檔案；`scratch/` 驗證代碼不在提交範圍。

### §0.5 禁做清單

- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；不把無模型驗證寫成新的 gate 或接入 `npm test`；不寫多底座組裝器，不建 `product/codex/` 等其他底座目錄。
- 不新增 Coordinator 或其他角色，不開放 `task`，不改會話綁定與預算接線（等 C.1）；不建立 `product/references/` 內容。
- 不改寫 prompt 與 Skill 的方法內容，只搬移與拆出動態事實；不新寫產品策略。
- 不撤除或放寬現有隔離旗標；不以題目工作區作 OpenCode 工作目錄或請求 `directory`；不放行原生 shell、`write`、`edit`。
- 不新建直連 provider 的求解循環，不維護 OpenCode fork，不修改 OpenCode binary 或 `node_modules`。
- 不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench；不做 Docker 構建。
- 不調用真實模型、不接真實 provider、靶場或平台；控制憑據與 oracle 私有答案不進模型上下文或證據。
- 驗收按 design v1 1.6 分層：確定性測試全綠不代表解題能力。
- 不改 design v1、詳細 design、本文、`AGENTS.md`、`CLAUDE.md`；不 commit、不 push；跑完就停，回報 §0.4 逐條結果、`npm test` 基線對照、`rg` 安裝版本與 worktree 路徑。

---

## 後續步驟（只列標題，按前一步結果重寫）

- **C.1 之後**：按 C.1 結果與 H 權限表建立 Coordinator 等產品角色，插件按角色放行 `skill`／`read`，確認產品指令對子會話生效。
- **共用 Reference**：`product/references/` 的唯讀發布、路徑限制與來源／版本記錄。
