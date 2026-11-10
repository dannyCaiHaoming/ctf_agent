# 解題延遲與上下文成本

**狀態（2026-11-10）：§3.1 去重複、§3.2 Solver 關閉思考、§3.4 Verifier 按條件觸發已採用；§3.3 並行與 §3.5 已試路線摘要延後。Coordinator 關閉思考與 §3.4 出處條件修訂待配對 run 量測（§4），「答錯後團隊繼續」尚無真實樣本。**

本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) §1.4 的子設計，管一次 run 的牆鐘時間與 token 花在哪、怎麼減。解題方法本身屬於 [B／G 方法與耗時](2026-10-26-design-v1-b-method-generalization-and-efficiency.md)；追加式上下文的契約屬於 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §4，本文只改投影內容與發送頻率。各批次的完整數字見 `docs/gates/run-cost-20261104/`，改寫前的逐批敘述見 commit `268813d5` 中的本文。

## 1. 目標

在不降低解題率的前提下：

- **縮短牆鐘時間**：主要看生成 token 數與調用次數。
- **減少預算計數的輸入**：host 預算只計未命中緩存的輸入，重複發送的內容直接計入。
- **減少上下文雜訊**：模型每次讀到的無用內容越少，越不容易被干擾。

解題率是硬約束。任何提速改動都要在同題、同模型的真實 run 中對比解題結果；只省時間、解題率下降，不算改進。

## 2. 現狀（r18／r19）

依據 [r18／r19 成本拆解](../../gates/run-cost-20261104/r18-r19-cost-breakdown.json)，由 `tests/manual/run-cost-breakdown.py` 從四個真實 run 離線算出。模型均為 `volcano-plan/deepseek-v4.1-flash`。

| run | 調用 | 牆鐘 | 並行度 | 未緩存輸入 | 緩存讀取 | 輸出 | reasoning |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| r19 A throwback | 126 | 23.0 分 | 1.00 | 769,212 | 10,683,648 | 48,124 | 134,733 |
| r19 B mfw | 67 | 9.3 分 | 1.00 | 353,331 | 2,220,544 | 33,579 | 37,994 |
| r18 A throwback | 143 | 21.9 分 | 1.00 | 582,082 | 15,798,400 | 45,811 | 121,559 |
| r18 B mfw | 99 | 13.3 分 | 1.00 | 434,389 | 4,081,024 | 45,867 | 66,521 |

1. **完全串行。** 牆鐘等於模型忙碌時間，Recon → Solver → Engineer → Verifier 依次進行；工具執行合計只有數秒。
2. **延遲由生成量決定。** 單次延遲與生成 token 的相關係數為 0.98–0.99（約每秒 130 token），與上下文大小只有 0.08–0.21。緩存命中良好，上下文大小目前不是延遲瓶頸。
3. **reasoning 佔生成量的大部分。** r19 A 生成 18.3 萬 token，其中 74% 是 reasoning。
4. **Verifier 是固定成本。** 在兩題都約佔牆鐘的 16–17%，單次生成量最大。
5. **追加上下文約一半是重複發送。** r19 A 追加 675 KB，其中經驗區塊 201 KB（含每次都變的檢索關鍵詞，經驗庫為空仍整塊重發），`state.publications` 176 KB（`state.budget` 每次准入都變，帶著整份 `state` 重發）。
6. **重複探索不是主要成本。** r19 A 的同路徑重複很少；未解出的 r18 A 則有 36 次。

每題只跑一次，r18 → r19 的差異不能歸因到任何改動；成本拆解只說明花在哪，不說明哪裡能省而不影響解題。

## 3. 槓桿與決定

### 3.1 追加上下文去重複

**狀態：已採用（2026-11-04）。**

**決定：** 追加內容只在對模型的含義改變時才發送。經驗區塊只在呈現的 lesson 集合（id + version）變化時發送，檢索關鍵詞與查詢只寫入審計；`state` 的 delta 只帶變化的子欄位，`publications` 改為 `{upserted, removed}`。追加式放置、`sessionID + version` 去重、full／delta 規則、compaction 與重啟退回 full、fail-closed 都不變；full 投影內容不減少，預算、closure、handoff 等影響決策的變化仍及時發送。

| 驗證 | 結果 |
| --- | --- |
| r19 離線重算（[context-dedup](../../gates/run-cost-20261104/context-dedup.json)） | A 追加量 693 KB → 267 KB，經驗區塊 207 KB → 0.5 KB；B 427 KB → 143 KB |
| r20 對照組（throwback，空經驗庫） | 未緩存輸入比 r19 A 降 31–36%，兩次都解出。兩批之間還有其他差異，只算方向一致 |

