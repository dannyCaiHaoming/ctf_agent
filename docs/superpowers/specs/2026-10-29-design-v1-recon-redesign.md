# Recon 重設計：完整過程軌跡、可導航上下文與及時交回

日期：2026-10-29；目前決策：2026-11-02（Asia/Tokyo）。

**狀態：** [核心 design v1](2026-10-22-ctf-agent-design-v1.md) 的 Recon 現行子設計。本文已取代舊備份與舊正式稿中的累積式回補，是 Recon 記錄、上下文中呈現、交回、快照消費及 episode／lesson 的單一權威。它定義產品目標與契約，不代表目前工作樹已完整實現，也不代表真實模型已驗收。

**目前停點：** 記錄與學習鏈路已收口。r16 暴露的問題（上下文重寫、Recon 未交回、episode 只看局部來源）已由 §3–§7 的實施處理；r17–r19 三個真實批次又找出並修正了參數丟失與三種學習失敗。到 r19，以下各環節都已在真實 OpenCode runtime 中走通（見 §8「真實批次的正反證據」）：
- 四個角色逐步記錄、參數完整；
- 追加式上下文；
- Recon 在 closure 前主動交回；
- A 的 episode 與 lesson 入庫，並自動呈現給 B。

這一段**不能**推出經驗讓解題變好：模型沒有翻看舊步驟，B 沒有主動查閱經驗，也沒有對照組。下一階段需另立 design 切片與 plan，候選事項：

- **經驗是否有用：** 同題、同模型、同預算的無經驗對照組（B0），以及成對的相似題；做之前先做經驗衛生：
  - 同題防回聲：檢索目前不排除同一題自己的經驗；
  - 入庫去敏：清理路徑、網址；
  - 失敗局只提煉「避免什麼」。
- **讀取端使用審計（§6）：** `index_received`、同一消費者讀到 `done`，以及經驗的 `read`／`evaluated`／`adopted` 鏈。
- **已試路線摘要：** 在上下文中呈現每族已試結果。r19 沒有任何角色用 `recon.read` 展開舊步驟，只有機械索引可能不夠。
- **Input token 預留（§5）：** 可靠估算並預留 input token，在硬停前留出交回窗口。
- **§3 未寫入的欄位：** `visible_intent`、`visible_observation`、`args_shape`。

本文件不授權安裝、真實模型運行、commit 或 push。

**依據：**

- r12 能載入 Skill，卻出現 `skill/read=0`、`workspace.write=0`、`artifact.publish=0`；Recon 反覆 render、view、adjust。
- R11 的 35 次 view 對應不同路徑與 hash，37 個 job 的 argv 也不同，但仍反覆處理同一瓶頸。
- r16（`experience-real-20261031-r16-ab`）A 已完成 88 次工具，資料庫卻只有 0 條 decision、0 條 handoff，最後因全局預算耗盡停止；B 已導出 30 行、51,044 bytes 的快照，下游卻只讀索引與第一個 32,768-byte 正文頁且 `done=false`。

**數據來源標註：** 本文的 r16 指 `experience-real-20261031-r16-ab`（A 88 次工具、0 decision、0 handoff；B 28 次工具、1 decision、1 handoff）。現有離線回放腳本默認讀 r15（`experience-real-20261030-r15-ab`：A 97 次工具＋1 handoff，B 57 次工具＋1 handoff）。兩者是不同的 run，步驟編號不能互相對照。

因此，「模型看過」「資料庫有行」「artifact 已發布」都不能代表下一步已使用資訊，或交接已真正完成。

---

## 1. 設計目標與主次關係

**目標：** Recon 每一步都留下可恢復的完整過程；下一次模型請求、續接 session 或新任務能在需要時讀到先前每一步、它的結果與當下可見觀察。模型據此判斷是否重複、換路、交回；host 不替模型猜哪些舊資訊「有用」。

Recon 的 OpenCode 原生模型／工具循環、原生 task、角色分工與預算邊界保持不變。本設計只改善這個循環的輸入、持久化與輸出：

| 能力 | Host 保證 | 模型決定 |
| --- | --- | --- |
| 完整過程記錄 | 每次工具呼叫、結果、順序與固定 refs 可重建 | 寫出必要的可見意圖、觀察與判斷 |
| 可導航上下文 | 完整索引、最近完整步驟、當前狀態均可達 | 查閱哪些舊步驟、是否重測、下一步做什麼 |
| 及時交回 | 正確隸屬、預算、終態與交回出口 | 問題是否已答、剩餘實驗是否仍有決策價值 |
| 固定交接 | 快照版本、索引、正文、hash、cursor、`done` | 讀哪些頁，以及材料是否足以支持下一步 |
| 題後學習 | 可信結果、完整來源範圍與派生版本 | episode 如何解釋、哪些部分值得形成 lesson |

**主次關係：**

```text
完整且有序的 Recon 步驟軌跡與 artifacts
  -> 完整、可分頁的步驟索引＋最近完整步驟＋當前狀態
  -> 模型查閱舊步驟並決定繼續、重測、交回或換角色
  -> 固定版本交回快照
  -> episode／lesson 作為可回溯的派生索引
```

`recon_turns` 與其 artifact 是事實主本；模型可見上下文是導航視圖；handoff snapshot 是一次交回的固定投影；episode 是一次嘗試的派生索引；lesson 是從 episode 再派生的候選方法。後面各層都不能取代前面的完整來源。

**證明邊界：** `solved`、Verifier judgment、artifact 已發布、正文已讀取、經驗已評估、經驗已採用、全流程產生收益，是不同事實。前一層成功不能替代後一層。

---

## 2. 職責與信任邊界

**決定：host 負責可驗證事實與可恢復性，模型負責路線判斷。** 兩者不能互相代填。

| 範圍 | Host 負責 | 模型負責 |
| --- | --- | --- |
| 身份與事實 | session、execution、challenge、預算、准入、計數、步驟順序、ref／hash、原始終態、快照版本、可信結果 | 選擇調查方向、解釋觀察、形成 judgment、判斷交回與材料用途 |
| 記錄 | 自動落盤工具呼叫、結果、狀態、來源與關聯；保存模型已輸出的可見文字 | 提供清楚的意圖、觀察與必要 decision；不保存隱藏推理全文 |
| 不可改寫項 | 預算、host 事實、artifact 終態、`solved` | 不憑對話猜身份，不覆寫已綁定事實 |
| 異常處理 | 未知身份與未知終態保留為 unknown，不以最近一次呼叫猜測 | 保留衝突與各自證據，不把最後一條自動當答案 |

**角色邊界：**

- Recon 可直接讀取已發布的 Skill 與當前題目的過程記錄。
- 必要時由 Coordinator 分派既有 Reference；Recon 沒有 task 分派權，也不是第二個 planner。
- Reference 沒有目標網路、腳本、材料修改與再委派權限。
- Domain Solver 負責精確 glyph／字串轉寫等下游工作；精確轉寫不是 Recon 交回的前置條件。

### 硬邊界

| 允許的擴展 | 仍然禁止 |
| --- | --- |
| 在 OpenCode 公開 plugin／SDK／server 邊界內，補薄控制層、SQLite 記錄、既有 artifact 與原生 task。 | Fork OpenCode；新增第二個 provider solver loop 或第二套 Agent 架構。 |
| 以原生同步 task 完成 Recon → Solver 交回。 | 新增 scheduler、monitor、watchdog、wakeup framework、通用 DAG／planner、持久 frontier、worker queue、attack graph 或自動意圖生成。 |
| 用既有 `artifact.publish/read` 固定 ref、版本、範圍與 hash。 | 新傳輸層、共享可寫 work、自動複製整個目錄。 |
| 讓 Recon 回答明確偵察問題，再把下一步交回 Coordinator。 | 把 Recon 擴成第二個 planner。 |
| 對重複 URL／argv 顯示歷史指紋與結果，由模型判斷是否重測。 | 由 host 依語意硬封鎖重測，或把指紋不同當成探索方向必然不同。 |

