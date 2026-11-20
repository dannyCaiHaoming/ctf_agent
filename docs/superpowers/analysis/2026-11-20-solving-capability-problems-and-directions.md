# 解題能力現況復盤：問題清單與優化方向（2026-11-20）

**狀態：** 現行（復盤文檔）。2026-11-20 已執行：§6 第一批 1–4、第二批 1（交接權威對照）、2（Skill 現況表，見 Skill 發現與使用 §11）、5（導讀句）；方向 2 的兩項觸發位置候選已在 harness 備好單變量對照（Skill 發現與使用 §10），模型對照待授權；方向 1 第一個選題的範例已審閱並寫入 Reference §6（B §7 第 5 項），效果待同版本配對驗證。仍待用戶決定：§6 第一批 5、第二批 3–4 的刪除與入口標籤。本文只彙整既有 design、分析與 gate 摘要記錄的結論，不構成新決定、產品改動或任何模型運行授權；涉及真實 run 的驗收一律依 [AGENTS.md](../../../AGENTS.md) 另行授權（目標、模型／provider、批次、token 上限）。

## 0. 範圍與證據等級

**閱讀範圍。** 產品包（[product/AGENTS.md](../../../product/AGENTS.md)、`product/opencode/agents/` 的八份角色檔與三個 Skill 目錄）、[文檔索引](../README.md)、[核心 design v1](../specs/2026-10-22-ctf-agent-design-v1.md)與[現狀與遷移記錄](../specs/2026-10-22-ctf-agent-current-state-and-migration.md)、四份子設計（[團隊決策上下文](../specs/2026-11-07-design-v1-team-decision-context.md)、[B 方法與效率](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md)、[固定決策點診斷](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md)、[解題延遲與上下文成本](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md)），以及四份分析（[runtime 歸因復盤](2026-11-18-runtime-attribution-run-review.md)、[Coordinator 角色檔審閱](2026-11-19-coordinator-role-audit.md)、[開源對照隱患審閱](2026-11-19-oss-latent-risk-review.md)、[開源調研](2026-11-12-open-source-ctf-skill-survey.md)）。

**證據等級。** 本文引用的數字全部來自上述文檔記錄的 gate 摘要與設計正文；寫作過程未重跑 run、未重算資料、未讀 transcript、未連任何題目目標。開源結論沿用來源文檔標註的核對等級：已按原文核對、README／摘要轉述、或搜尋摘要未讀原文（僅作線索）。

**權威關係。** 各問題的決策權威在對應 design；本文是跨文檔的彙總復盤，與 design 衝突時以 design 為準，不恢復歷史待辦、不預排里程碑。

## 1. 結論

- **主瓶頸唯一且已定位。** 取題、工具、協作、獨立驗證與可信提交整條鏈已接通並有 solved 樣本；同版本 7 題 × 2 次的基線 14 個 run 中 6 個解出、8 個從未提出候選。瓶頸在 Solver 的方法內容與運用，不在資料交付、續派或工具能力。
- **第二層缺口在兩個承接環節。** 方法在決策點的觸發不可靠（Skill 調用基礎率極低）、工作簿修正不寫回（錯誤前提跨輪固化、視圖膨脹省略）。「再加一句提示」的路線已被合成對照與設計決定先後否定，後續應走 host 機械結構與位置調整。
- **一個高危害的具體失敗形態。** 把「未測／受限」當「不可解」提前收尾——ezoj 三次失敗 run 與一次成功 run 的關鍵差異；為此交付的歸因 Skill 尚未通過真實 run 驗收。
- **測量本身是當前約束。** 每格 2 次、單一 flash 模型的樣本量分辨不了多數行為差異；先讓測量可信，再排優化順序。

## 2. 當前存在的問題

### 問題 1：主瓶頸是 Solver 不產出候選，缺口在方法內容與運用

