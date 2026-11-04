# 解題延遲與上下文成本

**狀態：** [核心 design v1](2026-10-22-ctf-agent-design-v1.md) §1.4 的子設計，管「一次 run 的牆鐘時間和 token 花在哪、怎麼減」。解題方法本身（Skill／Reference 內容）屬於 [B／G 方法與耗時](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)；Recon 記錄與追加式上下文的契約屬於 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §4，本文只改它的**投影內容與發送頻率**，不改追加式放置。

**目前停點：** §3.1 離線已實施並驗證，待下一次授權 run 觀察真實輸入。§3.2：網關只認 `thinking: disabled`；批次對比已設計，開跑前要先讓 launcher 合併運行設定中的各角色 `options`（進行中）。§3.3、§3.4 未定。

**依據：** [r18／r19 成本拆解](../../gates/run-cost-20261104/r18-r19-cost-breakdown.json)，由 `tests/manual/run-cost-breakdown.py` 從四個真實 run 的訊息與審計記錄離線算出（0 次模型調用）。模型均為 `volcano-plan/deepseek-v4.1-flash`。修正後用同一腳本重算，對比同一欄位。

## 1. 目標

在不降低解題率的前提下：

- **縮短牆鐘時間**：主要看生成 token 數與調用次數。
- **減少預算計數的輸入**：host 預算只計未命中緩存的輸入，重複發送的內容直接計入。
- **減少上下文雜訊**：模型每次讀到的無用內容越少，越不容易被干擾。

解題率是硬約束。任何提速改動都要在同題、同模型的真實 run 中對比解題結果；只省時間、解題率下降，不算改進。

## 2. 現狀（r18／r19）

| run | 調用 | 牆鐘 | 並行度 | 未緩存輸入 | 緩存讀取 | 輸出 | reasoning |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| r19 A throwback | 126 | 23.0 分 | 1.00 | 769,212 | 10,683,648 | 48,124 | 134,733 |
| r19 B mfw | 67 | 9.3 分 | 1.00 | 353,331 | 2,220,544 | 33,579 | 37,994 |
| r18 A throwback | 143 | 21.9 分 | 1.00 | 582,082 | 15,798,400 | 45,811 | 121,559 |
| r18 B mfw | 99 | 13.3 分 | 1.00 | 434,389 | 4,081,024 | 45,867 | 66,521 |

**事實：**

1. **完全串行。** 牆鐘時間等於模型忙碌時間，並行度 1.00：Recon → Solver → Engineer → Verifier 依次進行。工具執行合計只有數秒。
2. **延遲由生成量決定。** 排除 coordinator（它的延遲包含等待子任務）後，四個 run 的「單次延遲 vs 生成 token（輸出 + reasoning）」相關係數都是 0.98–0.99，生成速度約每秒 130 token；與上下文大小的相關係數只有 0.08–0.21。緩存命中良好，上下文大小目前不是延遲瓶頸。
3. **reasoning 佔生成量的大部分。** r19 A 生成 18.3 萬 token，其中 13.5 萬是 reasoning（74%）。
4. **角色牆鐘（r19 A）：** Recon 470 秒（35 次）、Solver 454 秒（34 次）、Verifier 227 秒（13 次）、Engineer 111 秒（14 次）。Verifier 在兩題都約佔牆鐘的 16–17%，單次生成量最大，r19 A 有一次 `finish=length`。
5. **追加上下文約一半是重複發送。** r19 A 三個角色共追加 675 KB，其中：
   - **經驗區塊** `experience` 共 201 KB。區塊內含主機抽取的檢索關鍵詞 `signals`，每有新的觀察或 decision 就改變，整塊重發；A 的經驗庫為空，Recon 仍累計 115 KB。
   - **產物清單** `state.publications` 共 176 KB（Solver 103 KB）。`state` 任一子欄位變化就整份重發，而 `state.budget` 每次准入都變。

   B 同樣：經驗區塊在 Recon 佔 171 KB 中的 138 KB。
6. **重複探索不是主要成本。** r19 A 同角色、同 method+path 的 HTTP／job 重複：Recon 3、Solver 8（多為同端點不同 payload）；Solver 重做 Recon 已做的 4 次。未解出的 r18 A 不同：Recon 同路徑重複 36 次。

**不能推出：** 每題只跑一次，r18→r19 的調用數差異不能歸因到任何改動；成本拆解只說明「花在哪」，不說明「哪裡可以省而不影響解題」。

## 3. 槓桿與決定