---

## 3. 完整過程軌跡是恢復主本

**決定：`recon_turns` 按原生執行順序保存每一次可觀察步驟；decision 是可選的跨回合解釋，不是流程存在的前提。**

Recon 每一步至少保留下列關係：

| 欄位群 | 寫入者 | 保留內容 |
| --- | --- | --- |
| `step_id, run_id, challenge_id, session_id, execution_ref` | host | 唯一身份與嘗試歸屬 |
| `turn_no, message_id, call_id, sequence` | host | 模型回合、原生訊息、工具呼叫及穩定排序 |
| `kind, visible_intent, tool, args_ref, args_shape, status` | host 綁定；可見意圖取自模型輸出 | 工具、decision、handoff 或 lifecycle 步驟；去敏參數形狀與執行狀態 |
| `result_ref, result_sha256, result_size, original_complete` | host | 結果的位置、hash、大小與是否完整保存 |
| `visible_observation` | 模型有輸出時保存；否則為 unknown | 模型在工具後明確寫出的觀察，不推導隱藏推理 |
| `related_ids, evidence_refs, created_at, finished_at` | host 驗證並填寫 | 前後步驟、衝突證據與 artifact 關係 |

**完整步驟的含義：**

- 每個工具呼叫都有一列，按 `sequence` 穩定排序；不以最近 N 條代表整段調查。
- 模型的工具呼叫與結果保持成對，續接、壓縮與新 session 都不得拆散。
- 小型結果可直接保存；大型結果進出去敏 artifact，資料庫保存 `result_ref`、hash、大小與完整度。
- 不得把目前 12,000 字元或 8 KB preview 當成永久完整結果，也不得靜默丟掉被 preview 省略的正文。
- artifact 保存失敗時，記錄 `partial`、`error` 或 `unknown` 及失敗範圍，不能宣稱 `original_complete=true`。
- 去敏造成的刪除要標記範圍；不能把刪減後的檔案冒充工具原始完整輸出。

模型不需要每次工具呼叫後寫 decision。decision 用於在跨回合時說明「看見什麼、判斷如何改變、下一步為何如此」；沒有 decision 時，完整工具結果與可見文字仍足以恢復過程。新 decision 以 `related_ids` 指向相關步驟，host 不把最後一條自動視為正確答案。

`ctf_recon_note` 是寫 decision／handoff 的窄入口；`ctf_recon_read` 與對應 artifact 讀取接口按 ID、範圍或 cursor 展開完整軌跡。工具成功不會自動生成語意結論，最終 handoff 也不能取代缺失的中間事實。

**已知缺陷（r17，2026-11-04）：** 真實 runtime 中，工具的 `message.part.updated` 事件先於 `tool.execute.before` 到達；插件轉發事件時不帶 `input`，host 先以 `{}` 插入一列並標為完整，之後帶真實參數的寫入被 `INSERT OR IGNORE` 忽略。r17 兩題 260 條工具記錄的參數因此全部為空，卻標為 `original_complete=1`，族鍵也因此退化為只有工具名。R3 的測試只覆蓋了「先執行、後事件」的順序。修正要求：
- 事件路徑沒有參數時，佔位列的參數標為不完整，不得標為完整；
- 之後帶真實參數的寫入必須補上參數與完整度；
- 事件若帶參數，按同一規則保存；
- 測試必須覆蓋「事件先到」的順序。

**修正狀態（無模型，2026-11-04）：** 已修正，證據見 [R7 記錄](../../gates/recon-context-interface-20261031/r7-args-learning-bounds.json)。
- 插件轉發事件時帶上 `input`。
- 事件參數只有在 `status` 為 `running`、`completed` 或 `error` 時才算完整。`pending` 狀態的 `input` 在 SDK 中是必有欄位，參數串流生成期間通常是空物件，因此一律標為不完整。
- 之後帶真實參數的寫入（`tool.before` 或 running 事件）會補寫，只能從不完整升級為完整；參數不完整的列，即使結果完整，也不標為 `original_complete`。
- 測試以真實事件形狀覆蓋三種順序。
- 真實 runtime 已驗證：r18 空參數 A 1/170、B 2/110，r19 A 3/188、B 4/76；剩下的都是本來就不帶參數的調用。r17 已落庫的空參數不會補回。

### 記錄範圍：所有解題角色

**決定（2026-11-03）：步驟記錄擴大到同題所有綁定題目的角色：Recon、Domain Solver、Engineer、Verifier。** 2026-10-30 曾決定 Solver／Engineer 不建步驟表，只靠交回文字寫明做法；結果 episode 的求解段只剩最後一段文字，真正決定成敗的實驗過程沒有逐步來源，與「整體做題過程幫到後續類似題」的目標不符，因此改為同一套記錄。

- **同一張表：** 沿用 `recon_turns`，表名不改，避免遷移成本；新增 `role` 欄，由 host 依綁定填寫。舊行的角色為 `recon`。
- **同一套規則：** 本節的無截斷、artifact ref、去敏標記、排序、冪等、終態單調與「寫入失敗留 error 列並暫停該題新探索」，對所有角色一致；Coordinator 不綁題目，不在範圍內。
- **讀取：** `ctf_recon_read` 對同題的 Domain Solver 與 Engineer 開放唯讀，可按 ID、範圍或 cursor 展開全題步驟；Verifier 不開放，保持獨立。`ctf_recon_note`（decision／handoff）仍只給 Recon。
- **不變的：** Recon cap／closure 只作用於 Recon；預算、角色權限與原生 task 分派不變。

**實施狀態（無模型）：** 已實施，證據見 [R6 記錄](../../gates/recon-context-interface-20261031/r6-solve-roles-recording.json)。
- **儲存：** schema v3 新增 `role` 欄，遷移冪等，舊行為 `recon`；角色只取自 host 綁定。
- **寫入：** 四個角色的工具步驟與 job 終態都寫入；Coordinator 不寫。並行寫入時全題 `sequence` 仍唯一。
- **讀取與上下文：** `recon.read` 開放給 Recon、Domain Solver、Engineer，Verifier 與 Coordinator 被拒；上下文的最近步驟只取本 session，索引帶 `role`。
- **episode：** 步驟清單行為 `sequence|ref|role|族鍵|結果類別`。已落庫的舊 episode 不重算，仍是舊的四欄格式。
- **限制：** Verifier 的大型參數或結果 artifact 沿用 `recon` 來源類別，Solver 可經索引中的 ref 讀到 Verifier 的步驟；Verifier 不讀他人軌跡的方向仍成立。Solver 在真實 runtime 中是否會調用 `ctf_recon_read` 未驗證。

**實施狀態（無模型）：** 本節的步驟記錄與導航已在產品實作並通過無模型驗收，證據見 [R3 記錄](../../gates/recon-context-interface-20261031/r3-complete-trace.json)。schema v2 可遷移 v1，舊列標 `original_complete=false`；參數與結果不再永久截斷，去敏後超過 16 KiB 的內容發布為固定 artifact，資料庫只存 ref、hash 和大小，經 `artifact.read` 可逐字節重建；去敏範圍有標記。每次呼叫一列，跨 session 的 `sequence` 穩定，重複事件冪等，終態單調。`ctf_recon_read` 對模型開放 cursor、`step_id`、`ids` 與 sequence 半開區間。發布或寫入失敗時，該步仍留一列 `error`、`complete=false` 的記錄，並暫停該題的新探索；closure 工具照常放行，但不會因此丟列。**尚未實施：** 上表的 `visible_intent`、`visible_observation` 與 `args_shape` 三欄在資料庫中有欄位，但目前沒有任何代碼寫入，讀出時為空；`related_ids`／`evidence_refs` 只隨 `recon.note` 存在 `note_json` 中。仍未證明：publication 登記只存在進程內，重啟後無法核對 unknown；模型是否實際讀取與使用軌跡；長題完整索引的開銷。

---

## 4. 下一次模型請求如何消費歷史