### 3.2 降低 reasoning 量

**狀態：Solver 關閉思考已採用（r20）；Coordinator 關閉思考已定，待下一批量測；難題的影響未驗證。**

**能用的開關（[探針](../../gates/run-cost-20261104/reasoning-options-probe.json)）：** OpenCode 1.19.3 的 agent `options` 會原樣寫進請求。這個網關／模型上，`thinking: {type: "disabled"}` 生效（reasoning 歸零、答案正確）；`reasoning_effort` 在需要逐步推理的題上也測不出差別。所以只有「整個角色關閉思考」這一個開關。agent 的 `variant` 在 `opencode run` 中不生效，不採用。

**參數放在運行設定：** `thinking` 只對特定 provider 有效，放在批次的運行設定（與 `provider`／`model` 同一層），不寫進產品角色檔或產品 `opencode.json`。launcher 只合併各角色的 `agent.<角色>.options`，其他欄位出現就拒絕；生效值記在 `state/run.json` 的 `agentOptions`，用法見 `config/README.md`。

**按角色的決定：**
- **Solver：關閉。** r20 兩臂各兩次（throwback），四次都解出；Solver 單次延遲降到約 1/3–1/4，每次少約 4–5 分鐘（約佔牆鐘 25–30%），調用次數與工具錯誤沒有增加（[r20 結果](../../gates/run-cost-20261104/r20-solver-thinking.json)）。只適用 `volcano-plan/deepseek-v4.1-flash`；跑到 Solver 卡住的題目時加一組開啟思考的對照，解題變差就按題型回退。
- **Coordinator：關閉（2026-11-06 決定）。** a2、a3 共 6 次 Coordinator 回合因思考用完 `limit.output=8000` 而以 `finish=length` 結束，每次約 51–58 秒，靠 [Root 續接](2026-10-25-design-v1-run-readiness-and-result-completeness.md) §4.1 才繼續。屬低風險角色，不單獨驗證；不提高輸出上限，因為那只會讓截斷前的思考更長。下一批記錄 `length` 次數與派單選擇，派單明顯變差（如不再派 Critic 或 Engineer）就回退。
- **Recon：保留。** 它是剩下最大的時間來源，但影響解題率，沒有難題對照前不關。
- **Verifier：保留。** 驗證標準優先，成本由 §3.4 處理。
- **Intake、Engineer：** 收益小（三個低風險角色合計約佔 8%），不單獨處理。

### 3.3 題內並行

**狀態：延後。**

**問題：** 並行度為 1。Recon 交回後同時派兩個 Solver 可能縮短牆鐘，但 token 增加，調度、預算、結果合併與停止規則都要改。

**可行性（離線審閱）：** 機制上大致可行：依序 assign → task(background) 兩次就能起兩個同角色任務，並發角色共用同一筆原子預留（Recon 重設計 §5）。但收益不確定：只有在至少兩條可信度相當、互不依賴的路線時才省時間，第一條路線就解出時只會讓 token 翻倍。未解的問題有三個：背景任務執行中不會喚醒 Coordinator，只能等其中一個交回再停另一個；一個 Solver 觸發 closure 會吃掉共享預算；兩條並行軌跡如何對應 episode／lesson 的來源未定義。

**若要做，只考慮：** Recon 列出至少兩條未測路線時才並行，上限 2 個，第一個候選被接受後停掉其餘任務；或在仍需送驗時讓提交與 Verifier 同時進行。並行實驗不與其他提速改動放在同一批次。

### 3.4 Verifier 按條件觸發

**狀態：已採用（直接提交與送驗回退兩條路徑都在真實 run 走通）；不限次數裁判去掉出處條件已實施（`b2dab475`），待真實 run；「答錯後團隊繼續」尚無樣本。**

**問題：** 每次提交都先經 Verifier，約佔牆鐘的 13–26%，常因 `finish=length` 截斷，且實際上常把 Solver 最後一段再執行一遍。至今 10 次 Verifier 判定沒有一次 rejected，從未改變結果；inconclusive 也照常提交並被接受。

