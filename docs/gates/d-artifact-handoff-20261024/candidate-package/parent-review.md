# 主 session 獨立核對

2026-10-24：核對 28 個最終來源 hash、兩批 runtime 的來源副本、publication 原 bytes、候選區間與 hash、E 材料 bytes、包依賴及原生停止時序。主區基線的 3311 個文件在本次文檔回寫前完全未變。

主 session 在 ae52 子區復跑 `npx tsx tests/manual/d-candidate-package.ts parent-review-20261024`，四場景同一命令 exit 0；正常場景在同一 runtime 完成 E → Solver → Coordinator → Engineer → 整包固定與讀回。另復跑三份 D/D-H7 contract 測試，35/35。沒有修改原型後再沿用舊結果。子區全套 358/358、typecheck/build exit 0 已核對日志及最終來源，未無因重跑全套。

`parent-audit.json` 保存獨立 bytes/hash/時序核對，`parent-runtime.*` 與 `parent-targeted.*` 保存復跑結果。P1–P4 在 D §4 邊界內成立。停止透過原生 Recon 完成通知與 Coordinator 真實 task id 觸發；測試只控制 IO/回复時序，不用 SDK 恢復 child。R2 無包，R1/R3 保留已提交事實且無後續讀取；預定替身不重試不等於模型策略或強制鎖驗證。

本次僅同步證據與設計，沒有合併產品代碼。runtime-1 失敗、原始 RED 與 P3 誤拒失敗全保留；runtime-2 成功中間批留在子區，主區保留最終作者批與主審批。source/ 與 patch 是證據副本，不是主區接入。

包重放、依賴語義充分性、Verifier/可信結果/oracle、真實模型協作與強隔離未驗。1 MiB envelope／32 files 是本原型界限；因 base64 與 metadata 開銷，不能承諾所有 1 MiB 候選或附件可裝入同包。
