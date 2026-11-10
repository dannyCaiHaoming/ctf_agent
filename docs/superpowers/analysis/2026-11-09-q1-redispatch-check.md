# Q1 續派合理性核對（2026-11-09）

**依據：** [團隊決策上下文](../specs/2026-11-07-design-v1-team-decision-context.md) §4 問題 1，分類口徑與判讀約定見該節（原驗證 plan 已於結論回寫後刪除）。只讀復盤，不解題。決策點取自 a3–a8 各 run 的 `evidence/task-executions.json`：每個 domain-solver execution 交回後的第一個派單。候選材料欄 a3–a6 沿用 [交回內容核對](2026-11-08-handoff-content-check.md) 第 3 欄，a8 本次判斷（a7 無計入列）。

## 分類表

| batch | run | ref | next | 分類 | H 有下一問題 | D 來源 | 候選材料 | 理由（抽象） |
|---|---|---|---|---|---|---|---|---|
| a3 | C1 | 56b167ae | domain-solver | a | 是 | 混合 | 否 | D 把 H 的「認定部署缺陷」改為「下結論前先逐條排除未測線索」，並補上 H 未列的新前提 |
| a3 | C1 | d0a12c72 | domain-solver | a | 是 | 自擬 | 否 | D 改目標為原生庫載入白名單繞過，開一個先前未派的攻擊面 |
| a3 | C1 | 8832882e | (no handback) | 只記錄 | — | — | — | 無交回 |
| a3 | C2 | 60b35cf8 | reference | a | 是 | 採用 H 建議 | 否 | D 就 H 指出的 getter 觸發缺口發 Reference 查可用 gadget 類 |
| a3 | C2 | 0efe4c4f | domain-solver | a | 是 | 混合 | 否 | D 承 H 的觸發鏈，改走不需遠端 codebase 的本地 factory 新子路線 |
| a3 | C2 | 3b549e74 | domain-solver | a | 是 | 混合 | 否 | D 設計延遲 oracle，用來區分「factory 未執行」與「已執行但回連失敗」兩個仍成立假設 |
| a3 | C2 | aa231df7 | — | 只記錄 | — | — | — | 無後續派單 |
| a3 | C3 | e7af5e4f | domain-solver | a | 是 | 混合 | 否 | D 改走 allowlist 容器突變／全域重綁的新線 |
| a3 | C3 | cfdf1dc7 | domain-solver | a | 是 | 混合 | 否 | H 稱四條線索用盡，D 改走子解譯器免審計逃逸的新路線（換路） |
| a3 | C3 | db0fcbdc | recovery-critic | 只記錄 | — | — | — | 下一派單為 Critic |
| a3 | C3 | 50c93dd4 | domain-solver | a | 是 | 採用 H 建議 | 否 | H 只寫計畫未執行，D 推動對已定位候選檔的實際逐 byte 提取 |
| a3 | C3 | 64ac9692 | engineer | 只記錄 | — | — | — | 下一派單為 Engineer |
| a4 | D1 | fc8d3415 | domain-solver | 前序截斷 | — | — | — | 本列交回 completeness=incomplete |
| a4 | D1 | 8da71662 | domain-solver | b | 是 | 採用 H 建議 | 否 | D 以「本輪只執行、你已知道全部」重述同一 payload 任務，未指出新前提 |
| a4 | D1 | fc3f7e9e | domain-solver | 前序截斷 | — | — | — | 本列交回 completeness=incomplete |
| a4 | D1 | 9947db02 | domain-solver | a | 是 | 自擬 | 否 | D 針對 H 新報的序列化阻塞改走手工序列化，屬新前提下的具體換法 |
| a4 | D1 | 3b6bd713 | domain-solver | b | 是 | 自擬 | 否 | 同一序列化阻塞再換一種變體，問題未變、無新前提 |
| a4 | D1 | 4da52cd5 | — | 只記錄 | — | — | — | 無後續派單 |
| a5 | E1 | 150d950d | engineer | 只記錄 | — | — | — | 下一派單為 Engineer |
| a5 | E2 | 8b3e877a | domain-solver | 前序截斷 | — | — | — | 本列交回 completeness=incomplete |
| a5 | E2 | bc3d63cb | reference | a | 是 | 採用 H 建議 | 否 | D 就 H 的 audit-free 讀取缺口發 Reference 查可用原語 |
| a5 | E2 | 81341393 | recovery-critic | 只記錄 | — | — | — | 下一派單為 Critic |
| a5 | E2 | 16e83238 | recovery-critic | 只記錄 | — | — | — | 下一派單為 Critic（本列亦 incomplete） |
| a5 | E2 | 4762631a | (no handback) | 只記錄 | — | — | — | 無交回 |
| a5 | K1 | d58ee1a4 | engineer | 只記錄 | — | — | — | 下一派單為 Engineer |
| a6 | F1 | 0c45bc96 | domain-solver | 前序截斷 | — | — | — | 本列交回 completeness=incomplete |
| a6 | F1 | 6500b58a | — | 只記錄 | — | — | — | 無後續派單 |
| a6 | F2 | 9e707b85 | domain-solver | 前序截斷 | — | — | — | 本列交回 completeness=incomplete |
| a6 | F2 | 7c03a98a | domain-solver | a | 否 | 自擬 | 否 | H 僅讀材料未實測，D 指派首次端到端外傳實驗（未完成的具體步驟） |
| a6 | F2 | e8dfd337 | domain-solver | a | 是 | 自擬 | 否 | D 改用父進程（可能 root）路徑穿越讀 flag 的新前提 |
| a6 | F2 | 321fefeb | domain-solver | a | 否 | 自擬 | 否 | 穿越被否證後 D 改走 setuid／sudo 提權的新面 |
| a6 | F2 | d872c491 | domain-solver | b | 否 | 自擬 | 否 | D 只重試前一派單已列的 sudo 選項，無新前提（時間盒末端） |
| a6 | F2 | 91288a4f | — | 只記錄 | — | — | — | 無後續派單 |
| a7 | F2 | ea579d28 | — | 只記錄 | — | — | — | 無後續派單 |
| a7 | K2 | 78f47d0a | engineer | 只記錄 | — | — | — | 下一派單為 Engineer |
| a8 | F1 | 97a900e9 | domain-solver | a | 是 | 採用 H 建議 | 無 | H 稱部署阻塞但列出 root 逃逸面，D 針對該唯一未測面做最後一輪探測 |
| a8 | F1 | cc4587f0 | — | 只記錄 | — | — | — | 無後續派單 |
| a8 | F2 | 8fc18f81 | recovery-critic | 只記錄 | — | — | — | 下一派單為 Critic |
| a8 | F2 | cf55e484 | domain-solver | a | 是 | 自擬 | 無 | D 新增「讀同 uid 進程 environ 找 flag」角度（此列為 Critic 併發期間派出，非 Critic 交回後） |
| a8 | F2 | 64157252 | domain-solver | a | 是 | 採用 H 建議 | 無 | D 收斂 H 新出現的 su root 線索做真偽驗證，方向與已交回 Critic 的「單輪合併探針」一致 |
| a8 | F2 | 7b30ca27 | — | 只記錄 | — | — | — | 無後續派單 |
| a8 | K2 | 2cab4b9b | engineer | 只記錄 | — | — | — | 下一派單為 Engineer |

