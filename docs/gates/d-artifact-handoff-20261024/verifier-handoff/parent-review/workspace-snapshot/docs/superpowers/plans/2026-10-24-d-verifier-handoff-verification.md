# D 第三接口：固定材料交給獨立 Verifier 最小驗證 plan

> 執行使用 superpowers:executing-plans，逐項驗證；使用者已授權專屬 session，不再派生其他 session。禁止 commit。

**依據／Spec：** docs/superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md §5；必讀 §3–4、核心 v1、C/G 相關契約及 AGENTS.md。
**目標：** 判定 V1–V4 的首題最小契約是否成立，回寫設計；不是接入主區或完成 D。
**Architecture：** 復用原生 task、C 綁定、ArtifactPublisher、CandidatePackages、G job；原型只在隔離工作樹。
**Tech Stack：** 當前 TypeScript／Node／OpenCode 公開 plugin/SDK/server，沿用既有本地預定替身，禁止真實 provider。

## 範圍與文件

可能修改：apps/launcher/src/control-service.ts、candidate-package-tools.ts、job-tools.ts、workspace-tools.ts、現有 plugin 工具／配置及 Coordinator/Verifier 角色正文；先查找真實位置再改，不建平行框架。
新增定向 tests/contract/d-verifier-handoff.test.ts、tests/manual/d-verifier-handoff.ts；復用 tests/manual/d-candidate-package.ts 的原生鏈路與替身方法。
證據存 docs/gates/d-artifact-handoff-20261024/verifier-handoff/，保留所有 RED、失敗及每批來源。不能覆蓋舊證據。
不擴展接口四／五、HTTP 重放、恢復系統、強隔離、通用依賴捕獲。不合併主區、不 commit/push、不跑真模型。

## 驗證步驟

- [x] 記錄來源 HEAD、git 狀態、產品／角色／測試 hash、OpenCode/SDK/Node 版本；確認接口一二在當前基線，保存原始缺接口失敗。先記錄實際命令，再按其命令復跑。
- [x] V1：原型以既有 assign 的可選 version 承載 Verifier 送驗聲明，task callID→真實 child→execution 消費綁定；測首次准入、錯角色／錯題／外來 task、遲到 child、同 session 新 execution 明確重綁及缺版本拒絕。正常非驗證角色不受影響。不從 prompt 授權。
- [x] V2：復用整包校驗與分頁；最小準備入口僅接收已綁版本的意圖，宿主選本次 work 子目錄並保留 manifest 路徑。測二進位/CRLF/UTF-8、多頁、材料與 artifact 依賴、損壞、路徑替換及準備中斷；半準備不 ready、不覆寫既有 work。
- [x] V3：真實 job 使用準備文件並記錄版本、實際 argv、文件 hash、execution/job/原始 stdout/stderr/終態。測偽造 receipt、準備後修改、執行中修改與恢復、路徑替換、未聲明依賴；具體記錄哪些能拒絕、哪些只能 unknown。不能用前後 hash 推論中途沒改、不能將輸出相等當語義通過。
- [x] V4：真實 plugin/C 路徑測準備及 job 在途停止、預算拒絕、回覆丟失／遲到。Coordinator 必須經原生任務完成通知取得控制並自然停止真實 task；禁止測試側 SDK resume child 製造在途。記錄資源終態、無盲目重發、unknown 邊界。
- [x] 同一次公開 runtime 串起 E→Solver 真實發布→Coordinator→Engineer 真實讀/整理/固定包→Coordinator 指定版本→獨立 Verifier 讀/準備/本地 job→原生交回。不得預置 published 或拼接各批成功；保存原始 bytes、session/messages、task-executions、binding/admission/resource、實際載入工具及角色全文、最終來源 hash。至少正常和停止場景；其他邊界分清 contract 與 runtime 證明層次。
- [x] 定向回歸接口一二和 C/G 受影響路徑，最後 npm run typecheck、npm run build、npm test；保存命令／退出碼／原始日誌。失敗如實留存，不削弱判據。
- [x] 子區回寫 D §5：每項成立/部分/不成立、版本條件、原始證據鏈接、推薦決策和剩餘問題；不宣稱主區接入、verified 或 solved。報告產品改動清單和最小必要證據 manifest。usage 不可得為 unavailable。

執行狀態：全部驗證步驟已執行；判定為 V1 成立、V2 有條件成立、V3 部分成立（完整固定輸入執行證明未成立）、V4 最小鏈路成立。結果已回寫子區 D §5，主 session 核對仍 pending。依明確交接要求保留本 plan／原型／工作樹，不在本 session 刪除或歸檔。

## 主 session 收口

主 session 獨立核對原 bytes、源 hash、真實身份與公開鏈路，必要定向復跑；實質缺口只回原專屬 session 修復本次範圍。只同步必要證據與選擇性 design 結論到主區，不複製產品代碼。主基線 /tmp/d-verifier-handoff-main-baseline.json 缺失時明示，不假稱比較過。
完成核對並回寫後才刪主/子已完成 plan，保存原型源碼和失敗證據以便日後接入，再歸檔子 session 並清理其工作樹。清理只針對本次工作樹，核實保存及實際移除，不影響其他工作。未完成不得提前清理。
