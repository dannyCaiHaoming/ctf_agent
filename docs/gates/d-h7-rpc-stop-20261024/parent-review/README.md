# H7 主 session 獨立核對

2026-10-24。結論：R1–R3 在本輪最小契約和明示邊界內通過；不代表恢復系統、真實模型判斷、D 整體或 solved 已驗證。主區產品未接入。

核對 17 個最終來源文件、244 個原始證據文件 hash 均相符；派發前主區基線 2,401 個文件全部一致，見 hash-check.json。產品源碼與前一 D 原型相同，本輪只新增探針與測試及文檔。主 session 已閱讀探針、組件測試、plugin fetch/single-use call marker、C 發布和 RPC abort 鏈路；未以子 session 的結論代替審查。

獨立復跑：三份 contract 測試 56/56，退出 0；新批 parent-review-runtime 四案逐一 launch，退出 0。原始 bytes、工具 callID、execution、job resource、publication 與原生工具狀態交叉核對見 raw-crosscheck.json。每案來源 job／publish 各一次；四案發布數 1/1/0/1；所有資源 settled。對照 Engineer 讀回同一份 18-byte job stdout。子區原全套 348 項、typecheck/build 日誌保留，本次未重跑未改動全套。

R1 的 C.commit → RPC reply ready → socket.destroy → unfinished close，對應 plugin 原生工具 error「denied: control unavailable」；C 發布事實及 bytes 保留。R2 的 rename barrier → Coordinator 原生 ctf_task_stop → C revoke → rename 放行 → cancelled → stop result，發布記錄為零且 published 無殘檔。R3 的 C.commit → response barrier → C revoke → unfinished socket close → stop result → late attempt（destroyed=true），對應原生工具「Tool execution aborted」，C resource completed 與 execution cancelled 同時保留，並不矛盾。

注入包裝真實 HTTP response.end 與 fs.rename；C record 包裝先執行原方法，僅觀測並釋放 barrier。沒有直接私有 revoke、SDK prompt／恢復子任務，也沒有預置 published。測試側 recon 替身等待 barrier 後以原生任務完成喚醒 Coordinator，故停止時機是確定性安排，不是模型自發決策。R3 證明原生 abort 丟棄遲到回复，不證明原生插件收到成功回复後再阻止交付；組件測試能收到遲到結果，與原生場景分開。

plugin 對同一調用不自動重試；SOURCE_RESULT:UNKNOWN、Coordinator 暫停／不開 Engineer 是替身預定選擇，不能推導宿主會阻止仍活躍模型新發一個發布／來源調用。這是實際驗證邊界，非新增恢復系統承諾。錯誤不是「確定未提交」；已有快照不因傳輸失敗被當成未發生。

兩個子批與主復跑均完成，沒有新失敗驗收批，不造 RED→GREEN。所有故障注入的原始 error 狀態及前輪 D 失敗證據保留。唯一 enabled provider 為 loopback 替身，真實模型調用 0；替身零 token 不是真實 provider 消耗。

主區只同步證據及選擇性 D/索引更新；完整結論轉入 design 後移除活動 plan 主／子副本。source-snapshot 中的舊 plan 僅為帶 hash 的歷史輸入證據，非活動計畫。final-manifest 記錄移除前來源，不能據此聲稱 plan 目前仍存在。子 session 和 worktree 保留，無合併、commit/push。
