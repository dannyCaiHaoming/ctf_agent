# 運行設定的各角色 options

依據：[解題延遲與上下文成本](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md) §3.2「參數放在哪一層」與「實驗設計」。

## §0 當前一步

**工作模式：** 工程模式。修改 `apps/launcher/src/launch.ts` 的運行設定合併（第 4 步「Merge runtime fields」附近），加對應 contract 測試，更新 `config/README.md` 的說明與 design §3.2 狀態；不運行外部目標，不調用真實模型。

**執行模型：** Sonnet 5.5。理由：單一函數的有界改動，但要對著現有設定合併、產品資產校驗與證據記錄做局部判斷。

### 要做的事與行為判據

1. **合併：** 運行設定（`profile.opencode.configPath` 載入的 `loaded.config`）若有 `agent`，只接受 `agent.<名稱>.options`（物件）。啟動 OpenCode 的設定中，該 agent 的 `options` 與產品 `opencode.json` 裡同名 agent 的 `options` 合併：運行設定覆蓋同名鍵，產品的其他欄位保持不變。
   - 判據：運行設定 `agent.domain-solver.options.thinking={type:"disabled"}` 時，最終設定中 `agent.domain-solver` 保留產品原有欄位，並多出這個 `options`；其他 agent 不變。
2. **拒絕越權：** 運行設定的 `agent.<名稱>` 只要有 `options` 以外的鍵（例如 `prompt`、`permission`、`mode`、`steps`、`model`、`disable`），或名稱不是產品已定義的 agent，就以 `Blocked` 拒絕並寫明原因。沒有 `agent` 時行為完全不變。
3. **留證據：** 實際生效的各角色 `options` 寫進 run 的證據（例如 `run.json` 或 inventory 旁的現有記錄位置，自行選擇並說明），讓兩組 run 可以按記錄區分；不記錄憑據。
4. **文檔：** `config/README.md` 寫明這個欄位的用途與限制，並給一個只對 `domain-solver` 關閉思考的範例片段（不新增範例設定檔）。design §3.2 的停點與狀態改為「launcher 已支持，待批次授權」。

### 驗收

- typecheck、build、全量 contract 測試通過。
- 新測試覆蓋判據 1–3：合併結果、越權拒絕、未知角色拒絕、沒有 `agent` 時不變、證據中記錄生效的 options。
- 只證明離線行為；provider 端效果已由探針證明，解題影響待批次。

### 禁做清單

- 不改產品角色檔 `product/opencode/agents/*.md` 與產品 `opencode.json`；不改 provider 範例設定檔的現有內容。
- 不新增 gate、軌跡、里程碑、通用框架或抽象；fixture 非必要不新增，必要時只用合成資料。
- 不改題後學習的設定組裝（`episode-learning.ts` 自建設定，不在本步）。
- 不建直連 provider 的循環，不維護 OpenCode fork；不恢復 M0–M6／M1B，不接 TSecBench。
- 不調用真實模型，不運行靶場，不修改 `pentest-agent-run-data` 下任何檔案。
- 控制憑據與 oracle 私有答案不進模型上下文或證據檔。
- 不 commit、不 push；跑完就停，在 §0 之後追加結果（含失敗）。

## 結果

（執行模型完成後追加。）