按「確定性高、成本低」排序。每項做完把結果寫回本節，並更新停點。

### 3.1 追加上下文去重複（離線已實施，真實 run 待觀察）

**決定：** 追加內容只在它對模型的含義改變時才發送。

- **經驗區塊：**
  - 只在呈現給模型的 lesson 集合（id + version）變化時發送。
  - `signals` 與檢索查詢只寫入審計，不進上下文。
  - 經驗庫為空、檢索無結果時，首次 full 說明一次即可，之後不再發送。
- **`state`：**
  - delta 只帶變化了的子欄位，不因 `budget` 變化重發整份 `state`。
  - `publications` 只帶新增或變更的項；full 投影仍帶完整清單。
- **不變的契約：**
  - 追加式放置、`sessionID + version` 去重、full／delta 規則、compaction／重啟退回 full、fail-closed、`context.presented` 審計都不變。
  - full 投影的內容不減少：模型隨時能從最新 full 加上之後的 delta 還原完整當前狀態。
  - 預算、closure、handoff 等影響決策的狀態變化仍及時發送。

**驗收：**
- 離線：用 r19 A／B 的記錄重算追加量，經驗區塊與產物清單的重複發送接近 0；其餘欄位不減少。
- 現有上下文相關測試不回退。
- 真實 run 中，相同題目的未緩存輸入下降、解題結果不變，留待下一次授權 run 一併觀察，不單獨為此跑批次。

**實施狀態（2026-11-04，離線）：** 經驗區塊僅在 lesson 集合變化時進 delta，`signals` 與查詢移到 `context.presented` 的 `retrieval`；delta `state` 只帶變化子欄位，`publications` 為 `{upserted,removed}`；full 不變。typecheck、build、全量測試（797）、r15／r16 回放通過。r19 離線重算（`tests/manual/context-dedup-recompute.py`）：A 追加量 692,914→266,649 bytes，B 427,620→143,067；A 的經驗區塊 207 KB→0.5 KB，`state.publications` 182 KB→8 KB，`index.entries` 不變；B 因有 lesson 內容，經驗區塊仍保留 lesson 變化時的發送。證據：`docs/gates/run-cost-20261104/context-dedup.json`。真實 run 的未緩存輸入與解題結果留待下一次授權 run。

### 3.2 降低 reasoning 量（只有關閉思考可用；收益待批次驗證）

**接口（離線已回答）：** OpenCode 1.19.3 可以按角色把推理參數寫進請求。證據見 [reasoning 參數探針](../../gates/run-cost-20261104/reasoning-options-probe.json)，用本機假 provider 抓取請求正文，0 次模型調用。
- **有效：** agent 的 `options` 生效，寫在 `opencode.json` 或 `agents/*.md` 的 frontmatter 都可以。`reasoningEffort` 變成請求的 `reasoning_effort`；其他鍵原樣透傳，例如 `thinking: {type: "disabled"}`。產品角色定義在 `product/opencode/agents/*.md`，可以直接加。
- **無效：** agent 的 `variant`（配合模型 `variants`）在 `opencode run` 中沒有生效，不採用。
- **不處理：** 插件 `chat.params` 也能改 `options`，但角色層面的靜態設定用 frontmatter 已足夠；host 動態控制目前沒有需要，不經插件。

**收益估算（r19 A，按生成速度約每秒 130 token 折算）：**

| 角色 | reasoning | 約佔時間 |
| --- | ---: | ---: |
| Solver | 51,839 | 398 秒 |
| Recon | 45,006 | 346 秒 |
| Verifier | 22,611 | 173 秒 |
| Engineer | 9,232 | 71 秒 |
| Coordinator | 4,258 | 32 秒 |
| Intake | 1,787 | 13 秒 |

原先只打算降低 coordinator、intake、engineer。這三個角色即使把 reasoning 降到零，也只省約 116 秒，約佔 A 牆鐘的 8%。主要時間在 Recon 與 Solver（約 54%）和 Verifier（約 13%），但這三個角色也最可能影響解題率與驗證品質。B 的分佈更平均：Verifier 95 秒、Engineer 66 秒、Recon 59 秒、Solver 55 秒。

**決定：**
- 低風險角色（coordinator、intake）可以直接降低，但收益小，不單獨為它驗證。
- 有意義的提速要在 Recon、Solver 上做，必須用真實 run 對比解題結果。
- Verifier 不降低推理強度：驗證標準優先。它的成本另由 §3.4 處理。