**決定：每次請求提供「完整可導航性」，不要求把所有歷史塞進單次 prompt，也不讓 host 以語意規則只挑它認為有用的舊紀錄。**

每個 Recon 請求至少包含：

| 區域 | 內容 | 目的 |
| --- | --- | --- |
| 當前問題 | 本次要消除的不確定性、下游需求、本回合結束條件 | 保持方向 |
| 完整步驟索引 | 所有步驟的 ID、序號、工具、狀態、指紋、結果 ref、完整度與分頁 cursor | 讓任何舊步驟可定位；索引過大時分頁 |
| 最近完整步驟 | 固定規則選出的最近工具呼叫與完整結果，維持 tool-call／result 配對 | 避免模型為接續最近工作再次讀取 |
| 當前狀態 | 在途 job、已發布 refs、預算、closure、未解項與 handoff 狀態 | 提供可信的下一步邊界 |
| 可選 decision／handoff | 模型先前輸出的可見解釋 | 幫助跨回合理解，但不取代工具事實 |
| 相關經驗入口 | 少量 lesson 摘要、版本、適用條件與來源 ref | 讓模型可評估、按需展開或忽略 |

**索引是機械導航，不是語意摘要。** host 可以排序、分頁、標記 tool／status／fingerprint，但不應以「關鍵 decision」「最近 8 條判斷」「18 KB 相關材料」等規則宣稱已代表完整歷史。每一步都要可達；不要求全部同時進入一次請求。

重複探索可見且可避免：

- Host 保存 URL、argv、頁面、檔案或請求的穩定指紋，並在索引與最近步驟中顯示先前同指紋結果。
- 模型能看到「已試、結果、狀態、artifact ref」，再決定是否用新前提重測。
- 不因重複指紋自動封鎖；若重測，模型應在可見意圖中說明前提、證據或不確定性有何變化。

### 歷史保持追加式穩定

R4 之前，插件每輪會刪除舊 synthetic investigation context，並把新內容改寫進最近 user message，使已完成歷史與公共前綴變動，且與「完整可恢復」不一致。現行契約是：

1. 原生對話、工具呼叫與結果保持追加式歷史，不改寫最初 user 任務或已完成訊息。
2. 每次只追加當前狀態增量；歷史狀態不重寫成另一份 user 訊息。
3. 原生 OpenCode 循環與 compaction 仍管理上下文，host 不自建摘要模型或旁路循環。
4. 若公開 hook 無法把狀態放在穩定位置，應報告接口缺口；回退不能是每輪替換首部任務或擴大預算。

**追加內容與發送頻率：** 放置契約以本節為準；哪些欄位在 delta 中發送、何時重發，以 [解題延遲與上下文成本](2026-11-04-design-v1-run-latency-and-context-cost.md) §3.1 為準。

**放置方案已定：append-only combo。** [放置驗證](../../gates/recon-context-interface-20261031/placement-validation.json)以 OpenCode `1.19.3`、58 次腳本化 localhost 請求及 0 次真實模型調用比較五種候選；只有 append-only combo 通過全部 13 項檢查，其餘候選均失敗。產品接線採用：

1. `chat.message` 追加當前狀態，使首輪及顯式新回合可見。
2. `tool.execute.after` 追加工具完成後的新狀態，不改寫已完成消息。
3. `experimental.session.compacting` 把當前狀態加入壓縮輸出上下文；`session.compacted` 只用來清除該 session 的記憶體可見版本，使下一次需要時可重新追加。
4. `experimental.chat.messages.transform` 不再增刪或替換消息內容，只可讀取 canonical message IDs，保留當前 user message 與背景完成消息的消費追蹤。
5. 以 `sessionID + version` 去重；projection 失敗時直接阻止出站模型請求，不以舊狀態靜默降級。

這份證據只證明傳輸與配對契約，不證明自動 overflow compaction、provider prefix-cache 命中、token 收益或模型會理解並使用狀態。上述能力仍按真實行為驗證，不能由 hook 被調用替代。

**實施狀態（無模型）：** 上述放置已接入產品，證據見 [R4 記錄](../../gates/recon-context-interface-20261031/r4-append-context.json)。
- **索引：** `investigationView` 複用 `ExperienceStore.records()` 的完整索引與 `sequence:id` cursor（與 `ctf_recon_read` 相同），按固定頁長 200 機械分頁；已移除「最近 N 條／18 KB／preview 截斷」選取。
- **最近完整步驟：** 固定為最後 6 個終態步驟（記錄範圍擴大後改為本 session 自己的最後 6 個終態步驟，避免並行角色互相擠佔；全題步驟仍在索引中），逐 id 讀取完整 args／result；running 步驟只列入 `in_flight_ids`，tool-call／result 不拆對。
- **增量追加：** host 按 session 保留最近 16 個版本的索引基線，插件回報可見版本。基線仍在時追加 delta；基線遺失（首次、compaction、重啟、未知版本）退回 full；同版不追加。版本含預算計數，因此每次 admitted 請求後會追加一小段 state delta。
- **投遞審計：** `context.presented` 在下一次被 admit 的請求上記錄，綁定實際追加正文的 hash、bytes、placement 與 record ids；compaction 在準備時記為 `compaction_context`。
- **失敗處理：** 任一 projection 失敗只封鎖該 session 的出站請求，直到下一次成功準備。

仍未證明：
- 模型是否使用追加的索引：r18／r19 中產品插件在真實 runtime 的追加、delta 與 `context.presented` 審計都正常（r19 B 70 次，首次 full、之後 delta），但沒有任何角色調用 `recon.read` 展開舊步驟；
- compaction 請求是否經過 `chat.params`；
- 插件重啟後未回報的投遞審計會遺失（正文仍留在歷史中）。

---

## 5. 及時交回、預算與停止邊界

**核心規則：只有下一次實驗仍可能改變具體決策時，才值得繼續。** 決策可以是選路、排除假設、更換工具、請求換角色或交回。

### 派單必須消除一個具體不確定性

Coordinator 不應只派「先偵察」，而應同時提供：

- 當前要回答的問題。
- 已有可信線索與相關步驟 refs。
- 尚未驗證的路線。
- 下游真正需要的材料。
- 本回合結束條件與可用預算。

### 找到 flag 不是唯一完成條件

Recon 在下列任一結果出現時即可交回：

- 本輪問題已回答。
- 確認入口與材料對應。
- 排除一條具體路線。
- 取得足以讓 Solver 開始工作的結構資訊。
- 下一步主要屬於 Solver 或其他角色。
- 路線受阻，或剩餘實驗價值低。
- host closure、全局預算或截止時間要求停止新探索。

前三種由模型依證據判斷；host 要求收束時以 host 事實為準。兩種原因可以同時成立。「還有更多 URL、參數或 payload」本身不是繼續理由。

交回至少說明已建立什麼、排除了什麼、仍未知什麼、下游需要哪些 refs、建議下一步是什麼。重派或續接可以接受，但要帶新證據或具體缺口；同題預算跨 execution、session 累計，重派、續接與 compaction 都不退款。

### 預算分層

| 層級 | 作用 |
| --- | --- |
| 全局牆鐘、token、步數與 `maxToolJobs` | 整個 run 的硬上限；`maxToolJobs` 跨題累計，達到後只拒絕新的 `job.run` |
| 原生工作回合 | 限定當前問題這一回合還能做多少工作 |
| 按題 Recon cap | 對異常過跑的額外止損；未配置時關閉，不偷偷補預設值 |

若配置總額度 `B` 與收束預留 `R`，必須滿足 `0 < R < B`。累計准入達到 `B−R` 時進入 closure，達到 `B` 時 exhausted。具體數值屬運行配置，不是普遍常數。

預算不能只夠探索，至少還要容納整理證據、發布 snapshot、寫 handoff 與父級解除等待。並發角色共用同一筆原子預留。硬停若早於有效 handoff，建立 partial／failed 記錄並保留已保存步驟與 refs；預算耗盡本身不是「調查充分」的證據。

### Closure 是停止入口

