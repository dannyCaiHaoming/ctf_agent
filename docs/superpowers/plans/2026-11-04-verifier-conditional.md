# Plan：Verifier 按條件觸發（§3.4）

依據：[解題延遲與上下文成本](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md) §3.4。結論寫回該 design 後刪除本 plan。

## §0 當前一步：host 准入 oracle 優先的直接提交，Coordinator 按條件送驗

**工作模式：** 工程模式。修改 `apps/launcher/src/completion-tools.ts`、`apps/launcher/src/control-service.ts`（`completion.request` 分支）、`product/opencode/agents/coordinator.md`，以及讀取 completion 記錄 `result` 欄位的下游代碼和對應測試。不運行外部目標，不調用真實模型。

**執行模型：** Sonnet 5.5。接口已在下面定好；實作要對著現有准入代碼與測試做局部判斷，不是照清單搬移，但不涉及架構取捨。

### 卡點

`ctf_completion_request` 的 `result`（Verifier 結果編號）目前是必填，所以每次提交都要先經 Verifier。§3.4 已決定改為以 oracle 為主、Verifier 按條件觸發。這一步只做 host 准入與 Coordinator 指令，不改 Verifier 本身。

### 已確認的事實（離線，r19 A／B、r20 C1–T2 共 6 次 run）

- 候選由 Engineer 用 `package.publish` 固定，`version` 是 package ref；`candidateBytes(run, challenge, version)` 不依賴 Verifier。Verifier 結果只在准入時被檢查（`verificationResults.read(...).completionAdmission`）。
- 6 次 run 的候選都是從 `file` 類 publication 切出，但候選位元組都能在 host 捕獲的 HTTP 響應正文中找到（每次 1–3 個捕獲）。host 在記憶體中保存了這些捕獲：`control-service.ts` 的 `outputSources`，`source.kind === 'http'` 的項帶 `bytes`。
- r20 的 throwback 裁判 `limits = {attempts: {kind: 'unlimited'}}`，沒有冷卻。
- 題目設定沒有 flag 格式欄位。§3.4 第 3 點的格式檢查「若有」才做，這一步不做，也不新增設定欄位。

### 接口（已定）

1. **`completionSchema` 的 `result` 改為可選。** 帶 `result` 時，行為與現在完全相同。
2. **不帶 `result` 時走「oracle 優先」准入。** 下列條件全部成立才准入，否則拒絕。拒絕原因以 `verification required:` 開頭，列出不成立的條件，讓 Coordinator 改為送驗：
   - **有裁判：** 不是 `candidate_only`。
   - **不限次數：** `limits.attempts.kind === 'unlimited'`，並且沒有 `cooldownMs`、`notBefore`、`blockedReason`。限制為 `limited`、`unknown` 或缺失時都要送驗。
   - **沒答錯過：** 同題同裁判範圍的歷史記錄中，沒有 `rejection === 'wrong_answer'` 的已確認記錄。
   - **有出處：** 候選位元組是本 run、本題某個 host HTTP 捕獲（`outputSources` 中 `kind === 'http'` 的 `bytes`）的子串。
     - job 輸出與 workspace 檔案不算：內容由模型的腳本或寫入決定。
     - 捕獲只在記憶體中，重啟後不可得；那時判定為不成立並送驗（fail-closed）。不為此新增持久化。
3. **既有規則不變。** unknown 暫停同題、pending 同題、錯誤候選去重、精確提交、只有 host 回執才算 solved，這些在兩條路徑上都照舊。
4. **記錄與審計。**
   - completion 記錄的 `result` 改為可選；舊記錄照常可讀。
   - 新增 `admission: 'verification' | 'oracle_first'`。
   - `completion.saved` 審計中，oracle 優先的記錄帶出處檢查結果：匹配的捕獲 resource，不帶位元組內容。
   - 下游讀 `result` 的地方要容忍缺失：`progress-ledger.ts`、`episode-learning.ts`、`experience-store.ts`、`root-result.ts`，以及 grep 到的其他位置。
