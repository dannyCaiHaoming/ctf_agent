# E 最小版：題目來源與 Intake 接入的實現計劃

記錄日期：2026-10-23（Asia/Tokyo）。

依據：[E 最小版詳細 design](../specs/2026-10-23-design-v1-e-intake-minimal.md)（下稱 E design）；[入口與本地調試詳細 design](../specs/2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）第 1、2 節；[C 詳細 design](../specs/2026-10-23-design-v1-c-control-service.md)（下稱 C design）第 5 節；[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.5、1.6。

本文是 §0 交接物。執行模型照 §0 做完、記錄結果後停下；後續步驟按本步結果重寫 §0。

---

## 這份 plan 要達成的能力

題目經運行配置進入一次 run：啟動器讀取題目清單，在啟動 OpenCode 前檢查題目環境並把材料固定進題目工作區；Intake 經列題與讀取材料兩個受管工具讀到題目（E design 第 2–4 節）。

完成時可陳述的層級（design v1 1.6）：**確定性工具接線**。真實模型驗證不在本 plan，待最小 G 接通後與首題一起進行（E design 第 5 節）。

---

## §0 當前這一步：題目清單與 run 準備

只做 E design 第 2、3 節：題目清單的載入與校驗，以及啟動 OpenCode 之前的環境檢查與材料固定。不做接入工具（第 4 節）。

### §0.1 執行模型與理由

**Sonnet 5.5。** 理由：要對著真實文件系統與網路寫代碼（路徑解析、realpath、符號連結、TCP 連線檢查、文件權限），並在 §0 範圍內做局部判斷（模組切分、錯誤訊息、超時預設值、證據文件結構）；不涉及跨組件接口或架構取捨，屬 CLAUDE.md 模型分工表第二類。

### §0.2 授權範圍

| 項目 | 範圍 |
| --- | --- |
| 程式修改 | 允許修改 `apps/launcher/src/launch.ts`、`apps/cli/src/composition/releaseProfile.ts`；允許在 `apps/launcher/src/` 新增題目清單與 run 準備所需的模組；允許在 `tests/` 新增或修改對應測試 |
| 配置 | 新增 `config/challenges.example.json`（一道離線題、行內題面，無 `target`）；在 `config/release-profile.volcano-coding.example.json` 加上 `challenges` 欄位指向它 |
| 刪除 | 不允許 |
| 真實模型調用 | 不允許（token 預算 0） |
| 網路 | 只允許測試中連到本機 `127.0.0.1` 上自己啟動或確認關閉的端口 |
| commit／push | 不允許 |
| 工作區 | 在自己的 worktree 中進行 |

### §0.3 要做的事

1. **release profile**：新增欄位 `challenges`（字串路徑），相對路徑相對於 release profile 文件所在目錄解析，與 `opencode.configPath` 同一做法。
2. **題目清單載入與校驗**：按 E design 第 2 節的欄位表與規則；只接受表中所列欄位，其他欄位拒絕。可達性檢查的超時可在清單層級配置，預設值由執行模型定並在報告說明。
3. **run 準備**：按 E design 第 3 節第 1–7 步，在啟動器建立運行資料目錄之後、`startManagedOpenCode` 之前執行。控制憑據掃描使用啟動器現有的秘密清單（provider 憑據與 RPC 傳輸憑據）。
4. **記錄**：材料的原始路徑與 sha256、可達性結果與檢查時間寫入 `evidence/`；拒絕啟動時，若運行資料目錄已建立，原因同樣寫入 `evidence/`。文件名與結構由執行模型定，報告中列出。
5. **範例配置**：§0.2 所列兩項。

### §0.4 行為判據

每條都要有定向測試；能在 `launch()` 層驗證的，在 `launch()` 層驗證。

1. **拒絕啟動**：以下每種情形都以 `blocked_configuration` 結束，且 OpenCode 沒有被啟動：
   - release profile 沒有 `challenges`、文件不存在、清單為空；
   - 清單含未知欄位；`id` 不合法或重複；
   - `statement`、`materials`、`target` 全缺；
   - 路徑不存在；`materials` 項是目錄或符號連結；
   - 檔名重複、與 `statement.md` 相同或以 `.` 開頭；
   - 材料或題面含控制憑據；
   - `target` 不可達。
2. **多題時一題失敗**：清單中一題合法、一題不合法時，整個 run 拒絕啟動，`workspace/` 下不留下供 OpenCode 運行的半成品（或明確記錄已建立的部分）。
3. **材料固定**：`workspace/<id>/materials/` 只含 `statement.md`（有題面時）與配置列出的材料，內容與來源逐字節一致，文件為唯讀。
4. **證據**：`evidence/` 中有每個材料的原始路徑與 sha256，以及每個 `target` 的可達性結果與檢查時間；不含任何控制憑據。
5. **可達性**：對本機已監聽的端口判為可達；對本機已確認關閉的端口在超時內判為不可達並拒絕啟動；檢查不送任何內容（以測試伺服器收到的位元組數為 0 驗證）。
6. **工作目錄邊界**：OpenCode 工作目錄不含任何題目材料；現有的 `.opencode/` 與非空工作目錄檢查行為不變。
7. **既有檢查**：`npm run typecheck`、`npm run build`、`npm test` 全部通過，不削弱或跳過既有測試。

### §0.5 禁做清單

- 不實作接入工具或任何受管工具；不改 `apps/opencode-plugin`、`apps/launcher/src/control-service.ts`、`apps/launcher/src/control-rpc.ts`、`product/`。
- 不實作 E design 第 6 節的任何延後項：不加結構化 scope、解包、交付工具、狀態讀取、oracle 欄位或跳過可達性檢查的開關。
- 不在配置或代碼中寫入任何秘密值。
- 不發起真實模型調用；不連接 `127.0.0.1` 以外的地址。
- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；不新建直連 provider 的求解循環，不維護 OpenCode fork。
- 不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench。
- 不刪除任何文件；不動其他會話進行中的工作與倉庫外資料。
- 驗收只陳述本步的確定性行為，不聲稱接入或解題能力。
- 不改任何 design、本文、`AGENTS.md`、`CLAUDE.md`；不 commit、不 push；跑完就停。

### §0.6 收尾報告

報告需含：
- 改動與新增的文件清單；
- 超時設定的名稱與預設值，以及證據文件的名稱與結構；
- §0.4 逐條結果與對應測試名稱；
- `npm run typecheck`、`npm run build`、`npm test` 的結果（測試文件數與測試數）；
- 實作中發現的 E design 未覆蓋或與代碼現狀不符之處（只記錄，不自行改 design）；
- `git status`。

---

## 後續步驟（只列標題，按本步結果重寫）

- **Intake 接入工具**：E design 第 4 節的列題與讀取材料兩個受管工具；含插件受管工具清單註冊、`opencode.json` 只對 `intake` 可見、控制服務執行許可（含可見性出錯時的定向測試），以及 E design 第 5 節其餘判據。
