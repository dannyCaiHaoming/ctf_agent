# 固定決策點診斷：離線核對計畫

依據：[固定決策點診斷 §3.1](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md#31-離線核對不用模型工程-session-可做)。類型：驗證 plan，不是產品實施授權。

## 0. 目標、範圍與授權

- **目標：** 用既有 run 證據與實作，回答 Q1（沒看到）、Q4（承接）與兩個計數問題（假設升級是否附新依據、交回與條目是否一致）；整理 Q3–Q6 的合成案例與預期判斷；查清模型對照的執行方式甲需要哪些既有接口。
- **範圍：** 有工作簿的 13 個 run——`workbook-runtime-20261112`（r1–r3）、`workbook-smoke-20261116`、`workbook-paired-20261117` 開啟組 6 個、`runtime-diag-20261117` 與 `-r2` 共 3 個，都在 `/Users/caihaoming/Documents/pentest-agent-run-data/`。關閉組沒有工作簿，不納入。
- **完成條件：** 設計 §5 的離線驗收：每個決策點有結構化記錄，各問題有答案或 unknown 並附證據位置，合成案例有預期判斷。
- **授權來源：** 用戶 2026-11-18「按此寫入」確認方向；本計畫只做離線分析。禁止模型呼叫、題目服務存取、請求重放、題目腳本、產品資產修改、commit／push。

## 1. 工作安排

| 步驟 | 操作與位置 | 判據 |
| --- | --- | --- |
| 決策點清單 | 從各 run 的 `evidence/control-audit.json` 取 Solver／Coordinator 的 `task` 派單（含有無 `task_id`）、`task.completion` 的 childID、`ctf_recon_note` 寫入；從 `runs/experience.sqlite` 取帶 slot 的 decision 與 `supersedes` | 每個 run 列出假設寫入／升級、交回、派單三類決策點，帶分鐘數與 id |
| Q1 呈現 | 用 `context.presented` 的 `workbook.included_ids`／`omitted_ids`，核對每次派單與升級時，相關條目與 ref 是否在該角色當時的上下文中；Coordinator 側另記假設是否缺 ref（現行實作本來不給） | 每個決策點標出「已呈現／被省略／設計上不給」 |
| 升級依據 | 對每次 hypotheses 升級為 supported，比較新條目與被取代條目的 `evidence_refs` | 計數：附新 ref、只沿用舊 ref、無 ref |
| 交回與條目一致 | 對每次 Solver 交回，取交回文字與該輪最後寫入條目的關鍵詞布林值（歸因、並列、保留措辭），只看是否一致 | 計數：一致、交回比條目保守、交回比條目確定；不輸出原文 |
| Q4 續接 | 依派單有無 `task_id` 分組，比較下一輪是否沿用、改寫或忽略上一輪條目；記錄新建任務時派單是否寫明原因 | 分組計數，樣本少時標 unknown |
| 接口核對 | 對照團隊決策 §6.1 白名單、`apps/launcher/src/workbook.ts`、`recovery-critic.md`、`control-service.ts` 的 `recon.read` 准入 | 列出各角色在決策點設計上看不到的欄位 |
| 合成案例 | 為 Q3–Q6 各寫 2–3 個無害合成決策點（本地資料解析、格式轉換、版本行為差異、程式除錯），寫在本計畫結果區 | 每例有材料、工作簿狀態、預期下一步、不應得出的結論；人工判定不了的刪掉 |
| 執行方式甲 | 只讀 `apps/launcher` 與 `tests/manual`，查起單一角色、預寫工作簿、只含本地檔案的合成題目需要哪些既有接口 | 列出可直接用的接口與缺口，不實作 |

## 2. 驗證與退出條件

- 只做有界讀取（`jq`、`sqlite3`、`grep`、`sed -n`）；派單、交回與條目只取關鍵詞布林值，必要時取命中詞前後約 25 字；不讀 transcript；輸出不含 flag、候選或題目原文。離線腳本用 `python3 -I`。
- 計數寫進 `docs/gates/fixed-decision-point-20261118/summary.json`，只放計數與欄位，權限 644。
- 結論回寫固定決策點診斷 §4 對應的去向，以及團隊決策 §6.2 的待核對項；結論轉入後刪除本計畫。
- 證據不足以回答某一問題時記 unknown 並停止該項，不擴大 run 範圍，也不改跑整題。

## 3. 執行結果

未執行。

## 4. 交接

需要模型的對照（設計 §3.2）不在本計畫內；離線結果指出值得比較的層後，另行說明目標、模型／provider、批次與 token 上限，由用戶授權。
