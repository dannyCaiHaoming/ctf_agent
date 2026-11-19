# 對照開源調研的設計隱患審閱（2026-11-19）

**狀態：** 審閱清單，待用戶決定去向；不是 design 決定。依 AGENTS.md「先查開源項目分析」的做法，由 gpt-6.2-astra 學習[開源調研](2026-11-12-open-source-ctf-skill-survey.md)第二批（§7–9）並對照現行 design，主會話逐項核對證據。來源等級沿用調研的說明：第二批多為 README／摘要轉述，只作線索；「已核對原文」只指 design 中已記錄核對的特定章節。

**範圍與證據：** 兩份 gate（`candidate-baseline-20261119-p1`、`model-compare-20261119`）的結構欄位、26 個 run 的 control-audit `context.presented` 計數與工作簿 sqlite 的 slot／status／role（不讀條目文字）、現行角色檔與 design。沒有模型 run。

## 結論

最緊迫的隱患是**工作簿視圖在長 run 中先丟掉早期基線**：這已在 30 分鐘、medium 題上出現，不是推測。其餘七項目前只有趨勢或結構性理由，先加量測或寫明契約即可。另修正了 B §7 基線表把「首次打包」當成「首次候選」的錯誤，以及本會話把日期誤寫成 2026-11-20 的幾處。

## 隱患清單

| # | 隱患 | 本項目證據（主會話核對） | 開源對照（等級） | 預防性調整 |
| --- | --- | --- | --- | --- |
| 1 | **工作簿視圖按上限省略時，先失去早期基線** | 26 個 run 中 2 個出現省略，都是未解 run：`Bad_Traveling-r1` 從 14.4 分起 42 次呈現帶省略（Solver 36、Coordinator 6），省略 10 條；`ac5a1bc0-b2` 從 12.3 分起 14 次、5 條。被省略的全是**仍有效、未被取代**的條目：Recon 事實 9、Recon open 假設 2、Recon 已排除 2、Solver 事實 2。舊結論「13 run、峰值 7731／8000、0 次省略」已不成立。量測加入後：Coordinator 視圖峰值占上限中位 67%、最高 99.8%，Solver 中位 63%、最高 99.8%；兩個省略 run 的 Solver 寫入只有 1／25、0／28 是取代 | pentestagent 的 notes→圖、BreachWeave 的 Idea／Memory 分離、Cairn 的 Fact／Intent（均為轉述） | 量測已加入基線腳本；省略規則已定案為「先壓縮成短列、受保護條目不刪」（團隊決策 §6.1，離線重放四項門檻通過），已實作 |
| 2 | **舊方向不被取代，與 #1 互相放大** | 首輪後 29 個 Solver 回合有 16 個只新增不取代（固定決策點診斷 §6）；只新增會讓條目更快撞上限 | BreachWeave、Cairn 的分欄（轉述） | 不加提示；把「有效條目數隨回合增長」列入量測，與 #1 一起看 |
| 3 | **Coordinator 規則持續膨脹** | 103 行、12,413 bytes，三天六次只增文字；停止規則 3 次變更後 run 只部分遵守 | 外部提示成本（調研 §9.1，轉述） | 見 [Coordinator 去重審閱](2026-11-19-coordinator-role-audit.md) 的 A 類，不改行為先合併 |
| 4 | **背景回合中的候選，父端看不到** | 1 例 proposed 候選 11.7 分寫入、未派 Engineer；成功 run 0.2–0.8 分即派 | D-CIPHER 最後交回機會（已核對原文，有限類比）；中途喚醒未覆蓋 | 交回合成對照進行中（團隊決策 §6.3）；G／結果完整性 design 寫明各時間戳代表的事件 |
| 5 | **可續讀不等於完整保存** | G 的 job 每流保存上限 1 MiB、超額丟棄並標 truncated；兩份摘要沒有逐流截斷欄位，無法估發生率 | VulnClaw 原文／預覽兩層、CyberStrikeAI 續接輪詢與統一輸出上限（轉述） | 已處理（2026-11-20）：job 終態的審計記錄逐流寫入已保存位元組、截斷標記與可確認的丟棄量，基線腳本統計 `job_streams`；G §5.3 已分述三種結果。此前 26 個 run 無此欄位，記 unknown，發生率待下一批 run |
| 6 | **Critic 介入時點與停止的因果不清** | 8 例 Critic 後 Solver 只工作 0–1.7 分即停（redirect 4、continue 1、stop 3） | BreachWeave 旁路 Observer、LuaN1ao Supervisor（轉述）；整題放棄時點未覆蓋 | 團隊決策 §6.4 區分 Critic 建議、Coordinator 決定與其後實際工作；不據此改角色檔 |
| 7 | **固定單一 flash 模型與 token 單一預算遮住成本結構** | 思考開／關 6 次各 1.96M／2.29M token；換模型對照未做 | hackingBuddyGPT 四種上限（轉述） | 成本報告並列牆鐘、停止時間、token 與 `usage_lower_bound`；既有延遲結論限定到所測模型 |
| 8 | **部分接受與多 flag 回執** | exact judge 下提交數＝solved 數，`posthoc_accepted` 全為 null，未出現逐部分回執 | TSec 賽制（轉述） | 保留 D 的逐部分身分與權威完成條件，合成回執覆蓋部分接受與未知送達 |

## 已修正的文字

- B §7 基線表：欄位改為「首次候选条目／首次打包」，原表填的是首次打包時間。
- B §7、團隊決策 §6.3、索引與 memory：日期 2026-11-20 改回 2026-11-19。交回驗證 plan 的檔名仍帶 11-20，因正被另一程序使用，暫不改名。

## 不採用

題解或公開軌跡檢索（污染）；按競賽排名擴編專家、Observer 或摘要角色（無法分離收益）；以 CCI 或模型判官覆寫權威回執；讓 host 判斷兩條假設語義等價；AGPL 項目只取想法。

## 待核對的一手來源

Cybench §2.4、§5.1 與 grading 定義；EnIGMA §4.1 逐類消融表；D-CIPHER 局部回合上限與最後交回設定；VulnClaw `evidence_view` 是否保證原文留存；CyberStrikeAI 的輪詢游標、截斷與取消實作。