**依據：** 自 2026-10-28 起 verified 已不是提交前置（design v1 §1.3、[D](2026-10-24-design-v1-d-candidate-verification-minimal.md) §5–7），Verifier 只有在給出有反證的 rejected 時才改變行動。題目有即時 oracle、答錯無懲罰時，錯誤提交的代價接近一次調用，Verifier 卻固定花 2–4.5 分鐘。外部參考：[D-CIPHER](https://arxiv.org/abs/2502.10931) 與 NYU CTF baseline 沒有 Verifier，答錯由 oracle 回報後繼續；XBOW 只在沒有 oracle 的場景才驗證，且改用確定性 validator。

**規則：**
- **直接提交：** 有裁判、次數不限、無冷卻或封鎖、同題同裁判範圍沒有 `wrong_answer` 時，`ctf_completion_request` 可不帶 `result`，Engineer 固定候選後直接提出；oracle 擔任驗證。
- **仍然送驗：** 無裁判（`candidate_only`）；次數有限、有冷卻、有懲罰或限制未知；同題已有 `wrong_answer` 後的下一個候選。條件不成立時以 `verification required:` 拒絕。觸發時 Verifier 仍是獨立上下文，三層方法與「不補證、不重解」不變。
- **出處只記錄：** 候選是否出現在 host HTTP 捕獲中，寫入審計與 completion 記錄（`captureResources`），不再決定准入。原先「只認 HTTP 捕獲」的條件在 a1–a3 攔下的 4 次全是正確候選，因為 job 才是 Solver 取得結果的主要途徑（a3 C1 有 204 次 `job.run`、4 次 `http.request`）。
- **不變：** 精確提交、錯誤候選去重、unknown 暫停同題提交、只有 host 回執才算 solved（D §7）。

| run | 條件 | 結果 | 能說明什麼 |
| --- | --- | --- | --- |
| r21（V1、V2 throwback，M1 mfw；[結果](../../gates/run-cost-20261104/r21-oracle-first.json)） | 裁判不限次數 | 3 次都直接提交、一次被接受，Verifier 從未派出 | 每次省下 Verifier 的 2–3.5 分鐘，解題不變；throwback 的牆鐘差異被其他角色的波動抵消 |
| r22（mfw；[結果](../../gates/run-cost-20261104/r22-verify-fallback.json)） | 裁判改為 `attempts: limited, max: 3` | 不帶 `result` 被拒 → 派 Verifier（inconclusive）→ 帶 `result` 提交被接受 | 送驗回退路徑走通，沒有重試直接提交，也沒有提前結束 |
| a1–a3（4 次出處條件拒絕） | 裁判都不限次數 | 3 次經 Verifier 後被接受，從被拒到被接受 148–191 秒；1 次在 deadline 前來不及提交 | 推翻「只認 HTTP 捕獲」的依據；a3 C3 那次的候選是否正確無法從記錄判斷 |

**風險與觀察：** 錯誤提交會更早到達 oracle。下一次授權批次記錄 `wrong_answer` 次數及其後 Coordinator 是否繼續派單；出現 Verifier 回 rejected、或同一 run 多次答錯後停止的樣本，回到本節。flag 格式檢查未做，因為題目設定沒有格式欄位。

### 3.5 已試路線摘要

**狀態：延後。**

r19 中重複探索不是主要成本，但未解出的 r18 A 有大量同路徑重複。有更多卡住的題目樣本時，歸入 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) 的後續事項評估，不在本文推進。

## 4. 量測方法

- 每次修正後，用 `tests/manual/run-cost-breakdown.py` 對新 run 重算，與 §2 同欄位對比；結構化結果放 `docs/gates/run-cost-<日期>/`。
- 單次 run 的差異只作方向參考。要宣稱提速，至少同題重複兩到三次，並報告解題結果。
- 判定規則：解題不差且目標指標改善才採用；解題變差就回退；結果不一致（如一勝一負）記為未定，不擴大結論。
- 真實 run 需另行授權：目標、模型／provider、批次與 token 上限。

**未解題組的配對量測（待授權）：** a2–a4 的停止規則與思考設定各不相同，且每題只跑一次，只能看方向。配對批次只量測已實施或已定的改動：§3.2 Coordinator 關閉思考、§3.4 出處條件修訂，以及之後若實施的交回時決策事實。設計為同三題（bypassit2、ezbean、ezoj）× 2 臂 × 每臂 2 次，兩臂只差一項改動，各項改動分批配對、不疊加。closure 觸發條件已離線重算後暫不採用，見 [Recon 重設計](2026-10-29-design-v1-recon-redesign.md) §5。

每次 run 記錄：accepted 與提交次數、`wrong_answer` 次數；首次 Solver 交回、進入 Engineer、首次 completion 請求的時刻；各角色調用數與 observable token；是否觸及 deadline；Coordinator `length` 次數。