Closure 禁止新的 `job.run`、HTTP、workspace view／search／diff 與 Skill read；仍允許 `workspace.list/read/write`、讀取或取消既有 job、artifact publish／read、decision／handoff 與最終文字交回。這樣可以收尾而不封死交付出口。

在途工作不因軟邊界自動寫成完成。每次 closure 都要核對呼叫數、已觀測 token、在途預留與剩餘時間；硬停要保留原因、可確認 refs 與 unknown。預算只存在於 progress JSON、RPC metadata 或控制台不算有效；模型至少要能從工具回傳、上下文或原生 task 看到。

r16 A 是反例：Recon 准入 31 次、88 次工具，仍沒有 decision 或 handoff，最後由全局預算停止。完整軌跡若已存在，至少應讓下一回合看見已試步驟與剩餘預算；但它不能代替模型作出交回判斷。

**實施狀態（無模型）：**
- **已實施：** 按題 Recon cap（`reconMaxModelCalls` 為 `B`、`reconClosureReserve` 為 `R`）；累計准入達 `B−R` 進入 closure、達 `B` 為 exhausted，未配置時關閉。closure 期間只放行本節列出的收尾工具。R4 起，預算、closure 與 handoff 狀態隨追加式上下文對模型可見。
- **尚未實施：** input token 的估算與預留；目前的准入只按模型調用次數計，在途回應仍可能越過 token 門檻。
- **真實 run：** r18、r19 兩題都在 closure 前主動交回（r19 A 第 35 次准入、B 第 15 次，交回時仍在 exploration；r17 A 是被 60 次上限強制停止）。decision 只在交回前寫一兩條，沒有在重要結果或換路時寫。

### 推廣到 Solver 等長執行角色（離線重算後暫不採用，2026-11-07）

**狀態：** 離線重算已完成（0 次模型調用），三種觸發條件都暫不採用，未實施；結論與去向見本節末。輸入是 [Alibaba a1–a4 harness 分析](../analysis/2026-11-06-alibaba-a1-a4-harness-findings.md) 的 P0-1（新資訊量計數觸發 closure）與 P0-2（按牆鐘分階段 closure）。「長執行內部停滯沒有觸發點」這個問題本身，以及候選 B（宿主停滯信號）、D（有界回合交回）的取捨，見[路線複核](2026-10-25-design-v1-negative-evidence-and-route-review.md) §5；本節只管「能否把本節的 closure 用到 Recon 以外的角色」。

**為什麼放在這裡：** 路線複核 §5.6 否定宿主信號的理由之一，是子任務執行中沒有通知路徑。本節的 closure 不需要喚醒 Coordinator：它在 child 自己的下一次工具調用上以拒絕消息出現，child 依本節的收尾工具交回，交回邊界再由 Coordinator 照既有停滯規則決定。所以推廣只需新增觸發條件，不需要新的通知路徑、monitor 或 scheduler。

**證據核對（只取 `progress.jsonl` 的 role／op／tool／argFingerprint／elapsedMs、`state/jobs` 與 HTTP 捕獲檔的 sha256 計數，不讀內容）：**

| 判定 | 內容 |
| --- | --- |
| 已證實 | a3 C1（bypassit2）Solver 兩個會話登記 204 次 `job.run`（訊息裡 206 個 tool part）；C3（ezoj）Solver 230 次 `http.request`。 |
| 已證實 | **按參數重複計數不會觸發。** C1 Solver `job.run` 204 次中 203 種 argFingerprint，C2 148 次中 147 種，C3 `http.request` 230 次全部不同；任一 fingerprint 最多出現 2 次。prompt 的「相同工具／參數重複 3 次」與分析提出的「相同 argv 雜湊重複次數」都不會在這三題觸發。這與路線複核 §5.6 對 r7 的結論相同。 |
| 已證實 | **按結果雜湊多樣性也不會觸發。** C3 Solver 230 份回應正文只有 72 種 sha256，但每 20 次中至少 4 種，最後一次請求仍是新正文；C1／C2 Solver 的 job 輸出（stdout＋stderr）幾乎每次都不同（159 次 158 種、148 次 143 種）。「最近 20 次只有 1 種結果」在三題都不成立。 |
| 已證實 | **「N 次調用沒有新 artifact」會在解出的 run 裡誤觸發。** Solver 的 artifact 集中在交回前一次發布：a3 C1 首個 Solver 回合 200 次調用後才發布；但已解出的 a1 A1、A2 的 Solver 也是在 90、91 次無 artifact 的調用後才一次發布勝出材料。分析舉例的「30 次沒有新 artifact」會在這兩次成功 run 產生候選之前就收束 Solver。 |
| 已證實 | a3 C3 的 Verifier 在 28.7 分鐘才派出（Engineer 25.8 分鐘派出，completion 在 28.5 分鐘被 `verification required` 拒絕），30.1 分鐘 deadline 前沒有結果。 |
| 已證實 | **按時間階段收束只會影響有候選的題。** a3 C1、C2 到 deadline 都沒有進入 Engineer；只有 C3 有可打包的材料。對前兩題，時間階段 closure 只會更早停下無候選的 Solver，不會產生提交。 |
| 推斷 | 收尾所需時間：Engineer 從派出到首次 completion 請求在 a1 A1／A2、a2 B3、a3 C3 為 97–161 秒；走 Verifier 回退時，被拒到被接受再加 148–191 秒。保留 6–8 分鐘覆蓋了 Verifier 路徑；若[解題延遲](2026-11-04-design-v1-run-latency-and-context-cost.md) §3.4 的出處條件修訂落地，直接提交路徑約 3 分鐘即可。 |
| 待驗證 | Solver 的「候選已出現」目前沒有 host 可見的結構化事實（artifact 記錄沒有類型欄位，只有 Engineer 的 `package.publish` 是結構化的），所以「時間到時固定目前最佳候選」由誰判斷、host 如何知道有無候選，仍未定。 |

**候選做法與離線重算結論：**

- **A. 按角色的調用額度與 closure 預留。** 把本節的 `B`／`R` 推廣到 domain-solver 每回合，沿用同一套收尾工具與交回要求。只計調用次數，不判斷語義，所以不會被「換著參數試」繞過。**結論：暫不採用。** 樣本內能分開，但餘量小，收益也沒有證據（見問題 1）。
- **B. 牆鐘階段 closure。** 剩餘時間低於收尾預留時，host 讓仍在執行的 Solver／Recon 進入 closure。**結論：作為 child closure 不採用。** 它不傷成功 run，但 C3 的延誤不在長回合裡（見問題 2）。
- **C. 新資訊量計數。** argv 重複、結果雜湊多樣性與 artifact 間隔都不能區分卡住回合與成功回合（見上表）。**結論：不實施。**

三者都不新增 judge 權，換路仍由 Coordinator 決定、Critic 只建議。

**離線重算（2026-11-07）：**
- **工具與證據：** 腳本 `tests/manual/closure-trigger-replay.py`；結果 [closure-replay-20261107.json](../../gates/run-cost-20261104/closure-replay-20261107.json)。
- **只讀欄位：** `progress.jsonl` 的 role／op／kind／elapsedMs／tool／ref，`state/run.json` 的 deadlineMs／stopReason，以及 completion-results 的 solved。
- **樣本：** 共 19 個 run。
  - 已解出 11 個：a1 A1、A2，a2 B3，r20 C1／C2／T1／T2，r21 V1／V2／M1，r22 F1；
  - 未解出 8 個：a1 A3，a2 B1／B2／B4，a3 C1–C3，a4 D1。
- **回合的定義：** 從 Coordinator 派出或恢復某角色，到下一次派單為止。
- **「帶出材料」的定義：** 這一回合發布的 artifact，之後被 Engineer 讀取。這只能事後判定，不等於候選正確。

