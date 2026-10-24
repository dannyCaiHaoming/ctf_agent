# 主 session 獨立核對

2026-10-24。結論：接口一有條件可行，不能記為 H1–H7 全通過。後四接口未實作／驗證。產品原型保留在子 worktree，未合併、未提交。

核對 final-manifest 的 15 個來源文件及 187 個證據文件，全部 hash 相符；主區派發前基線 2,173 個文件全部一致，見 hash-check.json。檢查原型差異、artifact publisher、C 授權與來源記錄、job/HTTP 捕獲、G published 讀取／列表／搜索、配置及 H1–H7 測試。沒有候選登記、驗證任務／結論、oracle 或隔離部署實作。

主 session 在原子區執行六份相關 contract 測試，83/83 通過（其中 D 22 項），退出碼 0；再執行既有 manual 探針，使用新批 parent-runtime-review，退出碼 0。僅 loopback 預定替身、真實模型調用 0。啟動鉤子只訂閱事件，沒有 SDK prompt 注入。四份發布在同一原生 runtime 中完成；來源文件／job stream／固定 HTTP body、發布 bytes/hash 與 Engineer 實際 tool reply 均逐一相等，見 bytes-check.json。這是接線驗證，非自主解題。

H1 接線成立，但 27/27 原生模型請求含宿主 cwd/instructions 路徑，完整條件未通過。H2 同次 runtime 成立；H3、H4、H6 定向契約通過，未知文件 producer=null，受管 API 不等於 OS 隔離。H5 明確 barrier 競態拒絕成立，仍依賴可信穩定根／無不受管並發寫入；同 uid 改寫 published 反例保留。H7 寫失敗、取消／期限、丟回复僅組件時序注入；丟回复測試是丟棄返回值，沒有完整 RPC 斷網、取消競爭或 unknown 恢復驗收，不能提升為端到端保證。

子區全套 345 項、typecheck/build 的既有日志及退出碼已核對，本次不重跑未改動全套。所有舊失敗與早期 H1 過度陳述留存，後者以最終 provider 原文和本次復跑糾正。早期批無完整逐批源碼快照，不能聲稱可精確重建。

調查結果已轉入主區 D design；完成的驗證 plan 按倉庫約定移除主／子區副本。final-manifest 的 plan hash 記錄移除前來源狀態，不再代表當前文件存在。子 session、worktree 保留。
