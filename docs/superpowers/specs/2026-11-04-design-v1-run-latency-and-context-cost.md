# 解題延遲與上下文成本

**狀態：** [核心 design v1](2026-10-22-ctf-agent-design-v1.md) §1.4 的子設計，管「一次 run 的牆鐘時間和 token 花在哪、怎麼減」。解題方法本身（Skill／Reference 內容）屬於 [B／G 方法與耗時](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)；Recon 記錄與追加式上下文的契約屬於 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §4，本文只改它的**投影內容與發送頻率**，不改追加式放置。

**目前停點：** §3.1 已實施，r20 真實 run 中 throwback 的未緩存輸入比 r19 A 降 31–36%。§3.2 已採用：r20 中 Solver 關閉思考後，單次調用延遲降到原來的約 1/3–1/4，throwback 4/4 解出；未驗證難題。§3.4 直接提交已實施：r21 中 3/3 直接提交並被接受，Verifier 時間降為 0；「被要求送驗」與「答錯後繼續」兩條路徑尚無真實樣本。§3.3 延後，待 §3.4 之後再評估。

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

### 3.1 追加上下文去重複（已實施，真實 run 已觀察）

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

**實施狀態（2026-11-04，離線）：** 經驗區塊僅在 lesson 集合變化時進 delta，`signals` 與查詢移到 `context.presented` 的 `retrieval`；delta `state` 只帶變化子欄位，`publications` 為 `{upserted,removed}`；full 不變。typecheck、build、全量測試（797）、r15／r16 回放通過。r19 離線重算（`tests/manual/context-dedup-recompute.py`）：A 追加量 692,914→266,649 bytes，B 427,620→143,067；A 的經驗區塊 207 KB→0.5 KB，`state.publications` 182 KB→8 KB，`index.entries` 不變；B 因有 lesson 內容，經驗區塊仍保留 lesson 變化時的發送。證據：`docs/gates/run-cost-20261104/context-dedup.json`。

**真實 run（r20 對照組，2026-11-04）：** 與 r19 A 同為 throwback，產品 `main@7246d226`，每次都用空經驗庫。
- 未緩存輸入：769,212 → 532,893／490,623（−31%／−36%）。
- 追加位元組：
  - Recon：242,635 → 68,025／97,420；
  - Solver：286,730 → 92,590／82,107；
  - Engineer：163,549 → 83,285／80,541。
- 兩次都解出，各提交 1 次。

證據：[r20 結果](../../gates/run-cost-20261104/r20-solver-thinking.json) 的 `dedup_real_vs_r19A`。r19 A 的經驗庫同樣為空，但兩批之間還有其他差異，所以這只是方向一致的證據，不是嚴格對照。

### 3.2 降低 reasoning 量（Solver 關閉思考已採用；難題未驗證）

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
- **狀態：** launcher 已支持，r20 已在真實 run 中使用。見 `config/README.md`「各角色 options」；生效值記在 `state/run.json` 的 `agentOptions`；契約測試在 `tests/contract/launch-evidence.test.ts`。

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

**結果（r20，2026-11-04，已授權，實際用量 2,395,137 token）：** 證據見 [r20 結果](../../gates/run-cost-20261104/r20-solver-thinking.json)。依序跑 C1 → T1 → C2 → T2，產品源碼凍結。relay 共 531 次請求，全部返回 200，沒有被預算截斷，也沒有重發。

| | C1 | T1 | C2 | T2 |
| --- | ---: | ---: | ---: | ---: |
| 結果（提交次數） | 解出（1） | 解出（1） | 解出（1） | 解出（1） |
| 牆鐘（分鐘） | 21.9 | 13.2 | 15.5 | 14.2 |
| 未緩存輸入 | 532,893 | 468,182 | 490,623 | 388,772 |
| 全部 reasoning | 135,794 | 67,170 | 80,234 | 56,058 |
| Solver 調用次數 | 36 | 39 | 32 | 17 |
| Solver 延遲合計（秒） | 391 | 94 | 286 | 58 |
| Solver 單次平均延遲（秒） | 10.9 | 2.4 | 8.9 | 3.4 |

- **設定生效：**
  - T 組 `state/run.json` 的 `agentOptions` 只有 Solver 的 `thinking: disabled`，C 組為空；
  - T 組 Solver 的 56 則回覆都沒有 reasoning；
  - 其他角色照常有 reasoning。