1. **成功與卡住的 Solver 回合能否按調用數或時長分開？**
   - **成功 run：** 11 個帶出材料的 Solver 回合，在發布那份材料前用了 4–88 次模型調用、0.2–6.2 分鐘。最多的是 a1 A1：88 次調用，只用 3.2 分鐘，因為 job 很快。
   - **未解 run：** 24 個 Solver 回合，調用數 1–252 次，時長 0–12.4 分鐘。
     - 超過 88 次調用的有 4 個：a3 C2 94、a2 B1 101、a3 C1 204、a2 B4 252；
     - 超過 6.2 分鐘的有 6 個。其中 a3 C3 首回合在第 9.9 分鐘、第 76 次調用時才發布後來被 Engineer 讀取的材料。
   - **判定：**
     - 按時長設上限，會截斷 C3 首回合的材料，所以不可分。
     - 按調用數，約 100 次的上限在樣本內不誤傷成功回合，但 88 與 94 之間的餘量很小，成功樣本只有 11 個。
     - 收益也沒有證據：截斷長回合只是把控制權交回 Coordinator。a4 的 Solver 回合都很短（0.2–2.9 分鐘），Coordinator 仍只是反覆再派 Solver。
   - **去向：** A 不實施，只記錄這份分佈。之後若配對 run 需要止損上限，從這份分佈取值再議。
2. **牆鐘階段 closure 何時觸發？會不會截斷成功 run？**
   - **不截斷成功 run：** 11 個已解出 run 最晚在 21.9 分鐘結束。預留 4／6／8 分鐘（觸發在 26／24／22 分鐘）在成功 run 中一次都不會觸發；a1／a2／a4 的未解 run 也都在觸發前自行結束。
   - 只有 a3 三題會觸發：
     - **C1、C2：** 觸發時 Solver 在途，但整個 run 都沒有帶出材料的回合，收束不會產生提交。
     - **C3：** 首回合在 13.6 分鐘已發布 Engineer 之後讀取的材料。14.9–25.6 分鐘間，Coordinator 又派了 4 個 0.6–2.0 分鐘的短 Solver 回合和 1 次 Recovery Critic，才在 25.8 分鐘派 Engineer。預留 8 分鐘時（22.0 分鐘）沒有長角色在途，正好在兩次派單之間。
   - **判定：** C3 的延誤來自 Coordinator 的派單選擇，不是長回合。對 child 進入 closure 解決不了它。
   - **去向：** B 不作為 child closure 實施。剩餘牆鐘改作 Coordinator 交回時可見的事實，見[結果完整性](2026-10-25-design-v1-run-readiness-and-result-completeness.md) §5.2「交回時的決策事實」。C3 另一段延誤（送驗回退）由[解題延遲](2026-11-04-design-v1-run-latency-and-context-cost.md) §3.4 的出處條件修訂處理。
3. **「已有候選」能否由現有結構化事實判定？**
   - 不能在運行中判定。「Engineer 之後讀取」只能事後知道，artifact 記錄沒有類型；運行中結構化的只有 Engineer 的 `package.publish`。
   - **去向：** 交回時可見的事實只用「本題是否已有 package」，不推斷 Solver 是否已有候選。

---

## 6. 固定交接、快照消費與恢復

**交付鏈固定為：完整過程軌跡 → host 固定 snapshot／manifest → Coordinator 轉交 ref → 同一消費者讀取所需版本 → 可恢復。** 私有 work 路徑、聊天片段與猜測 hash 都不在交付鏈上。

### 材料與快照

Recon 應在調查過程中盡早發布之後真正需要的結構化結果、基線、去敏資料、圖或表。handoff note 保存後，host 依聲明範圍凍結完整終態，不能只取截止 row ID 而漏掉稍後完成的在途記錄。

快照索引列出：

- 來源 run／challenge、範圍、首尾 step、版本、在途 ID 與終態。
- 分片、大小、hash、完整度、缺頁與 unknown。
- 每個分片的 cursor 與讀取方式。

超過單 artifact 上限時分頁，不靜默丟棄超大單筆記錄；索引自身超限要如實失敗。running 仍寫 running，無法判斷寫 unknown。「完整」只表示聲明範圍內當下可確定的狀態已收錄，不表示工具已結束或問題已解決。

### 什麼才算消費

下游使用 `artifact.read({ref, cursor})` 讀取同一版本的正文。若聲稱完整消費：

- 必須是同一消費者讀完它需要或聲明要讀的全部正文頁。
- 必須看到 `done=true` 或確認沒有下一頁。
- 只讀索引、只讀一頁、不同角色各讀一部分，都不等於該消費者完成。
- 可接受明確子集，但必須列出未讀範圍。
- 圖片經 `workspace.view` 形成模型可用視覺輸入才算看見；把 bytes 包成 base64 文字不算。

讀取結果要區分 `index_received`、正文已返回範圍、`remaining` 與 `done`。跨分片 cursor 由 host 計算，頁界盡量保持記錄完整；缺頁、損壞、異題與舊版本 cursor 都拒絕對應讀取。host 即使確認檔案 hash 正確，也不能推出模型已消費正文。

r16 B 正好證明「固定發布不等於消費」：30 行、51,044 bytes 的快照雖然成功發布，Solver 只收到索引，Verifier 只讀第一個 32,768-byte 正文頁且得到 `done=false`。本設計要求同一消費者續讀同一版本，或在交回中明確宣稱只消費了哪一頁。

### 失敗與恢復

- note 已保存但導出失敗時，回傳 note ID、partial 與失敗範圍，允許 Recon 停止，不重開調查。
- publication intent 已持久化但結果未知時，保持 unknown；核對前不能自動重發兩個不可解釋版本。
- 輸入 ref 竄改、來自異題或 hash 不符時拒絕。
- producer 或 `original_complete` 不確定時繼續保留 unknown。
- 同一原生 task 可繼續自己的 work；新 session 按 run／challenge 讀取完整步驟、固定 snapshot 與 artifact refs。
- 資料庫短暫恢復，不自動恢復舊探索授權；全局預算耗盡時只能保存結果與缺口，不能承諾其他角色隨後仍能啟動。
- 未知工具終態不盲目重跑；同題預算、在途工作、終態與停止原因跨 session 保留。

**實施狀態（無模型）：**
- **已實施：** handoff note 保存後，host 凍結全部記錄並分片發布（每片 256 KiB），另發布帶 hash、大小與分片 refs 的索引。發布前先寫意圖檔，意圖已存在時回傳 unknown，不盲目重發；導出失敗時回傳 note 與 partial。
- **尚未實施：** 讀取端的消費記錄。`artifact.read` 只回傳 `nextCursor`，host 不記錄同一消費者是否讀到最後一頁，也不區分 `index_received`、已返回範圍與 `remaining`。
- **未驗證：** 真實下游是否讀完正文。

---

## 7. Episode 與 lesson：完整軌跡上的派生索引

**資料鏈固定為：完整 Recon／求解過程 → 一次嘗試的 episode 索引 → lesson 候選 → 下一次模型自行判斷是否適用。**

| 資料 | 角色 | 不得承擔 |
| --- | --- | --- |
| steps／artifacts | 可重建的事實主本 | 不保存隱藏推理；不以 decision 作為唯一來源 |
| `episodes` | 指定來源範圍、可信結果、關鍵轉折與缺口的版本化索引 | 不取代完整步驟；不只覆蓋最近 N 條 |
| `lessons` | 從 episode 形成、帶條件與來源的方法候選 | 不改寫來源，也不成為唯一可恢復紀錄 |

### Episode 的來源契約

episode 只在一次嘗試真正結束後形成。成功、未解、超時、取消或因能力受阻結束都可形成經歷；Recon 單純交回或題目準備續做，不觸發題後收口。

每份 episode 必須保存：

| 群組 | 內容 |
| --- | --- |
| 身份與結果 | `episode_id, run_id, challenge_id, version, outcome, outcome_ref, end_reason` |
| 完整來源範圍 | 首尾 step、總數、trace／artifact refs、hash、產生時的可確認狀態 |
| 可讀索引 | `summary, tech_tags, key_steps, failed_paths, unresolved, omitted_ranges` |
| 整理狀態 | `episode_status, lesson_status, lesson_ids, model, usage, error` |

