# 主 session 核對（2026-10-24）

子區原型基於 abe7d6e；產品未合併。已讀實作差異、測試、原始 bytes、公開 runtime 探針；校驗作者證據 manifest、最終來源與副本 hash、主區基線 4487 個登記文件未變。主 session 另跑接口一至三 46/46、同源六案 parent-runtime，命令均 exit 0。原 bytes、身份、首次准入順序及源 hash 核對見 runtime-audit.json；子區原125/125、372/372、typecheck/build記錄保留，非本輪重跑全套。

V1 成立；V2 限穩定可信 work 根且無不受管並發寫；V3 部分成立，CHANGEDUNDECLARED 真實反例保留，前後 hash matched 不證明中途未改；V4 只證明實際測得的停止／傳輸邊界。job-stop 在讀出20 bytes且running後才由原生 sibling通知接續父並停止；late為socket取消後未送達，不是收到後拒絕。所有場景替身固定決策，無真實模型，usage unavailable；不是verified或solved。

所有原失敗與早批來源原樣保存。sync-manifest.json逐檔核對同步；prototype.patch和workspace-snapshot保留本次未提交改動，最終可復用來源在parent-runtime/source及runtime-final-2/source。未增加後兩接口/延後工程。完成調查不等於V3完整條件通過，也不是產品接入授權。
