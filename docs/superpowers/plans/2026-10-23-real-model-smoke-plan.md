# 真實模型冒煙：實現計劃

記錄日期：2026-10-23（Asia/Tokyo）。

依據：[入口與本地調試詳細 design](../specs/2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）第 1–3 節；[C 詳細 design](../specs/2026-10-23-design-v1-c-control-service.md)（下稱 C design）第 3–6 節；[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.4、1.6。

本文是 §0 交接物：**§0.2 的授權須由使用者確認後才可執行**。執行模型照 §0 做完、記錄結果後停下。

---

## 這份 plan 要達成的能力

用真實模型經同一調試入口跑一輪，確認控制服務在真實 provider 下的行為：會話綁定、逐次模型調用准入、`maxOutputTokens` 上限、用量計量、時限與預算停止，以及產品資產的載入。

**不是解題測試。** 目前沒有題目來源與 Intake 接入工具（待 design v1 E），也沒有受管工具（待 G、D）。啟動訊息要求 Coordinator 經 Intake 取得題目，預期結果是 Coordinator 發現沒有題目來源並結束；它可能用原生 `task` 分派子角色，也可能不分派。兩種都可接受，報告如實記錄。

完成時可陳述的層級（design v1 1.6）：**確定性工具接線在真實模型下成立**。不陳述角色協作效果或解題能力。

---

## §0 當前這一步：一輪真實模型冒煙

### §0.1 執行模型與理由

**Sonnet 5.5。** 理由：要按 OpenCode 格式編寫 provider 配置並對著真實 provider 排查配置錯誤（端點、協議適配器、輸出上限），屬 CLAUDE.md 模型分工表第二類；運行本身不需要架構判斷。

### §0.2 授權範圍（**待使用者確認**）

| 項目 | 提案值 | 說明 |
| --- | --- | --- |
| provider | 火山引擎方舟 Coding Plan，OpenAI 兼容端點 `https://ark.cn-beijing.volces.com/api/coding/v3` | 使用者 2026-10-23 決定的接入方式；此端點與下列模型曾於 2026-10-21 經 OpenCode 1.19.3 完成真實調用 |
| 模型 | `deepseek-v4-1-flash-261017` | 上次經 OpenCode 跑通的模型；若使用者指定其他 Coding Plan 支持的模型，以使用者為準 |
| 憑據 | 本地 `.env` 的 `ARK_API_KEY`，配置中只寫 `{env:ARK_API_KEY}` | 值不進任何文件、證據或模型上下文 |
| 套餐使用條款 | 方舟官方文件記載 Coding Plan 額度限 AI 編程工具使用；使用者曾於 2026-10-17 明確授權本項目使用此憑據 | **請使用者再次確認本次使用** |
| 批次 | 1 次 run | 不自動重跑；見 §0.3 第 6 點 |
| 模型調用上限 | 12 次（`maxSteps`） | 控制服務逐次准入，第 13 次被拒並停止全部會話 |
| 可觀察 token 上限 | 80,000（`maxObservableTokens`，input + output + reasoning 合計） | 在途回應可能越過門檻（design v1 1.4），最壞情況再加一次回應的輸出上限 8,000，即約 88,000 |
| 單次輸出上限 | 8,000 tokens（模型配置的 `limit.output`） | 插件取該值與控制服務剩餘額度的較小者 |
| 時限 | 300 秒（`wallClockMs`） | 到期由控制服務先標記後 abort 全部會話 |
| 運行位置 | 開發機本地，運行資料在倉庫外 `~/.ctf-agent/runs/` | 依入口 design 第 2 節 |
| 程式修改 | 不允許修改任何已追蹤的產品代碼；只新增兩份配置（§0.3 第 1 點） | |
| 靶場／平台 | 不接 | |
| commit／push | 不允許 | |

### §0.3 做法

1. **新增配置**（不含任何秘密值）：
   - `config/opencode.volcano-coding.example.json`：provider 指向上表端點與模型，`apiKey` 為 `{env:ARK_API_KEY}`，模型 `limit.output` 為 8,000，`limit.context` 按模型實際值；協議適配器只能是 `startManagedOpenCode` 允許的 `@ai-sdk/openai` 或 `@ai-sdk/openai-compatible`，選哪個由執行模型按端點實測決定並在報告說明。
   - `config/release-profile.volcano-coding.example.json`：引用上述配置，`budget` 按 §0.2：`maxSteps: 12`、`maxObservableTokens: 80000`、`wallClockMs: 300000`。
2. **零 token 預檢**：先用 loopback 替身代替 provider，以同一 release profile 的其餘設定跑一次 launcher，確認配置可載入、控制服務與插件正常；預檢不呼叫火山端點。
3. **正式運行**：在倉庫根目錄執行 `npx tsx apps/launcher/src/launch.ts --profile config/release-profile.volcano-coding.example.json`（launcher 會讀入本地 `.env`），只運行一次。
4. **保存證據**：launcher 已寫出的 `evidence/`（綁定、准入、審計、會話、用量）與 `state/run.json`；另把各會話的 assistant 訊息文本摘要寫入報告（不含任何憑據）。
5. **核對**：按 §0.4 逐條比對證據。
6. **重跑規則**：只有在失敗的那次運行**准入次數為 0**（即沒有任何模型請求發出、沒有消耗 token）時，允許修正配置後再試，最多 2 次，並在報告中逐次記錄；只要有任何一次准入，就不得再運行，停下報告。

### §0.4 行為判據

1. **配置載入**：`GET /agent` 列出九個產品角色、Coordinator 為 primary；`GET /skill` 列出 `web-session-diagnosis`；根會話系統訊息含產品 `AGENTS.md`。
2. **綁定**：根會話在第一次模型請求前綁定為 `coordinator`；若有子會話，每個都在其第一次模型請求前綁定，記錄含 SDK 返回的 `parentID` 與 `agent`。
3. **准入**：准入次數等於 OpenCode 中 assistant 訊息數（逐條對應會話）；准入次數 ≤ 12。
4. **輸出上限**：沒有因 `maxOutputTokens` 超過模型上限而產生的 provider 錯誤；若出現，原文記錄並視為不通過。
5. **用量**：記錄 provider 回報的 usage（input、output、reasoning），按會話歸屬；不可得記 `unavailable`；若因停止而中止，run 合計標為下限。報告寫明實際消耗的 token 合計。
6. **停止**：run 以「Coordinator 自行結束」、「預算停止」或「時限停止」三者之一結束，`run.json` 的 `stopReason` 與之一致；停止後無新請求。
7. **秘密**：`evidence/`、`state/`、報告中不含 `ARK_API_KEY` 的值、RPC 傳輸憑據或 server password（逐一 grep 核對）。
8. **代碼未改**：`git status` 只顯示新增的兩份配置與 `scratch/`（若有）。

### §0.5 禁做清單

- 只運行一次正式 run；准入次數大於 0 之後不得重跑，不得為「再看看」追加運行。
- 不修改 `apps/`、`packages/`、`product/` 或任何已追蹤文件；不為讓運行通過而改控制服務、插件或預算規則。
- 不提高 §0.2 的任何預算值；不切換 provider 或模型，除非使用者在確認時指定。
- 不接靶場、平台或任何題目；不安裝依賴；不使用 `ask` 或 `--auto`。
- `ARK_API_KEY` 的值不寫入任何文件、證據、報告或模型上下文；不在命令列參數中出現。
- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench。
- 驗收只陳述「確定性工具接線在真實模型下成立」，不聲稱角色協作效果或解題能力。
- 不改任何 design、本文、`AGENTS.md`、`CLAUDE.md`；不 commit、不 push；跑完就停。

### §0.6 收尾報告

報告需含：實際使用的端點、適配器、模型與配置的 sha256；零 token 預檢結果；正式運行的時間線（綁定、每次准入、停止）；§0.4 逐條結果與證據位置；實際消耗的模型調用次數與 token 合計（標明是否為下限）；Coordinator 與子角色的行為摘要（如實，不評價解題能力）；任何錯誤原文；重跑記錄（若有）；`git status`。

---

## 後續步驟（只列標題，按本步結果重寫）

- **design v1 E 最小版**：運行配置中的題目來源（本地靶場與附件優先）與 Intake 接入工具。
- **受管工具首批**：按 G 與 D 接上工作區讀寫、HTTP 與候選登記。