episode 的 summary 可以有界，但其 `source_range` 必須指向整次嘗試的完整軌跡。它可以用固定規則標出首個、變化點與最後觀察，再用模型解釋；不能從來源清單中刪掉早期成功或晚期失敗，然後宣稱已覆蓋全題。

r16 A 固定反例：#55 註冊請求為 302，#56 接著跳轉 `/team/2`；後期 #73／#74 的空表單提交得到 403。當時 episode 只覆蓋 16／89 條來源，省略早期成功，並把晚期失敗錯誤泛化為「自註冊不可用」。新契約要求：

- 完整來源仍可由 episode 指向的 trace 重讀。
- 失敗與未解斷言要連到自己實際提供的 steps／refs，不能只憑整體 `solved=false`。
- 保留不同參數／狀態族，以及每個實驗族的首個、變化點與最後觀察。
- 不要求模型先寫 decision 才保留反例；沒有 decision 的工具事實同樣必須存在。
- 無法一次放入模型時，明確提供範圍與遺漏；區分「未納入這次摘要」和「來源不存在」。

### 來源選取是機械規則

**決定：host 用固定規則從完整來源挑出交給模型的子集。規則只看工具、目標形狀與結果類別，不判斷哪條「有用」；被省略的內容一律寫成範圍。**

- **實驗族：** 按 `tool` 加正規化目標分族。HTTP 取 method 與 URL path，加排序後的 query／body 參數名，不含參數值。job 取 argv[0] 的 basename。workspace 類取路徑。其他工具只按工具名分族。正規化只用 host 已保存的去敏參數，不解析題目語意。
- **結果類別：** 由 `status`、可得時的 HTTP status code，以及 error／ok 組成。同族中結果類別與前一步不同的那一步，記為變化點。
- **必選：**
  - 每族的首個、全部變化點與最後一步；
  - 全部 decision／handoff；
  - 每個角色的原生交回；
  - host 綁定的 outcome、Verifier judgment 與 end reason。
- **步驟清單：** 每個步驟固定一行，含 sequence、ref、角色、工具、族鍵、結果類別，以及可得時的 HTTP status code；不含參數值或結果正文。清單總是交給模型，有自己的上限（48 KiB），與摘錄的上限分開計算。超出時，列到上限為止，其餘寫成連續的 sequence 範圍。清單中的每一行都可作為 `source_refs` 被引用。
- **摘錄：** 上述族規則只決定哪些步驟另附完整摘錄。
- **超出摘錄上限時：** 先按族均衡刪去中段變化點，族的首尾不刪。若仍超限，不再靜默截斷，而是把整族的摘錄標為 `omitted`，並列出族鍵與步驟範圍；這些步驟仍在步驟清單中可見。整族省略的次序固定為：已選步數最少的族先省略；同數時，位元組較大的先省略；再按族鍵排序。

  r15 A 回放（98 步、74 族、62 族單步、20 KB 摘錄上限）證明只靠摘錄不足：59 族整族省略，大量單步族不在模型輸入中。步驟清單就是為了這種情況：讓每一步至少以結果類別的形式可見。
- **host 填寫、模型不能改的欄位：**
  - `source_range`：首尾 sequence、總數、完整索引 fingerprint、artifact refs、running／unknown 計數；
  - `omitted_ranges`：連續的 sequence 範圍、族鍵與原因。原因分兩種：`not_in_summary` 表示來源存在但沒放進這次輸入；`source_missing` 表示來源本身缺失或不完整。
- **模型輸出的綁定：** `failed_paths` 與 `unresolved` 每項都帶 `source_refs`，且只能引用實際提供的來源。存儲欄位仍名 `steps`，即上表所說的 `key_steps`。

host 綁定可信 outcome、Verifier judgment 與 end reason；模型只解釋線索、嘗試、回饋、調整與最終路線，不能重新裁決 `solved`。終態寫入失敗時停止新的同題探索，但保留讀取、取消、發布與交回；學習失敗不得污染原求解終態。

**實施狀態（無模型）：** 本節規則已在產品實施，證據見 [R5 記錄](../../gates/recon-context-interface-20261031/r5-episode-source.json)。
- **r15 A 回放：** 98 步全部進入步驟清單（5.7 KB，無省略）；摘錄 19 步、18.6 KB；74 族，其中 62 族為單步；變化點 10 個；整族摘錄省略 59 族，原因全為 `not_in_summary`。回放斷言的第 55、56、73、74 步屬於 r15 A，不是上文 r16 反例的那幾步。
- **r15 B 回放：** 58 步全部在清單中（2.9 KB），共 36 族。
- **episode 欄位：** `source_range` 放在 `input`，隨 `input_hash` 冪等；`omitted_ranges` 在準備學習輸入時寫入 episode，模型只看前 64 條加總數。`source_missing` 只用於未提供且本身不完整的來源。
- **舊資料：** 字串形式的 `failed_paths` 仍可讀。

**r16 反例回放：** 證據見 [r16 回放](../../gates/recon-context-interface-20261031/product-original-replay-r16.json)。上文的 #N 即 `recon_turns.id`，在 r16 A 中與 `sequence` 相同。
- **r16 A：** 88 步全部在步驟清單中（5.5 KB，無省略）；共 78 族，其中 69 族為單步；變化點 4 個；摘錄 27 步、約 19.5 KB。
- **反例四步：** #55、#56 為 HTTP 302，#73、#74 為 HTTP 403，都以清單行出現在模型輸入中，結果類別正確。早期成功不再從輸入中消失。
- **限制：** 這四步都沒有完整摘錄。模型只看得到「302」「403」與族鍵，看不到跳轉目標或回應內容。能否據此避免把晚期 403 泛化為整題結論，要靠真實模型驗證；若不足，可再考慮讓摘錄規則跨族照顧同一路徑前綴的結果變化，屆時另行決定。
- **r16 B：** 30 步全部在清單中。

**真實 run（r19）：** A 的 212 步中有 25 步帶摘錄，模型寫出 8 個步驟、4 條失敗路徑、5 條未解項，來源引用都通過綁定校驗；3 條 lesson 都綁定 A 的 episode@1。

**仍未證明：** episode 的自然語言解釋是否忠實於引用的步驟（只有機械綁定，沒有人工核對），以及 lesson 的跨題收益。

### 有界輸出不破壞來源

**決定（2026-11-04 放寬）：**
- **episode：** 最多 8 個關鍵步驟；`summary` 最多 1,200 字元；`tech_tags` 最多 12 個；`failed_paths`、`unresolved` 各最多 12 項；其餘單條文字最多 600 字元。
- **lesson：** 最多產生 3 條；每條的陣列欄位各最多 8 項，單條文字最多 600 字元。
- **提示：** 請求中寫明上述上限。

**依據：** 舊上限是 `summary` 400 字元、陣列 8 項、lesson 陣列 5 項，三次真實 run 全部因此失敗：
- r16 B 的 `summary` 為 711 字元；
- r17 A 為 656 字元；
- r17 B 為 775 字元，且 `tech_tags` 有 10 個。

三次的請求都正常結束（`finish=stop`），只是越界，結果整條學習鏈 0 條 lesson。新上限以觀察到的最大值加約五成餘量訂定，仍是有界輸出。

**實施狀態（無模型，2026-11-04）：** 校驗與提示已按上述數值修改；1,000 字元 `summary`、10 個 `tech_tags` 的合法回應被接受，超過新上限、`finish=length` 與 invalid JSON 仍被拒絕。證據同 R7 記錄。r18、r19 的 episode 摘要都落在新上限內（r18 A 624 字元），沒有再因字數被拒。