- **理由。** 整條鏈已接通且有 solved 樣本；多輪歸因已排除資料交付、候選承接、無候選續派、Critic 建議被忽略與工具能力等替代解釋，剩下的統一缺口是方法層內容。觸發與承接不解決時（問題 3、4），補內容的收益會被乘掉，但瓶頸本身在此。
- **核心依據。**
  - 基線（[B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)、[摘要](../../gates/candidate-baseline-20261119-p1/summary.json)）：7 題各 2 次、14 個 run 全部正常結束（無 deadline／預算停止），合計約 5.37M 可觀測 token；6 個產出候選包並提交、原 run solved，8 個無候選。EspressoCoffee、RustAction、Bad_Traveling 三題 0/2。
  - 「內容缺失，不只是發現失敗」（[團隊決策 §1](../specs/2026-11-07-design-v1-team-decision-context.md#1-結論)）：配對批次 on-2／off-2 的 Reference 讀過現有 Web Skill 目錄與兩份 Reference（off-2 另讀 SKILL.md），內容沒有 OGNL 成員存取／靜態呼叫、運行時審計限制下替代執行路徑這類方法。
  - 排除協作與工具缺口：無候選續派合理性 a 16/19、無一次忽略換路訊號（[Q1 核對](2026-11-09-q1-redispatch-check.md)）；3 次 Critic 建議全部被承接；HTTP、artifact、package、verification、job 在成功 run 均正常（[B §7.1](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#71-配对批次无候选复盘2026-11-17)）。
- **解決辦法。** 依 [B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序) 優先序第 5 項：從基線 run 中具體、可覆核的失敗環節選題（優先 1/2 的 ac5a1bc0、ezoj；0/2 題須能說明方法缺口才再投入），只補通用、無害的流程層方法；驗收看首次候選時間、候選數與整題解出，同版本配對 run 另行授權。利用類方法依 2026-11-18 用戶決定不建。

### 問題 2：工作簿「能寫」但「不被維護」——修正不寫回、只增不取代、假設不關閉

- **理由。** 工作簿是唯一的跨角色共享狀態主本（規則見 [product/AGENTS.md](../../../product/AGENTS.md)「題目工作簿」）；模型不維護它時，錯誤前提跨輪固化、視圖膨脹觸發省略，整套狀態管理的投入無法兌現為承接品質。
- **核心依據。**
  - 首輪之後 29 個 Solver 回合有 16 個只新增、不取代自己的舊條目；派單提到取代或更新也沒有明顯幫助（5/10 對 7/19，且集中在同一個 run）（[團隊決策 §6.2](../specs/2026-11-07-design-v1-team-decision-context.md#62-派單與交回的內容契約)、[固定決策點 §6](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md#6-離線核對結果)）。
  - 假設很少被更新或關閉：13 個 run 共 5 次更新、結束時仍 28 條有效；僅 2 次升級 supported 且都附新 ref——「升級缺新依據」不是常態，常態是不更新（[固定決策點 §6](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md#6-離線核對結果)）。
  - 修正不寫回的完整實例（[runtime 復盤 §2](2026-11-18-runtime-attribution-run-review.md)）：rtd2-ezoj-on-2 中 Solver 載入歸因 Skill 後，交回文字已並列解釋，工作簿條目未改；下一輪新建 Solver 沿舊條目把「部署不一致」升級為 supported 並稱唯一解釋。
  - 視圖省略已在真實 run 出現（[隱患審閱](2026-11-19-oss-latent-risk-review.md)第 1、2 項）：26 個 run 中 2 個未解 run 從第 12–14 分鐘起省略 10 條、5 條，全是仍有效條目、以 Recon 早期事實為主；兩 run 的 Solver 寫入僅 1/25、0/28 是取代；Coordinator 視圖峰值最高達上限的 99.8%。
- **解決辦法。** 不再加提示：回合內 own_open 提示的合成對照未過事先門檻，已判不實作（[團隊決策 §6.2](../specs/2026-11-07-design-v1-team-decision-context.md#62-派單與交回的內容契約)）。沿 host 機械結構：省略規則已改為「先壓縮成短列、受保護條目不刪」，通過離線重放與 840 項確定性測試，待真實 run 觀察 `recon.read` 展開與判斷改善；後續候選為 Critic 唯讀視圖與衝突呈現（[團隊決策 §6.4](../specs/2026-11-07-design-v1-team-decision-context.md#64-後續片前一片成立且有行為證據後才拆)），等「摘錄缺失導致誤判」有證據再定。

### 問題 3：歸因誤判——把「未測／受限」當「不可解」提前收尾

- **理由。** 一次存取失敗被寫成「部署不一致」後，整題沿這條實際未被否定的路線收尾，剩餘可試時間不再產生候選機會；同題對照證明該結論至少不完整。
- **核心依據。**
  - ezoj 同題對照（[團隊決策 §6.3](../specs/2026-11-07-design-v1-team-decision-context.md#63-候選與收尾)）：3 次失敗 run 把 `/flag` 為 root 0600、服務 uid1000 判為「部署不一致」後停止；同題 on-2 走另一條執行路徑，9.2 分鐘取得 accepted 候選。
  - 停止歸因（同節、[gate](../../gates/stop-attribution-20261119/summary.json)）：兩批 15 個未解 run 中 11 個的最後 blocker 記為環境／工具邊界，僅 4 個方法側；其中 ezoj 的 3 次 environment 結論已被同題成功否定。
  - 已交付資產未生效（[B §7.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#72-python-运行时阻断归因)）：`python-runtime-diagnosis` 三次真實 run 驗收未過——載入晚於第一條錯誤記錄或 0 次載入；唯一一次載入只讀 SKILL.md；修正未進工作簿（與問題 2 同一實例）。
- **解決辦法。** 資產已存在，缺的是觸發與承接，與問題 2、4 合流處理：歸因檢查放進決策點可見的位置（方向 2）、修正寫回工作簿（方向 3）；Coordinator 角色檔與證據不符的 B1／B2 類前提已有修訂清單，待用戶逐項審（[Coordinator 審閱](2026-11-19-coordinator-role-audit.md)）。

### 問題 4：Skill 觸發不可靠，提示詞補丁循環已判無效，角色檔仍持續膨脹

- **理由。** 方法內容補齊後若不在需要的決策點被觸發，投入直接被乘掉；「改一句提示→跑整題→查哪句沒遵守」分不清沒觸發、內容不足、沒採用與執行失敗，已被 [B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序) 明確否定，繼續堆文字只會稀釋注意力。
- **核心依據。**
  - 觸發基礎率（[runtime 復盤 §3–4](2026-11-18-runtime-attribution-run-review.md)）：56 個有 control-audit 的 run 中 Solver 僅 2 個調用過 `skill`（之後約 45 個 run 為 0）；58 個 Coordinator session、384 次派單點名任何 Skill 僅 3 次；r7 全 run 0 次調用（[B §8.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md)）。
  - 合成與真實的差異（[固定決策點 §7](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md#7-模型對照結果)）：短上下文合成案例兩變體都 3/3 載入，真實任務中途不載入；並首次出現反向誤觸發（round 案例的 method-provided 3/3 誤載入 `python-runtime-diagnosis`）。
  - 角色檔膨脹（[Coordinator 審閱](2026-11-19-coordinator-role-audit.md)）：coordinator.md 達 103 行／12,413 bytes，三天 6 個 commit 只增不刪；審閱發現 3 處與證據不符的前提、4 處重複、停止條件散在 3 節。停止規則 3 次變更後真實 run 只部分遵守，其中 1 次聲稱已全部關閉但仍有 open 條目（[runtime 復盤 §5](2026-11-18-runtime-attribution-run-review.md#5-停止规则的变更后观察)）。
  - 外部旁證（搜尋摘要、未讀原文，僅作線索；[開源調研 §8.2](2026-11-12-open-source-ctf-skill-survey.md#82-載入與觸發可靠性證據)）：Vercel 評測 56% 的 case 中 skill 從未被調用；另一小樣本中純 skill 調用率 6%、加 hook 後 66%——調用是可靠性問題而非內容品質問題。
- **解決辦法。** 改位置不改文字：先做 Coordinator A 類不改行為的去重；兩個已立案候選按序驗證——host 機械傳遞上一輪已載入的 Skill 名稱與來源（[B §7.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#72-python-运行时阻断归因) 待定項，token 成本與過時方法風險待評）、常駐精簡方法索引（一行一條）進角色 prompt／工作簿視圖（[開源調研 §9.1](2026-11-12-open-source-ctf-skill-survey.md#91-值得借鑑)，保持短以避免注意力稀釋）；每項先過固定決策點式單變量對照再進產品。

### 問題 5：評估樣本與成本結構不足以支撐行為結論

- **理由。** 目前所有「方向性」結論（思考開關、工作簿收益、停止規則）都建立在每格 2 次、單一 flash 模型上；分辨 50%→70% 的整題差異每臂約需 93 次（雙側 5%、80% 檢定力的示例尺度）。執行完全串行，牆鐘等於模型時間。
- **核心依據。**
  - 思考設定對照（[B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)）：3 題 A/B/B/A 交錯，思考開 3/6、關 2/6，僅 RustAction 有方向（1/2 對 0/2）；token 開 1.96M、關 2.29M，關閉臂反而偏高。
  - 工作簿配對批次（[團隊決策 §7.2](../specs/2026-11-07-design-v1-team-decision-context.md#72-真實能力驗收)）：候選被接受開啟組 3/6、關閉組 2/6，兩組持平；開啟組在一題上派單與打包較早、非讀取重做較少，只算初步方向。
  - 延遲結構（[延遲設計 §2](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md)）：r18/r19 並行度 1.00；單次延遲與生成 token 相關 0.98–0.99、與上下文大小僅 0.08–0.21；r19 A 生成量 74% 是 reasoning。
  - 剩餘時間未轉化（[B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)）：兩批 15 個未解 run 有 10 個停止時仍剩約 9–24 分鐘（其一按牆鐘補算）；8 個 Critic 後 Solver 僅工作 0–1.7 分即停，成因是 redirect 本身就是一次短的有界實驗；1 例 proposed 候選 11.7 分寫入後未交回、未派 Engineer，而成功 run 從候選條目到派 Engineer 僅隔 0.2–0.8 分。
  - 已採用並驗證的節流（[延遲設計 §3](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md)）：追加上下文去重（r19 A 追加量 693KB→267KB、未緩存輸入降 31–36%）、Verifier oracle-first（10 次 Verifier 判定 0 rejected、r21 三次直接提交每次省 2–3.5 分）。思考設定在 r20 驗過「Solver 關閉省 25–30% 牆鐘」後，近期基線又以開思考作為對照變量，對難題的影響仍未驗證。
- **解決辦法。** 優先用 1/2 區分度的題加次數而非鋪新題；換模型單變量對照按 B §7 第 4 項另批授權（先加對照模型配置，不與思考對照混批）；配對工具（`paired-run.mts`、`paired-control-product.py`）與題集資格檢查已備好直接復用；成本報告並列牆鐘、停止時間與 token。收尾時間利用率與「剩餘時間重開」依 2026-11-19 歸因維持延後，僅持續觀察 `first_candidate_entry_min` 與 `candidate_to_engineer_min`。

## 3. 核心優化做題解出能力的方向

### 方向 1：候選產出導向的方法補齊（主線）

- **理由。** 瓶頸已被定位且唯一；主驗收已從「Skill 載入率」校正為「方法選擇與連續執行產出候選」，防止目標漂移——這本身是 B §7 記錄過的教訓。
- **核心依據。** 問題 1 的全部證據；外部旁證（已按原文核對）：EnIGMA 去掉帶試錯過程的 demonstration 後整體解出率 29.5%→23.3%，是其最大消融項；PentestGPT 去掉外顯狀態管理後子任務完成數僅剩完整版的 53.6%、低於裸模型（[開源調研 §3、§8.4](2026-11-12-open-source-ctf-skill-survey.md#84-有消融證據的知識類別)）。「方法範例＋外顯狀態」是目前僅有的兩支有消融證據的知識類別。
- **解決辦法。** 按「區分度選題 → 從失敗環節定義方法缺口 → 只寫通用、無害的流程層內容 → 同版本配對驗收」循環推進；內容形態優先 demonstration 形式（帶失敗→改法轉折的短範例，不含利用細節與題解），次選原則羅列；「已測≠已否定」的歸因方法、「列舉先於猜測」屬此類流程層。利用類方法依用戶邊界不建（[B §7.1](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#71-配对批次无候选复盘2026-11-17)，2026-11-18 決定）。

### 方向 2：方法在決策點的可見性（發現層：位置優先於措辭）

- **理由。** 內容與觸發是乘法關係；觸發基礎率極低時，補內容的邊際收益被乘掉（問題 4）。
- **核心依據。** 問題 4 的全部證據；外部對照：VulnClaw「索引常駐、正文按需」提供 description 匹配與全文預載之外的第三種位置（README 轉述）；Vercel／Claude Code 的調用率對比（搜尋摘要等級）指向位置與提醒機制而非內容品質。
- **解決辦法。** 兩個已立案候選按序驗證（見問題 4），均先過固定決策點式單變量對照再進產品；「載入率」嚴格定位為輔助觀察，不作收益判據（B §7 既有決定）。

### 方向 3：工作簿從「能寫」到「被維護」（承接層）

- **理由。** 修正不寫回是已證實的承接主缺口；「未驗證解釋經派單固化」與 D-CIPHER auto-prompter 被誤導性編碼帶偏 Planner 是同構問題（已按原文核對）。
- **核心依據。** 問題 2 的全部證據；PentestGPT 的外顯狀態是有消融證據的一支；BreachWeave Idea／Memory 分離、Cairn Fact／Intent 分離只是結構同向、無消融（轉述等級，[開源調研 §8](2026-11-12-open-source-ctf-skill-survey.md)）。
- **解決辦法。** 短列＋受保護條目規則用真實 run 驗證（看 `recon.read` 展開率與判斷改善，不看條目數）；評估 Critic 唯讀視圖與衝突呈現（[團隊決策 §6.4](../specs/2026-11-07-design-v1-team-decision-context.md#64-後續片前一片成立且有行為證據後才拆)）；維持不加提示詞的紀律。

### 方向 4：評估基線與預算結構（讓結論可信）

- **理由。** 每個行為改動的驗收都被樣本量卡住；先讓測量可信，優化排序才有依據（問題 5）。
- **核心依據。** 問題 5 的全部證據；已採用的三項改動（追加去重、思考開關驗證、Verifier oracle-first）證明單變量配對路線可行且效果可收回（[延遲設計 §3](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md)）。
- **解決辦法。** 區分度選題加次數；模型／思考單變量另批授權；配對工具復用；成本報告並列多欄。收尾與剩餘時間維持延後與觀察（問題 5 解決辦法末段）。

## 4. 建議優先序與下一步

| 順序 | 投入 | 對應問題 | 現成基礎 |
| --- | --- | --- | --- |
| 1 | 方向 1（方法補齊）＋方向 2（觸發位置） | 問題 1、3、4 | 7 題基線與選題規則已建立；兩個觸發候選已立案 |
| 2 | 方向 3（工作簿維護驗證） | 問題 2、3 | 短列規則已實作並通過離線重放，缺真實 run 觀察 |
| 3 | 方向 4（評估擴展） | 問題 5 | 配對工具與題集資格檢查已備好 |

優先序是本文的彙總建議，不是 design 決定。下一步由用戶選定要推進的問題／方向並決定是否授權對應批次；本文不自行啟動任何工作。

## 5. 未列入問題清單的已知邊界

以下屬已記錄的能力邊界，但在當前 7 題基線上不是主要失敗原因：

- **圖像觀察。** seizure 類題目兩次 run 皆卡在「看圖」；候選 A（`workspace.view` 圖像交付）已合入 main、模型能否藉此解題未證實，B／C／D 未做（[現狀記錄 §0.2](../specs/2026-10-22-ctf-agent-current-state-and-migration.md)、[圖像觀察 design](../specs/2026-10-29-design-v1-image-observation.md)）。
- **領域範圍。** Pwn／Reverse／Mobile 不在首版範圍（design v1 §1.1），屬範圍決定而非缺陷。
- **發布形態。** 網路隔離（namespace 預設拒絕已選定、完整 origin scope 未通過）、ARM64 鏡像與正式成功率門檻是 design v1 第 3 節待決項，不影響當前解題基線的歸因。
- **已記錄的單點限制。** Q5 promotion、同步 Verifier 不開放等見對應 design，本文不重複、不恢復。

## 6. 文檔庫核查與整理方案

本節為 2026-11-20 應用戶要求增補：核查 `docs/` 下現有文檔，識別過時、未更新、設計偏差與「有問題但未解決核心」的路線，並提出整理方案。與 §0–§5 的解題能力復盤相互獨立，共用「只讀、不構成授權」的邊界。

### 6.1 核查方法

- **對象。** `docs/` 全樹：`docs/superpowers/`（README、`specs/` 24 份＝核心設計＋遷移記錄＋22 份子設計、`analysis/` 14 份含本文）、`docs/gates/`（39 個頂級條目）、`docs/local-challenges.md`（2026-11-19 仍在更新，無問題）、`docs/plans/`（空目錄）。
- **機械檢查。** 全庫 39 份 Markdown 共 569 個內部連結逐一定位，含錨點與標題 slug 比對；每份文檔取 git 最後修改日；對 gates 建反向引用索引（哪些 gate 未被任何文檔提及），並在倉庫全域（AGENTS／CLAUDE／程式／測試）複核未引用項。
- **內容核對。** 逐份讀狀態行與開頭結論，對照 README 索引行與 2026-11-16／17／19 三批新證據（冒煙 run、配對批次、7 題基線與停止歸因）。
- **限制。** 未讀 gates 原始證據內容、未重跑 run、未逐行比對設計與程式實作；「設計偏差」僅指文檔之間與文檔內部可核對的不一致，不等同實作偏差審計。

### 6.2 核查發現

#### A. 機械問題（可直接修，不觸決策）

| # | 發現 | 位置與依據 |
| --- | --- | --- |
| A1 | 3 個失效錨點，均因引用方指向已被改寫的標題 | [single-agent-capability-analysis](2026-10-29-single-agent-capability-analysis.md) 兩處指向 B 舊「§7 方向与优先序」標題錨；[B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md) 一處指向[開源調研](2026-11-12-open-source-ctf-skill-survey.md)舊「§9 來源清單」錨（第二批擴寫後該節已改編號）。569 個連結中僅有的失效項 |
| A2 | 內容更新未同步狀態行 | [G §5.3](../specs/2026-10-23-design-v1-g-solver-minimal.md) 已於 2026-11-20（commit `27487890`）補 job 逐流審計與三種結果分述，該檔頂部狀態行仍寫 2026-11-10 |
| A3 | 目錄約定與實際不符 | [README 目錄約定](../README.md)寫 `plans/`（按上下文是 superpowers 相對路徑），實際只有空的 `docs/plans/`；`docs/superpowers/plans/` 不存在 |
| A4 | gates 根目錄雜項 | 未追蹤的 `__pycache__/`（24KB，本機腳本殘留）；散檔 `t0c-arm64-results.md`（2026-10-17、早於 design v1、全庫零引用） |
| A5 | 入口標籤誤導 | 根目錄 AGENTS.md／CLAUDE.md 把[現狀與遷移記錄](../specs/2026-10-22-ctf-agent-current-state-and-migration.md)列為「現狀、教訓與清理方向」入口；該文檔自身已聲明「歷史記錄，不再隨進展更新」（2026-11-10 凍結） |

#### B. 狀態行滯後於新證據（內容未錯、快照過期）

| # | 文檔（狀態行日期） | 滯後點 |
| --- | --- | --- |
| B1 | [Recon 重設計](../specs/2026-10-29-design-v1-recon-redesign.md)（2026-11-12） | 「§4 索引按需讀取…模型行為待真實 run」——11-16 冒煙 run 已實測 summary 索引：單次投影最大約 56K→15K、模型展開過 1 次 `recon.read`（[團隊決策 §6.1](../specs/2026-11-07-design-v1-team-decision-context.md#61-題目工作簿第一片)）。機制已在真實 runtime 觀察到，收益未驗——狀態行應更新到這個層次 |
| B2 | [否定證據與路線複核](../specs/2026-10-25-design-v1-negative-evidence-and-route-review.md)（2026-11-10） | 「r10 首次 Critic redirect…仍未驗證」——11-17 配對批次 2 次 redirect 均被承接；11-19 停止歸因中 15 個未解 run 有 13 個派過 Critic、9 個出現 redirect 且其後有界實驗確有執行（[團隊決策 §6.3](../specs/2026-11-07-design-v1-team-decision-context.md#63-候選與收尾)）。「承接」已被觀察證實、「判斷品質」仍未驗收，兩個層次都滯後 |
| B3 | 同 A2 | G §5.3 三種結果分述已寫入正文，狀態行未反映 |
| B4 | [本地三題練習](../specs/2026-10-24-design-v1-local-practice-suite-and-progress-ledger.md)（2026-11-10）及其索引行 | 「三題批次未授權、部分題目 oracle 未核實」——其後 mfw／throwback 在 r8-2、r18–r22 多次真實運行且 exact judge 已核對（seizurecipher 仍未核實）；「固定三題批」框架未被採用，題集與驗收職能已由 [B §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序) 的 7 題基線與資格檢查承接，進度帳本部分仍有效。文檔與索引行均未記錄這層演進關係 |

#### C. 權威重疊／被取代未清理

| # | 發現 | 依據 |
| --- | --- | --- |
| C1 | 交接權威雙軌：[交接連續性](../specs/2026-10-24-design-v1-agent-handoff-continuity.md)（10-24）「其餘交接建議仍為候選」與 [團隊決策 §6.2](../specs/2026-11-07-design-v1-team-decision-context.md#62-派單與交回的內容契約)（11-07 起）的派單／交回內容契約範圍重疊；後者是現行權威，前者未標注各候選已吸收、仍有效或已否決 | 兩檔狀態行與 design v1 §1.2 的雙重引用 |
| C2 | Skill 資產無現狀總表：現有 3 個 Skill 的觸發設計與驗收狀態分散三處——[Skill 發現與使用](../specs/2026-10-24-design-v1-skill-discovery-and-use.md)只覆蓋 web-session-diagnosis 的 v4/v5；python-runtime-diagnosis 的觸發與驗收在 [B §7.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#72-python-运行时阻断归因)；**recon-investigation 沒有任何 design 條目**，僅 `recon.md` 的指向行與 [runtime 復盤](2026-11-18-runtime-attribution-run-review.md)的載入統計提及 | 三檔範圍聲明與全庫檢索核對 |
| C3 | 2026-10-29 四份分析未標「已併入」：工具強化（search 多 needle／diff／coverage／job 摘錄）已隨 `1dde2b8a` 併入主區；[per-agent-strengthening-plan](2026-10-29-per-agent-strengthening-plan.md) 的兩項提案已實作；[single-agent-capability-analysis](2026-10-29-single-agent-capability-analysis.md) §3 的外部方法結論已被[團隊決策附錄](../specs/2026-11-07-design-v1-team-decision-context.md)按原文補核取代；[overnight-worklog](2026-10-29-overnight-worklog.md) 是純分支工作日誌 | [現狀記錄 §0.2](../specs/2026-10-22-ctf-agent-current-state-and-migration.md) 與各檔內容核對 |

#### D. 已否決／結論 unknown 的設計路線仍佔文檔與角色檔位置

這些是誠實的試錯記錄（規則要求保留否決方案），不是錯誤；共同點是**都沒有觸及 §2 問題 1 的核心（候選產出），核心仍在方法內容＋觸發位置＋狀態維護（§3 方向 1–3）**。問題在於已否決項與現行契約混排，檢索時難以快速區分：

- 提示詞補丁系列（指向行位置、停止規則文字、Skill 點名）：B §7 已定「不再繼續調提示位置」；`coordinator.md` 三天 6 個只增不刪 commit 的補丁文字仍在，待 [Coordinator 審閱](2026-11-19-coordinator-role-audit.md)的 A／B 類逐項處理。
- own_open 回合內提示：合成對照未過事先門檻，已判不實作（[固定決策點 §8](../specs/2026-11-18-design-v1-fixed-decision-point-diagnosis.md#8-未更新條目提示的模擬結果2026-11-18)）。
- 候選寫入後交回提醒：合成對照結論 unknown、不實作（[團隊決策 §6.3](../specs/2026-11-07-design-v1-team-decision-context.md#63-候選與收尾)）。
- [團隊決策 §2.2](../specs/2026-11-07-design-v1-team-decision-context.md#22-責任分工目標狀態) 的「Solver 局部補充觀察」候選仍未入角色檔；「跳過 Recon」候選已否定，以刪除線留在正文。

#### E. gates 清理候選（執行需另行確認）

| 項 | 核查結果 | 建議去向 |
| --- | --- | --- |
| `m1-web-validation`、`m1b-dvga-private-paste-20261020`、`m1b-real-web-pagination-20261020`、`m1b-real-web-scout-20261020` | 全庫零引用（含 AGENTS／CLAUDE／程式）；M1B 軌跡屬遷移記錄明列「不繼承」的範圍 | 刪除候選 |
| `t0c-arm64-results.md` | 2026-10-17、早於 design v1、零引用 | 刪除候選 |
| `m1-autonomous-first-challenge` | 被遷移記錄第 4 節引用，並明確保留為歷史最小證據 | 保留 |
| 其餘 33 個 gate 目錄 | 均被 design／analysis 引用 | 保留 |

### 6.3 分析：滯後的成因

- **design 側的紀律基本成立。** 24 份 specs 都有狀態行、都掛在 design v1 下、索引行齊全；「快照＋子檔」機制在起作用，B 類滯後沒有一處是內容錯誤。
- **滯後集中於一個模式：新證據先寫進當時活躍的文檔（團隊決策、B、分析記錄），上游或姊妹 design 的狀態行沒有回寫。** 現行規則要求「plan 結論回寫 design」，沒有要求「design A 的新證據同步 design B 的狀態行」；B1–B4 四例全是這個模式。
- **analysis 目錄沒有生命周期規則。** README 索引只收 design（本身合理），但一次性核對記錄（q1／q2／a5-e2／handoff-content）、活的審閱清單（Coordinator 審閱、隱患審閱）、調研（開源調研）與歷史輸入（10-29 四份）混排，無「已併入」標記慣例。
- **gates 只進不出。** 39 個條目自 2026-10-22 起累積，遷移記錄的清理方向是歷史授權、之後未再執行 gate 層維護；`__pycache__` 進入 gates 說明缺少最起碼的目錄衛生。
- **深層原因：文檔按「產出時刻」組織（日期前綴＋追加），而讀者需要按「現行契約 vs 歷史證據」檢索。** 缺的不是搬遷或新平台，是一層輕量的狀態標記（現行／已併入／歷史）與對應的回寫習慣。

### 6.4 整理方案

原則：**不移動檔案**（design→analysis→gates 的數百個相對連結依賴現有路徑）；**不建平行權威**；**刪除與合併逐項經用戶確認**；與 AGENTS.md「必要文檔復用已有位置」「清理前核對依賴與本次範圍」一致。

**第一批：低風險、可直接執行（單檔小改，不改任何決策內容）**

1. 修 A1 的 3 個失效錨點。
2. 補 B1–B4 對應 design 的狀態行：更新日期＋一句新證據層次與去向連結，正文不動。
3. 給一次性核對記錄（q1、q2、a5-e2、handoff-content）與 10-29 四份分析補一行「狀態：已併入 X §Y」；在 [README 目錄約定](../README.md)補 analysis 的三類用途（調研／一次性核對記錄／審閱清單）與生命周期規則（併入後標記，不自動刪）。
4. 修 A3：README 目錄約定改指實際路徑（或刪空目錄）；刪 `docs/gates/__pycache__`。
5. 修 A5：根目錄 AGENTS.md／CLAUDE.md 的遷移記錄入口標籤改為「歷史現狀與遷移」——屬根目錄指令變更，需用戶確認後改。

**第二批：需用戶逐項決定**

1. C1：交接連續性的剩餘候選逐條判歸——被團隊決策 §6.2 吸收的標「已吸收」、仍有效的併入、其餘標歷史；完成後該檔只留已落地事實。
2. C2：Skill 現狀總表二選一——擴[Skill 發現與使用](../specs/2026-10-24-design-v1-skill-discovery-and-use.md)為逐 Skill 註冊表（名稱、觸發設計、所屬 design、驗收狀態），或在 [A／B 資產設計](../specs/2026-10-22-design-v1-ab-product-assets.md)加表；recon-investigation 順帶補設計條目或納入註冊表說明。
3. C3：10-29 四份的去留——[ctf-tooling-analysis](2026-10-29-ctf-tooling-analysis.md) 被[圖像觀察設計](../specs/2026-10-29-design-v1-image-observation.md)引用，保留；single-agent-capability-analysis 修錨點後保留為歷史研究輸入（其外部結論已由團隊決策附錄與調研承接）；per-agent-strengthening-plan 與 overnight-worklog 結論已全部轉移且無引用，建議刪除（git 歷史留檔）。
4. E：五個零引用 gates 項刪除（`m1-autonomous-first-challenge` 保留）。
5. D 類不改內容（否決方案按規則保留原文）；可選地在 B §7 與團隊決策相關小節開頭加一行「本節含已否決候選」導讀，避免讀者誤當現行契約。

**不做**：不把 gates 併入 superpowers；不為 analysis 建 README 索引（維持索引只收 design，補的是生命周期規則）；不整批簡繁轉換；不新建成套 spec、檢查清單或審計報告；刪除範圍僅限 E 表與第二批第 3 項所列。

### 6.5 本次執行邊界

本次核查為只讀：第一、二批均未執行，待用戶確認後另做；核查用的連結／錨點檢查為臨時腳本，未入庫。所有「刪除候選」僅為建議、git 歷史保底，不構成清理授權。