## 匯總

**計入比例：N = 19**（a3 C1 2、C2 3、C3 3；a4 D1 3；a5 E2 1；a6 F2 4；a8 F1 1、a8 F2 2）。

- **主分類：** a = 16、b = 3、c = 0、d = 0。
- **按 run 分佈：**
  - C1：a 2 / N 2
  - C2：a 3 / N 3
  - C3：a 3 / N 3
  - D1：a 1、b 2 / N 3
  - E2：a 1 / N 1
  - a6 F2：a 3、b 1 / N 4
  - a8 F1：a 1 / N 1
  - a8 F2：a 2 / N 2
- **b（及 c）的 D 來源分佈：** b 共 3 列 — 採用 H 建議 1（D1 8da71662）、自擬 2（D1 3b6bd713、a6 F2 d872c491）；c 無。
- **H 有下一問題：** 計入列中 16 列是、3 列否（a6 F2 的 7c03a98a／321fefeb／d872c491）；3 個「否」中前兩個仍判 a（D 自提新前提），末一個判 b。
- **候選材料：** 全部計入列均為「否／無」——19 個決策點對應的交回無一提出候選材料（與 2026-11-08 核對一致，a8 三列本次確認同為無）。
- **前序截斷（只記錄）：** 5 列（D1 fc8d3415、D1 fc3f7e9e、E2 8b3e877a、a6 F1 0c45bc96、a6 F2 9e707b85）。
- **只記錄（next 為 Critic／Engineer／—）：** Critic 4、Engineer 5，其餘為無後續派單或無交回。

