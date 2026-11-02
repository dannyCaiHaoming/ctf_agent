# MVP R5：Episode 完整來源契約 plan

工作模式：工程模式。操作對象是 `apps/launcher/src/episode-learning.ts`、`apps/launcher/src/control-service.ts`（`learningInputs`）、`apps/launcher/src/experience-store.ts` 的 episode 部分及相關測試；不運行任何外部目標或真實模型。
類型：實現與必要修復。
依據：[Recon 詳細 design](../specs/2026-10-29-design-v1-recon-redesign.md) §7（含「來源選取是機械規則」）與 §8；核心 design v1 §1.5。
依據版本：`main@fd32430f` 加上本 plan 同批的 design §7 規則段；實作 session 開工時以 `main` 最新提交為準。
執行者／工作區：另開實作 session，在自己的 worktree 從 `main` 開分支；主會話負責完成後複核與收口。
執行模型：Sonnet 5.5。理由：選取規則、欄位與失敗語義已在 design §7 定稿，本步是按規則改 host 端輸入構造與 schema，並用現有離線回放排查實際數據的表現，需要局部判斷，但沒有新的架構取捨。若規則在真實數據上無法同時滿足上限與「首尾不刪」，或需要改 design 欄位，就停下交回 Opus 5.5。
狀態：待執行

## 0. 當前交接
- **當前 MVP 核心目標：** episode 指向整次嘗試的完整來源。交給模型的子集由機械規則選出，被省略的內容寫成範圍；早期成功和晚期失敗都不會在模型看到之前就被丟掉。
- **本 plan 只完成：** design §7 的來源選取規則、host 填寫的 `source_range`／`omitted_ranges`，以及 `failed_paths`／`unresolved` 的來源綁定。
- **為何直接影響當前目標：** r16 A 的 episode 只覆蓋 16／89 條來源，丟了早期的註冊成功記錄，又把晚期的空表單 403 泛化成整題結論。原因在輸入構造：`prepareEpisodeInput` 先按 kind 排優先級、從最新往前取，到 20 KB 就停，過長內容砍掉中段。不修這裡，下一題拿到的 lesson 會繼續失真。
- **當前已完成到哪裡：**
  - R3／R4 已合入 `main`：`ExperienceStore.records()` 提供完整索引與 fingerprint；episode 已有 `source_manifest`（全部來源 ref 與 kind／status）和 `coverage.omitted_refs`。
  - 輸出上限已實施：8 步、400 字元、3 條 lesson、每欄 5 項；`finish=length` 或 invalid JSON 時 fail-closed。這部分不用重做。
  - 仍缺的：
    - 族／變化點選取，以及 `source_range`、`omitted_ranges`；
    - `failed_paths`／`unresolved` 目前是純字串，沒有綁定來源；
    - 角色交回仍只取最後 4 段文字，中段截斷。
- **下一步：** 先寫 RED 契約測試，並確認在當前實作上失敗；再改選取與 schema。
- **必須保留的接口／驗收：**
  - `recon_turns`、artifacts 仍是事實主本，episode 只是索引；
  - outcome、Verifier judgment、end reason 仍由 host 綁定，模型不能改 `solved`；
  - 現有輸出上限與 fail-closed 行為不變；
  - R3 的 `recon.read` 與 R4 的上下文投影不回退；
  - 舊 episode 行不遷移，但 `experience.search`／`experience.read`／`lessonSummary` 讀舊行（字串形式的 `failed_paths`）時不能報錯。
- **禁做清單：**
  - 不新增 fixture／gate 類型／軌跡／里程碑／通用框架或抽象；不新建直連 provider 的求解循環，不維護 OpenCode fork。
  - 不讓模型或語意規則決定哪些來源「重要」；選取只用 design §7 的機械規則。
  - 不做 §5 token 預留、§6 快照消費記錄，不改 lesson 檢索與呈現。
  - 不恢復舊 M0–M6／M1B 軌跡，不接入 TSecBench。
  - 不調用真實模型或 provider，不訪問任何外部目標；manual 腳本只讀本地已有數據。
  - 控制憑據與 oracle 私有答案不進模型輸入；新測試只用合成數據（如 `flag{synthetic}`、`*.example.test`）。
  - 證據只讀結構化摘要與必要字段（`jq`／`grep`），不把 run 原始輸出、題目附件或工具原文貼進對話或 plan。
  - 不 commit、不 push；跑完停下，在 §3 記錄結果。
- **授權範圍、環境、成本與暫停點：** 允許在自己的 worktree 改上述產品代碼與測試，使用臨時 SQLite，做無模型驗證。真實模型 token 預算為 0。不刪除既有 gate 或測試；只改寫因 schema 變化而必須調整的既有斷言。
- **必讀輸入及交付位置：**
  - 倉庫 `AGENTS.md`、`CLAUDE.md`；
  - design §7、§8；
  - 上述三個源碼檔，以及 `tests/contract/episode-learning.test.ts`、`tests/contract/experience-tools.test.ts`、`tests/manual/recon-original-replay.ts`；
  - 回放摘要 `docs/gates/recon-context-interface-20261031/product-original-replay.json`，用 `jq` 讀 `reports[].prompt_omitted`、`prompt_source_refs` 等字段。

  結果寫入本 plan §3；收口時主會話回寫 design §7／§8 與 gate。