5. **`coordinator.md`：** 把送驗與可信完成兩節改為按條件送驗。
   - Engineer 固定候選後，先不帶 `result` 請求完成。
   - 被拒且原因是 `verification required` 時，照原流程派 Verifier，再帶 `result` 提交。
   - `wrong_answer` 後的下一個候選，host 會要求送驗。
   - Verifier 的三層方法、獨立上下文與「不補證、不重解」不變；`verifier.md` 不改。

### 行為判據

- **離線測試（無模型，合成數據 `flag{synthetic}`、`*.example.test`）：**
  - **直接提交通過：** 不帶 `result`、條件全部成立時准入並送裁判，記錄 `admission: 'oracle_first'`。
  - **各條件逐一拒絕：** 下列每一種都要拒絕，原因以 `verification required` 開頭：
    - 無裁判；
    - `limited`；
    - `unknown`；
    - 有冷卻；
    - 已有 `wrong_answer`；
    - 候選只出現在 job 輸出或 workspace 檔案；
    - 沒有任何捕獲。
  - **帶 `result` 不受影響：** 既有路徑的測試不改動、不回退。
  - **既有規則不回退：** unknown、去重、pending、limit 等現有測試照常通過。
- typecheck、build、全量測試通過，並報告測試數（目前 805）。
- `coordinator.md` 的改動能被現有角色檔載入測試接受。

### 禁做清單

- 不新增 gate、軌跡、里程碑、通用框架或抽象；不新增 flag 格式欄位；確定性檢查不調用 LLM。
- 不改 `verifier.md`、Verifier 工具與 `verification-results.ts` 的准入規則；不改 design v1 正文。§3.4 寫明實施驗收後再改，由設計方寫回。
- 不改 design 與本 plan（它們在主 checkout，未提交）；結果寫在最後回報中，由設計方追加到下面「結果」小節。
- 不新建直連 provider 的求解循環，不維護 OpenCode fork，不恢復 M0–M6／M1B，不接 TSecBench。
- fixture 只用合成數據；不讀、不改 `pentest-agent-run-data` 下的任何 run。
- 不做真實模型調用（本步沒有 token 授權）；不 commit、不 push；跑完就停。
- 本步不授權刪除。

### 結果

**第一步（2026-11-04，離線，worktree 分支 `claude/verifier-conditional-b300ae`，未提交）：** 已按 §0 實作，設計方已核對 diff。
- **改動檔案：**
  - `completion-tools.ts`：`result` 改為可選；新增 `admission`、`captureResources`；oracle 優先檢查在去重之後、准入之前執行。
  - `control-service.ts`：不帶 `result` 時不讀 Verifier 結果；出處只看本 run、本題的 HTTP 捕獲。
  - `progress-ledger.ts`：審計記錄帶上 `admission`／`captureResources`。
  - `apps/opencode-plugin/src/index.ts`：工具參數和描述改為 `result` 可選。
  - `coordinator.md`：新增「按條件送驗」段；第 24 行總述由設計方改為按條件送驗。
  - 新增 `tests/contract/verifier-conditional.test.ts`，共 15 個測試。
- **測試覆蓋：**
  - 直接提交通過；
  - 拒絕情形：無裁判、limited、unknown、限制缺失、冷卻／notBefore／blockedReason、已有 wrong_answer、候選只出現在 workspace 檔案、只出現在 job 輸出、沒有任何捕獲；
  - 多個條件不成立時，在同一個原因中全部列出；
  - 被拒時不送裁判、不留記錄；
  - 帶 `result` 時不退回 oracle 優先；
  - unknown／pending 仍然生效；
  - 已接受的候選照常去重。
- **檢查結果：** 設計方在 worktree 中重跑 typecheck、build 和全量測試，全部通過（820 個，原 805）。
- **偏離 §0：** 無。下游的 `episode-learning`／`experience-store`／`root-result` 不讀 completion 記錄的 `result`，所以不需要改。
- **未驗證：** 真實 run 中 Coordinator 是否真的先直接提交，以及首個候選答錯後能否交回團隊繼續。這兩項由下一步的真實 run 回答，需另行授權 token 預算。