- **確定的效果：**
  - Solver 單次調用延遲降到原來的約 1/3–1/4；
  - 每次 run 的 Solver 時間少約 4–5 分鐘；
  - Solver 調用次數沒有因此系統性增加；
  - 工具調用錯誤沒有增加，T 組 Solver 只有 1 次產物發布失敗。
- **牆鐘只看方向：**
  - 兩組分別少 8.7 和 1.3 分鐘；
  - 其他角色的波動與省下的時間同一量級，例如 Recon 延遲合計在 270–482 秒之間；
  - 較穩的估計是每次省下 Solver 那 4–5 分鐘，約佔牆鐘的 25–30%。

**判定：採用。** 實驗組解題結果不差於對照組，Solver 生成量和延遲都明顯下降，符合上面的採用條件。
- **適用範圍：** 只限 `volcano-plan/deepseek-v4.1-flash` 這個網關／模型。後續批次的運行設定預設給 `domain-solver` 加 `options.thinking = {type: "disabled"}`。參數層級不變，仍放在運行設定，不進產品角色檔。
- **未回答：**
  - 對難題或未解出題目的影響：4 次都解出，這一批看不出能力下降；
  - 其他題目的效果。

  之後跑到 Solver 卡住的題目時，加一組開啟思考的對照；若解題變差，就按題型回退。
- **其他角色：** Recon 是剩下最大的時間來源，但它影響解題率，不在沒有難題對照時關閉思考；Verifier 仍由 §3.4 處理。

### 3.3 題內並行（延後；先做 §3.4）

**問題：** 並行度為 1。例如 Recon 交回後同時派兩個 Solver 各走一條路線，牆鐘可能縮短，但 token 增加，coordinator 調度、預算分配、結果合併與停止規則都要改。