## 1. 工作安排
| 必要步驟 | 為什麼需要／前置依賴 | 預計涉及位置 | 行為判據 |
| --- | --- | --- | --- |
| 建立 §7 RED 契約測試 | 先固定原始失敗點，避免只測新裝配 | `tests/contract/episode-learning.test.ts` | 合成軌跡：同一 HTTP 族先 302 後 403，另有一族只出現一次，總量超過輸入上限。斷言：每族首尾與變化點都在 sources 中；超限時刪中段而不刪首尾；整族省略時出現在 `omitted_ranges`，原因為 `not_in_summary`；不完整的步驟標 `source_missing`；`source_range` 覆蓋全部步驟；`failed_paths` 引用未提供的 ref 時被拒絕。在當前實作上預期失敗 |
| 實作機械選取 | design §7 規則 | `episode-learning.ts`（`prepareEpisodeInput`） | 族鍵與結果類別只取自已保存的去敏參數與狀態，輸出穩定（同輸入同結果）；必選項齊全；總大小不超過現有輸入上限；角色交回超長時按頁界保留首尾，並把未提供的部分寫入 `omitted_ranges` |
| host 填寫範圍欄位 | 範圍不能由模型宣稱 | `control-service.ts`（`learningInputs`）、`experience-store.ts`（`saveDraft`） | episode 保存 `source_range`（首尾 sequence、總數、`records()` fingerprint、artifact refs、running／unknown 計數）與 `omitted_ranges`；同輸入的 `input_hash` 冪等不變 |
| 輸出來源綁定 | 失敗與未解斷言要連到實際步驟 | `experience-store.ts`（`episodeContent`）、`episode-learning.ts`（episode prompt 與校驗） | `failed_paths`／`unresolved` 每項為 `{text, source_refs}`，ref 必須屬於本次提供的 sources，否則以 `unbound episode … source` 拒絕；舊行讀取相容 |
| 離線回放驗證 | 用原 A/B 數據證明規則在真實規模上成立 | `tests/manual/recon-original-replay.ts` | 原 A 全部 98 行由 `source_range` 覆蓋；每族的首尾都在 sources 中，或整族列在 `omitted_ranges` 並帶族鍵；回放輸出新增族數、變化點數與省略範圍摘要；realModelCalls 為 0 |
| 定向、集成與停點 | 證明修復且不回退 | 測試 | 定向測試先綠；再跑 typecheck、build、`npm test`、`npm run test:deterministic`，以及上述 manual 回放 |

## 2. 驗證方式
- **入口與原始失敗：** r16 A 的 episode 只覆蓋 16／89 條來源，並出現錯誤泛化（design §7 固定反例）；當前 `prepareEpisodeInput` 的優先級、最新優先與 20 KB 截斷。
- **替身能證明什麼：** 合成軌跡和原 A/B 回放可以證明輸入構造、範圍欄位與來源綁定。它們不能證明真實模型寫出的 episode 忠實，也不能證明 lesson 對下一題有用。
- **命令：** `npm run typecheck`、`npm run build`、`npm test`、`npm run test:deterministic`、`npx tsx tests/manual/recon-original-replay.ts`。全部不調用 provider。
- **需特別複核的風險：**
  - 族鍵過粗會把不同實驗併成一族，過細則族數爆炸；記錄原 A 的族數與每族步數分佈，供主會話判斷。
  - 原 A 的輸入上限若連首尾都裝不下，按規則整族省略，並如實記錄觸發條件，不放寬上限。
- **判定與去向：** 全部通過則回寫 design §7 實施狀態與 §8 證據；部分通過保留 plan 與未完成項；規則在真實數據上不可行則停下交回主會話，不自行改規則。
- **結束條件：** §1 判據全部滿足，或到達需要主會話決定的規則問題。

## 3. 臨時執行結果
- 實際修改和產物：待執行。
- 按任務對應的實際驗證、結果和證據鏈接：待執行。
- 已完成任務、當前停點及下一步：待執行；起點為 §1 第一行的 RED 契約測試。
- 會影響後續任務的計劃糾錯或實現決定、理由與影響：待記錄。
- 未運行、失敗與限制：真實模型未運行；commit/push 未授權。
- 是否發現必須由主會話決定的變化：待執行。
- 對子 design 和總 design 的回寫建議：待執行。

## 4. 主會話複核與收口
- 差異、目標和證據是否一致：待複核。
- 必要複跑及主區整合驗收結果：待複核。
- 結論與未完成事項已轉入何處：待收口。
- 活動鏈接、會話和工作區如何收口：完成後刪除本 plan。

本文件是臨時交接物。有效內容轉入 design／證據後移除。
