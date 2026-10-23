# E 最小版：題目來源與 Intake 接入的實現計劃

記錄日期：2026-10-23（Asia/Tokyo）。

依據：[E 最小版詳細 design](../specs/2026-10-23-design-v1-e-intake-minimal.md)（下稱 E design）；[C 詳細 design](../specs/2026-10-23-design-v1-c-control-service.md)（下稱 C design）第 2、5 節；[入口與本地調試詳細 design](../specs/2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）第 1 節；[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.2、1.5、1.6。

本文是 §0 交接物。執行模型照 §0 做完、記錄結果後停下；後續步驟按本步結果重寫 §0。

---

## 這份 plan 要達成的能力

題目經運行配置進入一次 run：啟動器讀取題目清單，在啟動 OpenCode 前檢查題目環境並把材料固定進題目工作區；Intake 經列題與讀取材料兩個受管工具讀到題目（E design 第 2–4 節）。

完成時可陳述的層級（design v1 1.6）：**確定性工具接線**。真實模型驗證不在本 plan，待最小 G 接通後與首題一起進行（E design 第 5 節）。

---

## §0 當前這一步：Intake 的兩個接入工具

只做 E design 第 4 節：列出題目與讀取材料兩個受管工具，以及 E design 第 5 節中與工具相關的判據。題目清單與 run 準備已在第一步完成（見本文末「已完成步驟」），本步直接使用其結果。

### §0.1 執行模型與理由

**Sonnet 5.5。** 理由：接線方式已由 C design 第 5 節定好（插件註冊、`opencode.json` 可見性、控制服務執行許可），本步按此實作；需要對著真實 OpenCode 確認一項運行時事實（§0.3 第 5 點），並在範圍內做局部判斷（工具名、分頁大小、返回結構）。不涉及新的架構取捨，屬 CLAUDE.md 模型分工表第二類。

### §0.2 授權範圍

| 項目 | 範圍 |
| --- | --- |
| 程式修改 | 允許修改 `apps/opencode-plugin/src/index.ts`、`apps/launcher/src/control-service.ts`、`apps/launcher/src/launch.ts`、`apps/launcher/src/run-prep.ts`；允許在 `apps/launcher/src/` 新增接入工具所需的模組；允許在 `tests/` 新增或修改對應測試 |
| 產品配置 | 允許修改 `product/opencode/opencode.json`，只限於讓兩個接入工具對 `intake` 可見、對其他角色不可見 |
| 零 token 確認 | 允許在倉庫外的臨時目錄，用本地確定性替身 provider 經 `startManagedOpenCode` 跑真實 OpenCode，確認 §0.3 第 5 點；替身與腳本不入庫 |
| 刪除 | 不允許 |
| 真實模型調用 | 不允許（token 預算 0） |
| commit／push | 不允許 |
| 工作區 | 在自己的 worktree 中進行 |

### §0.3 要做的事

1. **工具定義**：在插件的受管工具清單中加入「列出題目」與「讀取材料」兩個工具，名稱由執行模型按現有命名方式定（例如 `challenge.list`、`challenge.read`）。工具描述要準確說明用途與參數，不沿用現有那句針對工作區工具的通用描述。
2. **啟動器接線**：`launch.ts` 把這兩個工具名傳入插件的 `tools` 清單；`prepareRun` 的結果（每題的 id、title、target、可達性檢查時間、材料名稱與 sha256、`materials/` 目錄）交給控制服務。
3. **可見性**：`product/opencode/opencode.json` 只在 `intake` 角色對這兩個工具設 allow，其他角色維持 deny。
4. **執行許可與執行**：控制服務在 `tool.before` 與 `tool.execute` 兩處都核對「綁定的會話角色為 `intake`」與「題目 `id` 屬於本 run」，通過後在宿主側執行：
   - **列出題目**：返回 E design 第 4 節表中的欄位；不返回宿主絕對路徑。
   - **讀取材料**：路徑限於該題 `materials/`，拒絕越界、絕對路徑與符號連結；文字返回內容，二進位返回大小與開頭簽名（沿用 `packages/runtime` 中 `readText` 的語義）；大文件分頁，返回續讀游標。每頁上限由執行模型定，須低於 `opencode.json` 的 `tool_output.max_bytes`，並在報告說明。
5. **運行時確認（零 token）**：C design 第 5 節假設插件註冊的工具與原生工具一樣受 per-agent 權限控制，並觸發 `tool.execute.before`；此前探針只驗證過原生工具。用本地替身 provider 跑真實 OpenCode，確認三件事：
   - `intake` 會話能看到並調用兩個工具，`tool.execute.before` 收到的工具名是什麼；
   - 其他角色（至少 `coordinator` 與 `recon`）的模型請求中不含這兩個工具；
   - 調用經控制服務執行並返回結果。
   結果與觀察寫進報告。若與假設不符，停下報告，不自行改變接線方式。

### §0.4 行為判據

1. **角色限制**：非 `intake` 角色調用兩個工具時，`tool.before` 與 `tool.execute` 都被控制服務拒絕；要有一個測試直接以非 `intake` 綁定調用 `tool.execute`，模擬可見性設定出錯（E design 第 5 節）。
2. **題目限制**：不屬於本 run 的題目 `id` 被拒。
3. **路徑邊界**：`..` 越界、絕對路徑、符號連結（包括指向 `materials/` 之外的連結）一律被拒；兩個工具都不提供任何寫入，調用後 `materials/` 的內容與 hash 不變。
4. **讀取**：文字文件返回逐字內容；二進位返回大小與簽名；超過每頁上限的文件分頁返回，按游標續讀可拼回原文，最後一頁標明結束。
5. **列題**：返回每題的 id、title、target（無則為「無網路目標」）、可達性檢查時間、材料清單與 sha256，與 `evidence/challenges.json` 一致；返回內容中沒有宿主絕對路徑或任何控制憑據。
6. **可見性配置**：`opencode.json` 中只有 `intake` 對兩個工具為 allow；有測試檢查這一點。
7. **運行時確認**：§0.3 第 5 點的三項觀察均成立，報告附上關鍵記錄（工具名、各角色請求中的工具清單、執行結果）。
8. **既有檢查**：`npm run typecheck`、`npm run build`、`npm test` 全部通過，不削弱或跳過既有測試。

### §0.5 禁做清單

- 不擴展原生 `read` 的範圍（E design 第 4 節）；不改 C design 規定的綁定、分派與預算行為。
- 不實作 E design 第 6 節的任何延後項：不加結構化 scope、解包、交付工具、任務狀態讀取、oracle、跳過可達性檢查的開關。
- 不註冊或放行其他受管工具（現有清單中的 `workspace.*`、`job.run`、`http.request` 等不在本步）。
- 不改 `product/` 下除 `opencode/opencode.json` 以外的文件，包括角色定義與產品 `AGENTS.md`。
- 不發起真實模型調用；零 token 確認只用本地替身，替身與腳本不入庫。
- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；不新建直連 provider 的求解循環，不維護 OpenCode fork。
- 不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench。
- 不刪除任何文件；不動其他會話進行中的工作與倉庫外資料（臨時目錄除外）。
- 驗收只陳述確定性工具接線，不聲稱 Intake 能據此做題或解題能力。
- 不改任何 design、本文、`AGENTS.md`、`CLAUDE.md`；發現 design 未覆蓋或與代碼不符之處只寫進報告。不 commit、不 push；跑完就停。

### §0.6 收尾報告

報告需含：
- 改動與新增的文件清單；
- 兩個工具的名稱、參數與返回結構，每頁上限與游標格式；
- §0.4 逐條結果與對應測試名稱；
- §0.3 第 5 點的運行時確認結果與關鍵記錄；
- `npm run typecheck`、`npm run build`、`npm test` 的結果（測試文件數與測試數）；
- 實作中發現的 E design 或 C design 未覆蓋、或與代碼現狀不符之處；
- `git status`。

---

## 已完成步驟

### 第一步：題目清單與 run 準備（2026-10-23，合併於 `f78d9a5`）

- **實作：**
  - `apps/launcher/src/challenges.ts` 載入並校驗題目清單；
  - `apps/launcher/src/run-prep.ts` 在 `startManagedOpenCode` 之前完成憑據掃描、TCP 可達性檢查與材料固定；
  - release profile 新增 `challenges` 欄位；
  - 範例為 `config/challenges.example.json`。
- **證據：**
  - `evidence/challenges.json` 記錄材料來源、sha256 與可達性結果；
  - 被拒時另寫 `evidence/run-prep-rejection.json`。
- **超時：** 清單層級的 `reachabilityTimeoutMs`，預設 3000 ms。
- **驗證：** `tests/contract/run-prep.test.ts` 共 13 個測試；全套 31 個測試文件、193 個測試通過。
- **轉入 design 的結論：** 題面原為單一欄位，實作只能猜測字串是文字還是路徑；已在 E design 改為 `statement` 與 `statementFile` 兩個欄位。
- **遺留，暫不處理：** 以同一個 `runId` 重跑被拒的 run 會因拒絕證據文件已存在而失敗；`runId` 預設隨機，平常不會遇到。

---

## 後續

本步完成後，E design 第 2–5 節全部接通，本 plan 的結論轉入 E design 後即刪除。首題的真實模型驗證待最小 G 接通後另立 plan。