### 不確定的列（單人分類）

- **a6 F2 7c03a98a（判 a）：** H 本輪只讀材料、未實測，D 是「首次執行既有原語」而非在多個假設間作區分；判 a 取其「指派了未完成的具體步驟、非重述」，但區分力弱，與 b 邊界接近。
- **a4 D1 9947db02（a）／3b6bd713（b）邊界：** 兩者同為序列化阻塞的換法；本文以「首次對新報阻塞的適配」判 a、「同阻塞的再次變體」判 b。若採更寬鬆口徑，3b6bd713 亦可視為對阻塞的持續適配。
- **a8 F2 64157252（判 a）：** 該列與一份已交回 Critic 的建議方向一致，a 的成立部分依賴「D 採 Critic 方向收斂新線索」；若要求 a 必須相對先前 Solver 派單全新，則此列偏向 a/b 之間。

## 結論

**a = 16/19 ≈ 0.84 ≥ 2/3 N。** 按判讀約定，落入「Coordinator 的選擇大致合理，瓶頸在 Solver 方法」：design §4 問題 1 記此結論；第一片（派單／交回契約）維持暫緩，轉 P2 方法缺口。

佐證與限定：

1. **c = 0 是明確信號。** 每當 H 自稱路線窮盡（C3 cfdf1dc7、a8 F1 97a900e9）或已有 Critic 交回（C3 50c93dd4、a8 F2 64157252）時，Coordinator 都換了路線或收斂到新線索，未見「忽略換路訊號仍沿原路」。承接端（候選→Engineer）在 2026-11-08 已確認無缺口，本次「有換路訊號→確有換路」進一步支持缺口不在 Coordinator 決策。
2. **3 列 b 的性質。** 2 列（D1 3b6bd713、a6 F2 d872c491）D 來源為 Coordinator 自擬、且集中在 deadline 收尾（序列化重試、sudo 殘餘），屬時間盒末端的重複嘗試；1 列（D1 8da71662）為「只執行」式重述。三列全落在 bypassit2（D1）與 ezoj（a6 F2）的最後幾分鐘，不構成跨 run 的系統性派單缺口（b＋c 須出現在至少 3 個 run，此處僅 2 個）。
3. **候選材料全 0 呼應 2026-11-08。** 19 個決策點的交回無一提出候選材料，與「瓶頸在 Solver 未能產出可交 Engineer 的候選」一致；本結論指向 P2 的 Solver 方法／探索能力，而非續派邏輯。
4. **限定：** 結論建立在 3 道題（bypassit2、ezbean、ezoj）、ezoj 佔多數的 8 個 run 上，單人分類、無第二評審；上列三個不確定列若改判，a 比例最低約 13/19 ≈ 0.68，仍 ≥ 2/3，結論方向不變。