**可行性（2026-11-04 離線審閱，未經真實 run）：**
- **機制上大致可行。** `ctf_challenge_assign` 在每個（父會話, 角色）只有一個聲明，建立 task 時被消費（`apps/launcher/src/control-service.ts` 的 `challenge.assign` 分支），所以依序 assign → task(background) → assign → task(background) 理論上能起兩個同角色任務；[Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §5 已要求並發角色共用同一筆原子預留。
- **收益不確定：** 牆鐘由串行生成決定。並行只在 Recon 交回時有至少兩條可信度相當、互不依賴的路線時才省時間；第一條路線就解出時，只會讓 token 翻倍。兩個會話各有緩存，同一份 Recon 快照要付兩次未緩存輸入。
- **未解的問題：**
  - **停止規則受限：** 背景任務執行中不會喚醒 Coordinator，只能在其中一個交回時再 `ctf_task_stop` 另一個。
  - **預算互相影響：** 一個 Solver 觸發 closure 會吃掉共享預算，影響另一個。
  - **經驗來源未定義：** 兩條並行軌跡如何對應 episode／lesson 的來源規則（Recon 重設計 §7），目前沒有定義。

**決定：** 延後。先做 §3.4，它的收益是確定的。之後若要做，只考慮以下形式，另寫設計小節再進 plan：
- **條件並行：** 只在 Recon 交回列出至少兩條未測路線時並行，上限 2 個；第一個候選被 oracle 接受後，停掉其餘任務。
- **提交與驗證並行：** 若 §3.4 之後仍有需要觸發 Verifier 的提交，提交與 Verifier 同時進行，oracle 回 accepted 就停掉 Verifier。這只在題目允許錯誤提交時適用。

並行實驗不和其他提速改動放在同一批次，避免變量混淆。

### 3.4 Verifier 改為按條件觸發（直接提交已實施；送驗與答錯路徑待真實樣本）

**問題：** 每次提交都先經 Verifier，約佔牆鐘的 13–26%，單次生成量最大，多次因 `finish=length` 截斷。

**事實（r19 A／B、r20 C1／T1／C2／T2，共 6 次 run，全部離線讀取記錄）：**

| run | Verifier 延遲 | 佔牆鐘 | 判斷（mode） | `finish=length` | 提交結果 |
| --- | ---: | ---: | --- | ---: | --- |
| r19 A throwback | 227 秒 | 16% | verified（replay） | 1 | 第一次提交 accepted |
| r19 B mfw | 141 秒 | 25% | inconclusive（recompute） | 0 | 第一次提交 accepted |
| r20 C1 throwback | 269 秒 | 20% | verified（evidence_audit） | 1 | 第一次提交 accepted |
| r20 T1 throwback | 203 秒 | 26% | verified（evidence_audit） | 0 | 第一次提交 accepted |
| r20 C2 throwback | 191 秒 | 21% | verified（evidence_audit） | 1 | 第一次提交 accepted |
| r20 T2 throwback | 114 秒 | 13% | verified（recompute） | 0 | 第一次提交 accepted |

- **Verifier 沒有改變過任何一次結果。** 6 次中沒有 rejected。r19 B 的 inconclusive 按第三層照常提交，同樣被接受。
- **實際上常在重做解題。** r19 A 用 `repro.sh` 對目標重跑了整條利用鏈；r20 C1 重跑 `repro_throwback.py` 3 次，另跑兩個診斷腳本。這不是重解，但等於把 Solver 最後一段再執行一遍。
- **Solver 提速後，Verifier 的佔比上升。** §3.2 關閉 Solver 思考後，Verifier 成為更明顯的固定成本。

**為什麼價值低：** 2026-10-28 起 verified 已不是提交前置（design v1 §1.3、[D](2026-10-24-design-v1-d-candidate-verification-minimal.md) §5–7），inconclusive 也照常提交。Verifier 只有在給出「有反證的 rejected」時才改變行動，價值約等於「正確攔下錯誤候選的機率」乘以「一次錯誤提交的代價」。題目有即時 oracle、錯誤提交沒有懲罰時，錯誤提交的代價接近一次調用，而 Verifier 每次固定花 2–4.5 分鐘。

**外部參考：**
- [D-CIPHER](https://arxiv.org/abs/2502.10931)（[代碼](https://github.com/NYU-LLM-CTF/nyuctf_agents)）與 NYU CTF baseline 沒有 Verifier 角色，錯誤 flag 由環境 oracle 回報後繼續解題。
- XBOW 在沒有 oracle 的真實漏洞場景才做驗證，而且公開說明 LLM 不擅長確認，改用非 AI 的確定性 validator（[Black Hat USA 2025 摘要](https://vxrl.medium.com/black-hat-usa-2025-in-the-age-of-ai-part-2-92014992d311)）。對 CTF 而言，flag oracle 本身就是確定性 validator。

**決定（方向）：**
1. **以 oracle 為主。** 有裁判、提交機會不稀缺且答錯無懲罰時，Engineer 固定候選後直接提出可信完成。host 判定 `wrong_answer` 就交回團隊，由 oracle 擔任驗證。
2. **Verifier 按條件觸發，與 Recovery Critic 同類。** 觸發條件：
   - 無裁判（`candidate_only`）；
   - 提交次數有限、有冷卻或答錯有懲罰，或限制未知；
   - host 的確定性檢查不通過；
   - 已有一次 `wrong_answer` 後的下一個候選。

   觸發時仍是獨立上下文，原有三層方法與「不補證、不重解」不變。
3. **host 做便宜的確定性檢查，不用 LLM：**
   - 候選是否符合題面或平台給出的 flag 格式（若有）；
   - 候選 bytes 能否在已固定的證據（HTTP 捕獲、job 輸出、artifact）中找到出處。

   結果寫入審計並交給 Coordinator；它不是 verified，也不改變 solved 的認定。
4. **不變：** 精確提交、錯誤候選去重、unknown 暫停同題提交、只有 host 回執才算 solved 等 D §7 規則不變。

**需要改的地方：**
- **`ctf_completion_request`：** 目前要求帶 verification `result`。要允許在第 1 點條件成立時不帶 `result`，由 host 依題目限制核對准入。
- **確定性檢查：** host 加一個確定性檢查，結果進 completion 准入與審計。
- **角色檔：** `coordinator.md` 送驗與可信完成兩節改為按條件送驗；`verifier.md` 不需要大改。
- **design v1：** 第 15 行「Verifier 必須獨立」與 §1.3 的「獨立審閱仍保留」改為「觸發時獨立」。實施並驗收後再改 design v1 正文，避免文件先於代碼。

**實施狀態（2026-11-04，`d07c52ec`）：**
- **已實施：**
  - `ctf_completion_request` 可不帶 `result`；
  - host 的准入條件是：有裁判、次數不限、無冷卻或封鎖、同題沒有 `wrong_answer`，以及候選出現在本 run、本題的 host HTTP 捕獲中；
  - 條件不成立時，以 `verification required:` 拒絕；
  - 記錄帶 `admission` 與匹配的捕獲 resource；
  - `coordinator.md` 改為按條件送驗。
- **出處檢查的取捨：**
  - 只認 HTTP 捕獲：job 輸出由模型腳本決定，不算出處；
  - 捕獲只存在記憶體，重啟後一律送驗。
- **未做：** flag 格式檢查（題目設定沒有格式欄位）；design v1 正文的修改，等送驗路徑有真實樣本後再改。

**驗收：**
- **離線：** 無模型測試覆蓋 4 種觸發條件與「不觸發直接提交」路徑；`wrong_answer`、unknown、去重等既有測試不回退。
- **真實 run（需另行授權）：** 同題、同模型、同設定對比：解題結果不差於對照組，牆鐘下降約等於原 Verifier 時間。另需要一個「首個候選錯誤」的樣本，確認 `wrong_answer` 交回後團隊會繼續，而不是停止。

**真實 run（r21，2026-11-04，已授權，實際用量 1,224,677 token）：** 證據見 [r21 結果](../../gates/run-cost-20261104/r21-oracle-first.json)。
- **批次設定：**
  - 產品 `main@3e0d39e3`，Solver 關閉思考，題後學習關閉；
  - 兩個 judge 皆不限次數、無冷卻；
  - 依序 V1、V2（throwback）→ M1（mfw）；
  - relay 共 337 次請求，全部 200。

| | r20 T1 → V1 | r20 T2 → V2 | r19 B → M1 |
| --- | --- | --- | --- |
| 結果 | 解出 → 解出 | 解出 → 解出 | 解出 → 解出 |
| 提交路徑 | 送驗 → 直接提交 | 送驗 → 直接提交 | 送驗 → 直接提交 |
| Verifier 延遲（秒） | 203 → 0 | 114 → 0 | 141 → 0 |
| 牆鐘（分鐘） | 13.2 → 12.4 | 14.2 → 13.2 | 9.3 → 4.8 |
| 總調用 | 136 → 153 | 121 → 128 | 67 → 56 |

- **機制通過：**
  - 3 次都只提交 1 次，都走直接提交，並被接受；
  - 候選分別在 3、2、1 個 host HTTP 捕獲中找到出處；
  - 沒有被拒的提交請求，Verifier 從未派出。
- **確定的效果：** 每次 run 省下 Verifier 那 2–3.5 分鐘，解題結果不變。
- **牆鐘只看方向：**
  - throwback 只少約 1 分鐘，被其他角色的波動抵消：V1 的 Solver 調用 74 次，r20 T1 為 39 次；V1 的 Recon 也多了約 110 秒。
  - mfw 快約一半，但 r19 B 開著 Solver 思考和學習，不是嚴格對照。

**判定：** 直接提交路徑採用。以下兩條路徑在 r21 中沒有被觸發，仍待真實樣本：
- 被拒為 `verification required` 後派 Verifier 再提交：可以只改 judge 設定觸發，例如把 mfw 設為 `attempts: limited`；
- `wrong_answer` 後團隊繼續解題：需要第一個候選容易答錯的題目，候選見 [本機題目清單](../../local-challenges.md)。

### 3.5 已試路線摘要（延後）

r19 中重複探索不是主要成本，但未解出的 r18 A 有大量同路徑重複。待有更多卡住的題目樣本時再評估，歸入 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) 的後續事項，不在本文推進。

## 4. 量測方法

- 每次修正後，用 `tests/manual/run-cost-breakdown.py` 對新的 run 重算，與 §2 同欄位對比；結構化結果放 `docs/gates/run-cost-<日期>/`。
- 單次 run 的差異只作方向參考。要宣稱提速，至少同題重複兩到三次，並報告解題結果。
- 真實 run 需另行授權：目標、模型／provider、批次與 token 上限。
