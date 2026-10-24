# D 第一接口接入：主 session 核對

2026-10-24。結論：子工作區已完成最小接入並通過主核對；主區產品仍未合併。子區為 `/Users/caihaoming/.codex/worktrees/1488/pentest-agent`，HEAD c652e95 上未提交修改。沿用 v1 九角色及 E/G/C 原生鏈路，沒有新增求解器、恢復系統或 D 後四接口。

核對原 final-manifest 的 37 個來源及 205 個證據 hash 全部一致；派發前主區基線 2,760 個文件無漂移。宿主實作沿用既有 D 原型，主要新增工具與五角色說明、探針來源/輸出位置修正；artifact-tools 僅註釋變更。未整份套用子區文檔。

主審發現 Engineer 說明錯列 HTTP 發布來源，而其無 HTTP 權限、不可發布其他會話 resource。原專屬 session 已僅修正文檔：自己的發布限文件/job，Solver HTTP 產物走已發布 ref 讀取。修正前後正文、diff、增量 hash 保存在 engineer-doc-correction-20261024/；舊 manifest 和驗收原樣保留。這是說明缺陷及其修正，不偽造測試 RED。

修正後主 session 獨立完成：七份定向測試 86/86（exit 0）；四產物同一 runtime 批 integration-parent-review（exit 0）；H7 同名新批對照及 R1–R3（exit 0）。四份原始來源與 Engineer base64 tool reply 逐 byte/hash 相等，大小 4/41/16/14；Coordinator/Solver/Engineer 完整新版正文及 publish/read 描述實際出現在 provider 請求。Recon/Verifier 載入記錄沿用子區 inventory/copy 核對，不冒充兩者均做了本輪交接。

H7 每案來源 job／publish 各一次，發布數 1/1/0/1，全部資源 settled；原始來源 execution、job、bytes、停止 task_id 及 barrier/socket 順序已核對。R1 真實 socket 丟失而 host 保留快照；R2 原生停止先勝後零引用；R3 提交先勝，native abort 關閉連接，遲到回复未送達，既有發布事實保留。不把組件收到遲到回复情境混入 runtime 結論。

子區最終 typecheck/build exit 0、全套 348/348 日誌已核對；其後唯一角色文字修正由本次真實載入及集成復跑覆蓋，未重跑未變的全套。主核對原始交叉檢查見 crosscheck.json，修正後實際源碼副本在 source/，僅作證據，不是主產品接入。兩個主復跑 source-hashes 與最終文件一致。

H1 原生路徑暴露、H5 穩定可信根／寫完再發布條件、producer unknown、背景限定、H7 無恢復／無 unknown 強制鎖定仍保留。替身選擇不重試不是模型能力證據。真實模型調用 0，非 solved。所有歷史失敗與本次故障原始錯誤均保留。

完整結論轉入主區 D 後移除活動實現 plan 主／子副本；原 manifest 的 plan hash 表示移除前來源，不再聲稱當前存在。未合併 worktree、未 commit/push；子 session 和 worktree 保留。
