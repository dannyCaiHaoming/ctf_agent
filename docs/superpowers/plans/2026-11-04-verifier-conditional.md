# Plan：Verifier 按條件觸發（§3.4）

依據：[解題延遲與上下文成本](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md) §3.4。結論寫回該 design 後刪除本 plan。

## §0 當前一步：真實 run 觸發「verification required → Verifier → 帶 result 提交」

**工作模式：** 授權實驗模式，需另行授權後才執行（目標、模型、批次與 token 預算）。只改批次目錄裡的 judge 設定，不改產品代碼。

**執行方：** 用戶手動執行，由設計方準備批次目錄與執行 prompt。

### 卡點

r21 中三次提交都滿足直接提交的條件，所以「host 拒絕 → Coordinator 派 Verifier → 帶 `result` 再提交」這條路徑在真實運行中從未出現。需要確認 Coordinator 在真實模型下會照 `coordinator.md` 走回送驗流程，而不是停住、重複直接提交或放棄。

### 做法

- **題目與次數：** mfw 與 throwback 各 1 次，產品 `main` 當前版本。運行設定與 r21 相同（Solver 關閉思考、學習關閉）。
- **唯一改動：** 兩題的 judge 改為 `attempts: {kind: "limited", max: 3}`，沒有冷卻。這樣直接提交的條件不成立，host 會以 `verification required` 拒絕。
- **每次 1.2M 上限，合計 2.4M。**

### 行為判據

- **第一次提交請求被拒：** 原因以 `verification required:` 開頭，條件包含「次數不是不限」。
- **改走送驗：** 被拒之後 Coordinator 派出 Verifier，並得到 verification result。
- **帶 result 提交：** 之後的提交帶 `result`，記錄的 `admission` 為 `verification`。
- **同時記錄：**
  - 解題結果；
  - 被拒後到再次提交之間的調用數與時間；
  - Verifier 的延遲。
- **判定：**
  - 兩次都照這個順序完成，就算這條路徑通過；
  - 任何一次在被拒後停住、反覆直接提交或結束 run，記為未通過，交回設計方看 `coordinator.md`。

### 禁做清單

- 不改產品代碼和角色檔；不新增 gate 或框架。
- 只改批次目錄裡的 judge `limits`，不讀、不輸出 oracle 內容。
- 不自動重試、不換 provider、不追加 run、不 commit、不 push。

### 不在本步

`wrong_answer` 後團隊是否繼續解題：要有第一個候選容易答錯的題目，需另找題並接入 judge，見 `docs/local-challenges.md`。

### 結果

**第一步（2026-11-04，離線，`d07c52ec`，已合入 main）：** 已按 §0 實作，設計方已核對 diff。
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

**第二步（r21，2026-11-04，真實 run，已授權）：** 直接提交路徑在真實運行中通過。
- **結果：** throwback ×2、mfw ×1，3/3 解出，都走直接提交並被接受；沒有被拒的提交請求，Verifier 從未派出；Verifier 時間由 114–203 秒降為 0。
- **未觸發：** 送驗回退路徑和答錯路徑都沒有出現，送驗回退路徑留給本 plan 的 §0。
- **證據：** `docs/gates/run-cost-20261104/r21-oracle-first.json`；結論已寫回 design §3.4。