**provider 探針（2026-11-04，已授權，6 次請求，約 710 token）：** 證據同上檔的 `real_provider_probe`。自訂火山網關的 `deepseek-v4.1-flash`，問題為一道簡單乘法：
- **`thinking: {type: "disabled"}` 生效：** 兩次 reasoning 都是 0，沒有 reasoning 段，答案仍正確。
- **`reasoning_effort: low` 未能判斷：** 預設只用約 17 個 reasoning token，low 是 18，題目太簡單，看不出差別。

**降檔補測（2026-11-04，6 次請求，約 2,000 token）：** 改用一道需要逐步推理的同餘題（答案 346），預設與 `low` 各 3 次，全部答對。預設 reasoning 為 241／240／227（平均 236），`low` 為 191／235／253（平均 226），差異在每次之間的波動範圍內。結論：這個網關／模型上 `reasoning_effort` 沒有可測的效果。

**結論：** 能用的只有「整個角色關閉思考」這一個開關，沒有溫和的降檔選項。

**參數放在哪一層（決定）：** `thinking` 這類參數只對特定 provider 有效，所以放在批次的運行設定（profile 引用的 OpenCode 設定，與 `provider`／`model` 同一層），不寫進與 provider 無關的產品角色檔 `product/opencode/agents/*.md` 或產品 `opencode.json`。
- launcher 只從運行設定合併各角色的 `agent.<角色>.options`。`prompt`、`permission`、`mode`、`steps` 等其他欄位仍由產品決定，運行設定裡出現就拒絕。
- 已用本機假 provider 確認：設定檔中給同名 agent 加 `options`，會和 md 角色檔合併，該角色的請求帶上 `thinking: disabled`，其他角色不受影響（0 token）。
- 目前 launcher 只合併 `provider`、`model`、`enabled_providers`，需要先補上這一項。

**實驗設計（批次對比，需另行授權）：**
- **兩組：**
  - 對照組：當前 `main`，含 §3.1 去重複；
  - 實驗組：同一產品，運行設定只對 `domain-solver` 設 `options.thinking = {type: "disabled"}`。

  兩組的產品、模型、預算與題目完全相同，唯一差別是這一項設定。
- **題目：** 先只跑 throwback（Solver reasoning 最重）。兩組各兩次，共 4 次。mfw 太快，差異會被波動蓋過，暫不跑。
- **隔離：** 每次 run 用新的空經驗庫並跳過題後學習，排除經驗與學習的影響。
- **指標：** 每次報告解題結果、提交次數、總調用次數與牆鐘；另用 `tests/manual/run-cost-breakdown.py` 報告 Solver 的調用次數、reasoning、輸出與延遲，以及各角色的未緩存輸入。對照組的未緩存輸入同時用來觀察 §3.1 在真實運行中的效果。
- **判定：**
  - 實驗組解題結果不差於對照組，且 Solver 生成 token 與牆鐘明顯下降，才採用；
  - 解題變差就回退；
  - 結果不一致（例如一勝一負）就記為未定，不擴大結論。
- **預算參考：** 每次上限 120 萬 token，4 次共 480 萬；按 r19 A 的用量，預計約 300 萬。

### 3.3 題內並行（未定，設計層面）

**問題：** 並行度為 1。例如 Recon 交回後同時派兩個 Solver 各走一條路線，牆鐘可能明顯縮短，但 token 增加，coordinator 調度、預算分配、結果合併與停止規則都要改。

**要回答：** 哪些階段可以安全並行、並行的停止條件、預算如何分攤、與 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §5／§6 的交回與快照如何銜接。做之前另寫設計小節，不直接進 plan。

### 3.4 Verifier 成本（未定）

**問題：** 每次提交約 4 分鐘，單次生成量最大，曾因 `finish=length` 截斷。

**要回答：** Verifier 的生成量花在哪些步驟；能否縮短輸出；簡單提交能否走更輕的檢查而不降低驗證標準。先用現有記錄離線拆解，再決定。

### 3.5 已試路線摘要（延後）

r19 中重複探索不是主要成本，但未解出的 r18 A 有大量同路徑重複。待有更多卡住的題目樣本時再評估，歸入 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) 的後續事項，不在本文推進。

## 4. 量測方法

- 每次修正後，用 `tests/manual/run-cost-breakdown.py` 對新的 run 重算，與 §2 同欄位對比；結構化結果放 `docs/gates/run-cost-<日期>/`。
- 單次 run 的差異只作方向參考。要宣稱提速，至少同題重複兩到三次，並報告解題結果。
- 真實 run 需另行授權：目標、模型／provider、批次與 token 上限。
