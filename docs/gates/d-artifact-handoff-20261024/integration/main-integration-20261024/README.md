# D 第一接口主工作區接入

2026-10-24。使用者明確授權後，主區逐文件遷入 18 個已核對的實作／測試／角色文件。遷入前主區產品文件與 HEAD c652e95 一致；子區來源逐一與主審 source 副本吻合，清單見 transfer-manifest.json。保留主區最新文檔與全部歷史失敗，沒有整份合併 worktree。這次沒有新增功能語義。

主區 typecheck、build、npm test 均 exit 0，全套 44 檔 348/348。無模型四產物批 integration-main-20261024 同一次 E→Solver→Coordinator→Engineer 原生交接完成，4/41/16/14 bytes 與 Engineer 實際頁內容／hash 一致；新版角色正文載入已核對。H7 同名批 control/R1/R2/R3 全部 exit 0，發布數 1/1/0/1，每案來源 job／publish 各一次，資源 settled。R1 真實斷線保留已提交快照，R2 停止先勝無引用，R3 提交先勝後 native abort 丟棄遲到回复。交叉核對見 crosscheck.json；兩批在各自既有 gate 的 integration/integration-main-20261024/。

命令：npm run typecheck；npm run build；npm test；npx --no-install tsx tests/manual/d-artifact-handoff.ts integration-main-20261024；npx --no-install tsx tests/manual/d-h7-rpc-stop.ts integration-main-20261024。完整輸出及退出碼各自保存，沒有新失敗驗收批；原有失敗與注入故障錯誤不刪除。runtime 僅 loopback 預定替身，真實模型調用 0，真實 usage unavailable。

H1 全局路徑隱藏未通過／延後，H5 可信穩定根及寫完再發布條件、producer unknown、背景限定、1 MiB 文件／流和32 KiB頁限制保留。H7 無自動恢復或 unknown 強制鎖，模型遵守不重試尚未驗。只完成 D 第一接口，不代表候選／Verifier／oracle／solved 已成立。未 commit/push，未歸檔清理原子區。

Ruling：沿用已核對原型及既有獨立主審，不重新製造 RED 或啟動另一輪開發；本輪以來源 hash、主區全套和原生集成驗收確認遷移。代價是繼續承接已明示的模型與隔離限制。使用者禁止提交優先於 skill 通用提交／清理步驟。