**r18 結果與修正（無模型，2026-11-04）：** 放寬後的真實批次（r18）仍沒有產出 lesson，原因不在字數上限，證據與修正見 [R8 記錄](../../gates/recon-context-interface-20261031/r8-learning-parse-output-cap.json)。
- **多餘欄位：** A 的 lesson 回應結構完整，每條只多一個值為 `null` 的欄位，被 `.strict()` 整組拒收。現在解析模型回應時丟棄 schema 以外的欄位（含巢狀），被丟棄的鍵路徑（不含值）寫入該次請求的 receipt（`dropped_keys`）與學習報告。存儲與讀取的 schema 仍是 `.strict()`；缺必填欄位、類型錯誤、數量與長度越界、來源綁定仍然拒收。
- **輸出上限：** B 的 episode 以 `finish=length` 截斷，輸出 1,889 加 reasoning 2,207 剛好是寫死的 4,096。現在上限取當前模型在 OpenCode 設定中的 `limit.output`，沒有時用 8,000（r18 所用模型的設定值）；仍受剩餘學習預算約束，預算不足時按原規則報 `learning budget exhausted`。模型上限低於 6,000 時，發請求前就以可讀原因失敗，不白花一次請求：合法 episode 最長約 27k 字元（約 7k token），reasoning 與輸出共用同一上限，6,000 是在不放寬任何字數上限的前提下可接受的下限。`finish=length` 仍 fail-closed，不重試。
- **重學習：** 已存的失敗 episode 可用手動腳本 `tests/manual/relearn-episodes.ts` 在經驗庫副本上重設並重跑；沒有顯式傳入預算參數時只輸出請求數與預留估算，不調用模型。

**r19 結果與修正（2026-11-04）：** 證據見 [r17–r19 真實批次](../../gates/recon-context-interface-20261031/real-r17-r19.json)。
- **A：** episode 與 lesson 都以 `finish=stop` 完成，3 條 lesson 入庫，沒有多餘欄位。
- **B：** episode 回應在 JSON 前多了一句說明，被判為 invalid JSON。現在解碼依次嘗試純 JSON、去掉代碼圍欄，最後取第一個括號平衡的 JSON 物件；字串內的括號不計，取不到物件仍判失敗。修正後在副本上重學習 B，2 次請求、約 2.1 萬 token，episode 與 lesson 完成，3 條 lesson，原庫未改。r19 正式庫中 B 的 episode 仍是失敗狀態。
- **學習報告：** `learning-report.json` 每個 episode 直接列出兩個階段的狀態、`finish` 與 `dropped_keys`，判斷失敗原因不必讀 episode 本體。

呼叫前保存原始 response、hash、`finish` reason 與實際 usage。`finish=length`、異常終止、invalid JSON 與欄位越界仍然 fail-closed，不自動補 JSON、續寫、截斷或重試（略過 JSON 前的說明文字、丟棄多餘欄位不改動被接受的內容，不屬於補寫）；放寬的只是上限數值，不是失敗語義。拒絕只阻止不合規的摘要成為 episode，不能刪除或截斷它所依據的完整步驟與 artifacts。

### Lesson 與經驗可用性

lesson 保存 `lesson_id, version, title, tags, when, steps, checks, avoid, limits, source_episode_refs, created_at`。它是可忽略的方法候選，不是任務指令；失敗題只能形成局部教訓，沒有遷移價值時明確保存「無 lesson」。

經驗可用性分三層：

1. **可達**：host 在當前決策邊界呈現少量候選卡，或提供 search 工具；卡片至少含 version、適用條件、核心步驟、限制與來源。
2. **可展開**：`ctf_experience_read` 能按明確版本讀 lesson 或來源 episode，分頁並綁定同一版本。
3. **可判斷**：模型可依當前題目自行採用、調整、拒絕或忽略。未使用工具不是自動錯誤；search 命中也不等於採用。

審計事實依次為 `presented`、`searched`、`read`、`evaluated`、`adopted`。Host 能證明前四者中的機械事實；只有後續 decision 或行動才可能成為採用證據。題目 `solved` 不能推出 solved 是因該 lesson。

r16 B 曾搜尋經驗兩次但沒有調用 `ctf_experience_read`。這證明「search 命中不等於讀取或採用」，也提醒 search 回傳本身應帶足夠條件讓模型判斷是否值得展開。新設計不強迫模型每題讀 lesson；它要求 host 不把有用經驗藏在必須先知道關鍵詞才能找到的地方，也不把忽略無關經驗計為失敗。

首版使用有界 SQLite 關鍵詞檢索，不引入向量庫或額外語意 judge。工具不開放任意路徑或 SQL，也不帶出 flag、cookie、控制憑證、oracle 或隱藏推理。

---

## 8. 驗收、證據與仍未證明的事項

**驗收看資料是否能恢復完整決策路徑，不看模型寫了幾條 decision 或命中幾個 lesson。**

| 閉環 | 必須看到的行為 |
| --- | --- |
| 完整過程軌跡 | 每次工具呼叫均有穩定 step、完整結果或明示 partial，早期與晚期步驟都可重建 |
| 可導航上下文 | 下一次請求可從索引與 cursor 找到全部先前步驟；最近完整步驟、指紋與結果可見 |
| 避免無根據重複 | 模型的下一步能引用先前指紋／結果；若重測，可見前提或證據發生變化 |
| 穩定歷史 | 原生已完成訊息與首尾 tool pair 不被每輪重寫；新增狀態以追加方式可見 |
| 及時交回 | 問題已回答、屬下游、受阻或 host 收束時停止新探索，並在預算內留下可用交接 |
| 快照消費 | 同一消費者按同一版本讀到所需正文並得到 `done=true`，或明示未讀範圍 |
| 忠實經歷 | episode 指向整次嘗試的完整來源；早期成功、晚期失敗、unknown 與 omitted ranges 不丟失 |
| 經驗可選使用 | 候選經驗可呈現、搜尋與按需展開；採用、拒絕與忽略分別可解釋，命中不算採用 |

### 驗收分層與停點

源碼裝配、無模型接口、真實行為、真實解題結果與成本要分開報告。A 解出不能掩蓋 missing trace 或快照未消費；A 未解也不自動表示所有工程修復失敗；兩題成功不能替代同批有來源的語義閉環。

下一輪從本設計生成聚焦 plan。先驗證最小接口與資料契約，再實施；涉及真實模型時，還要重新明確模型、provider、求解／學習預算、預留與嘗試上限。舊 r16 資料及 r15 對照只讀，新增結果沿用既有 evidence／gate 位置。

**真實批次的做法（r17–r19 沿用）：**
- 複製上一批次目錄的 `scripts/` 與 `configs/`（起停靶場、`run-once.mts`、計數 relay、0 token 整鏈彩排、預檢），刪掉複製過來的 `runs/`，從空經驗庫開始。不沿用舊經驗庫：檢索目前不排除同一題自己的經驗。
- 付費 run 前先跑 0 token 彩排，確認追加式上下文、四角色記錄與參數非空、relay 計數與准入一致。
- A 的學習完成、經驗庫關閉後才啟動 B；每題一次，不重試、不換 provider。
- 授權寫明目標、模型／provider、批次與 token 上限（r17–r19 為每題求解 1.2M、學習 100k，合計 2.6M）。學習失敗時，可先用重學習腳本在副本上定向驗證，不必重跑整批。

### 現有證據能支持到哪裡

| 證據 | 已支持 | 不能推出 |
| --- | --- | --- |
| [R1／R2 記錄](../../gates/recon-experience-20261030/r1-r2/README.md) | 歷史正常接線、故障隔離、macOS／Ubuntu ARM64 腳本鏈路 | 正式映像、完整步驟軌跡或跨題收益 |
| [公開接口探針](../../gates/recon-context-interface-20261031/result.json) | 子會話、工具後請求、同版續接、並發、顯式摘要與取消恢復可達 | 追加式穩定歷史、自動 compaction 安全、真實 cache 收益或可靠 token 預留 |
| [追加式放置驗證](../../gates/recon-context-interface-20261031/placement-validation.json) | `append_only_combo` 在首輪、工具續接、原生續接、同版去重、顯式 compaction、cancel、session 隔離、tool pair 與 projection fail-closed 上 13／13 通過；其他四種候選均失敗 | 自動 overflow compaction、真實 provider cache 收益、token 收益、產品接線或模型語義使用 |
| [r15 A/B 回放](../../gates/recon-context-interface-20261031/product-original-replay.json) | r15 的 98／58 條記錄、跨頁快照、結果綁定與截斷拒絕可離線重現 | 舊 episode 已修好，或完整軌跡已被模型使用 |
| [原生產品鏈路](../../gates/recon-context-interface-20261031/product-native.json) | 原生 task、交付、Verifier、可信完成、學習與資料讀取可接線 | 模型判斷品質、實際消費或統計效果 |
| [R3 完整軌跡](../../gates/recon-context-interface-20261031/r3-complete-trace.json) | §3 步驟記錄與導航的無模型實施：遷移、無截斷、artifact ref 字節往返、去敏標記、排序／冪等、完整導航與失敗不丟列；typecheck、build、56 檔／729 測試、r15 A/B 回放通過 | `visible_intent`／`visible_observation`／`args_shape` 寫入、§4–§7、重啟後 publication 核對、模型實際使用或 token 開銷 |
| [R4 追加式上下文](../../gates/recon-context-interface-20261031/r4-append-context.json) | §4 放置接入產品：transform 唯讀、`chat.message`／`tool.execute.after` 追加、版本去重、session 隔離、compaction／cancel 恢復、fail-closed、投遞審計；56 檔／742 測試、放置探針 13／13、r15 A/B 全部步驟進入索引 | 產品插件在真實 runtime 的行為、自動 overflow compaction、prefix-cache 或 token 收益、模型實際使用 |
| [R5 episode 來源](../../gates/recon-context-interface-20261031/r5-episode-source.json) | §7 機械選取、步驟清單、`source_range`／`omitted_ranges`、失敗與未解的來源綁定；r15 A 98 步全在清單中；56 檔／753 測試 | 真實模型的 episode 忠實度、清單引用率或 lesson 收益 |
| [r16 回放](../../gates/recon-context-interface-20261031/product-original-replay-r16.json) | r16 A 88 步全在步驟清單中；反例 #55／#56（302）與 #73／#74（403）在模型輸入中且結果類別正確；r15 回放不回退 | 這四步有完整摘錄、模型會據此避免錯誤泛化 |
| [R6 解題角色記錄](../../gates/recon-context-interface-20261031/r6-solve-roles-recording.json) | 四個綁題角色逐步寫入、`role` 欄與遷移、`recon.read` 權限、本 session 最近步驟、清單帶角色；57 檔／760 測試；r15／r16 回放不回退 | Solver／Engineer 在真實 runtime 會讀軌跡、求解步驟記錄對 lesson 質量的改善 |
| [R7 參數順序與學習上限](../../gates/recon-context-interface-20261031/r7-args-learning-bounds.json) | r17 發現的「事件先到」參數丟失已修正（pending 為不完整、真實參數補寫）；學習上限放寬；58 檔／774 測試；r15／r16 回放不回退 | 真實 runtime 中參數非空、真實模型輸出落在新上限內 |
| [R8 學習解析與輸出上限](../../gates/recon-context-interface-20261031/r8-learning-parse-output-cap.json) | r18 發現的兩個缺陷已離線修正：模型回應的多餘欄位被丟棄並記錄、輸出上限取模型設定；失敗 episode 可在副本上手動重學習；59 檔／792 測試；r15／r16 回放不回退 | 真實模型在新輸出上限下產出完整 episode／lesson |
| [r17–r19 真實批次](../../gates/recon-context-interface-20261031/real-r17-r19.json) | 真實 runtime 中：四角色逐步記錄且參數完整；追加式上下文與投遞審計；Recon 在 closure 前主動交回；A 的 episode／lesson 入庫並自動呈現給 B；r19 兩題首次提交即解出 | 經驗提升解題（無 B0 對照、A／B 非相似題、每題一次）；模型讀了或採用了 lesson；episode 解釋的忠實度 |

### 真實批次的正反證據

**r17–r19（2026-11-04，`volcano-plan/deepseek-v4.1-flash`）：** 判定為「機制通過、行為不足」。

已接通：

- 四個角色逐步記錄；r17 的參數全空由 R7 修正，r18／r19 只剩本來就不帶參數的調用。
- 追加式上下文在真實 runtime 中首次 full、之後 delta，沒有重複版本。
- Recon 在 closure 前主動交回（r18、r19 兩題都是）。
- 題後學習三次失敗都已修正：r17 字數上限、r18 多餘欄位與輸出 token 上限、r19 JSON 前的說明文字。r19 A 的 3 條 lesson 入庫，B 的 70 次上下文注入都帶著它們。

仍未閉環：

- 沒有任何角色用 `recon.read` 展開舊步驟；decision 只在交回前寫。
- B 沒有主動 search 或 read 經驗，沒有可觀察的採用鏈。lesson 只是被呈現，不能說被使用。
- r19 兩題首次提交即解出，B 的准入從 r18 的 99 次降到 67 次；但每題只跑一次，A、B 不是相似題，也沒有 B0 對照，差異不能歸因於經驗。

**r16（2026-10-31）：**

已接通：

- 主動經驗呈現入口存在。
- B 能導出固定快照。
- 超長學習 response 在解析前被拒絕。

仍未閉環：

- A 有 88 次工具、0 decision、0 handoff，31 次 Recon 准入後因全局預算停止。
- A 的 episode 只覆蓋 16／89 條來源，遺失早期註冊與登入證據，並錯把晚期空表單 403 泛化為整題結論。
- B 的完整快照為 30 行、51,044 bytes；Solver 未讀正文，Verifier 只讀首頁且 `done=false`。
- B 搜尋經驗兩次卻未讀取或形成可觀察的採用鏈。
- B 的 711 字元 learning response 被正確拒絕，但輸出品質尚未解決。

其中交回、episode 來源覆蓋與學習輸出已在 r18／r19 解決；快照正文是否讀完、經驗是否被採用仍未解決。

R1／R2 能證明失敗局部隔離，不能把兩題寫成整體能力通過。

### 仍未證明的事項

- 已選定的追加式運輸接入產品後，能否帶來真實 provider cache 與 token 收益。
- 自動 compaction 是否能保留完整 tool-call／result 與可導航索引。
- input-token reservation 是否可靠，能否在硬停前留出完整交回。
- 完整索引在長題中是否可保持低 overhead 與可理解性。
- 真實模型是否會查閱舊步驟、引用指紋並避免無根據重複（r19：沒有調用 `recon.read`；同角色重複參數指紋 A 1 次、B 0 次，但無法區分是否因看了索引）。
- 有效 decision 的自然生成率及它相對於自動工具軌跡的增益。
- episode 的自然語言解釋是否忠實於完整來源範圍。
- 真實下游是否讀完同一快照版本的必要正文。
- 重啟後未知 publication 能否安全核對。
- 經驗呈現是否能被模型實際評估，以及同模型、同預算下的跨題收益（r19：lesson 已呈現給 B，但 B 沒有查閱，也沒有 B0 對照）。
- 正式映像、統計收益與歷史資料遷移。

這些 unknown 只改變相應局部結論，不否定已定的資料職責與失敗邊界。證據承擔過程；本設計只保留當前決策、限制與可信來源。

---

## 9. 文檔維護

**design 是當前決策快照，不是按時間累積的 run log。**

- 新結論先替換或整合最接近的既有決策段落；不為每輪實作新增日期小節，也不建立第二份權威。
- 改寫前核對仍影響判斷的契約、已否決方案、反例、適用條件、unknown 與驗證邊界；找到新位置後再刪舊內容。
- 標題保持決策維度，不用 plan 編號、執行批次或日期描述進度；只有出現新的決策維度時才新增章節。
- 詳細命令、hash、執行日誌與原始輸出留在既有 evidence／gate 位置；正文只保留影響設計的證據與 refs。
- 回補後檢查語義遺失、重複、矛盾與章節銜接；必要時回查 evidence。
- plan 的結論轉入本設計且檢查完成後刪除該 plan，避免設計與 plan 各說一套。
