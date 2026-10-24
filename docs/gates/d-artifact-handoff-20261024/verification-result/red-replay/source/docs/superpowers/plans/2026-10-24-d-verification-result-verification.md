# D 第四接口：驗證報告與有效性最小驗證 plan

> 執行使用 superpowers:executing-plans。使用者已指定專屬session，不新增其他session；禁止commit。

**Spec：** docs/superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md §6（及§3–5）；遵守AGENTS.md、核心v1和C/G邊界。
**Goal：** 驗證報告登記／指定結果讀回與有效性最小契約，回答Q1–Q4，非主區接入或第五接口。
**Architecture：** 沿用C原生session/execution/准入，CandidatePackages、preparation、JobManager原始輸出；宿主固定報告證據，模型負責語義判斷。舊IndependentVerificationService不整體移植。
**Tech Stack：** 現有TypeScript/Node/OpenCode公開plugin/SDK/server，本地loopback預定替身；無真實provider。

## 範圍

子工作樹允許最小原型；主要關聯apps/launcher/src/control-service.ts、candidate-package-tools.ts、job-tools.ts、apps/opencode-plugin/src/index.ts、product/opencode/opencode.json及Coordinator/Verifier正文。必要時新增apps/launcher/src/verification-results.ts集中報告存儲與核對，避免平行身份/候選registry。新增tests/contract/d-verification-result.test.ts與tests/manual/d-verification-result.ts，復用第三接口原生probe。
證據放docs/gates/d-artifact-handoff-20261024/verification-result/，保留所有RED、失敗、原bytes、來源及最終hash。具體候選schema若需選擇，先寫子區design並標明候選，不只藏在plan/代碼。
不擴展第五接口、通用replay、強隔離、通用依賴捕獲、恢復系統。不合併產品代碼、不commit/push、不跑真模型。

## 驗證步驟

- [ ] 記錄HEAD/git狀態、產品/角色/測試hash及runtime版本，核對前三接口基線639782b；缺接口先保存真實RED，不改舊失敗。
- [ ] Q1：原型提供Verifier報告提交與Coordinator指定結果讀取；宿主填身份/版本並解析真實job或固定artifact證據，無需Verifier發布權。測錯角色/題目/版本/execution、假receipt/job、外來證據；真實原生鏈路首次登記不能靠假session。
- [ ] Q2：實際本地job和固定bytes構造有效重算、有效反證、缺證據三類；原生替身只測裝配。加入echo候選、相同輸出但錯輸入、第三接口中途改寫再恢復反例、audit僅字串匹配。驗證不因機械相等自動升格；逐項說明宿主拒絕條件、Verifier語義判斷和無模型不能證明處，禁止建立關鍵詞判斷器冒充語義驗證。
- [ ] Q3：必要證據截斷不可用，無關截斷不自動否決但需明示選材條件；未知前提、已知改寫保留，不能字段齊全就清除unknown。測修訂/回報競爭、舊結果配新版本拒絕、相關依賴改變失效而無關work修改不失效。保存原判斷與當前可用性，不新建latest或五分鐘TTL。
- [ ] Q4：測登記前停止、登記後回复丟失/遲到、預算拒絕、重複/衝突提交，保存和收到分開。採現有原生sibling完成通知接續Coordinator自然停止；不得SDK resume child製造在途。不得用恢復系統解決unknown。
- [ ] 同一次公開runtime完成E→Solver真發布→Engineer固定包→Coordinator指定版本→Verifier讀/準備/job/報告登記→原生交回→Coordinator讀指定結果。不得預置published或拼接各批成功；保留真實載入角色正文/工具、provider請求、messages、bindings/executions/admissions/resources、原始bytes、判斷/宿主檢查/可用性。
- [ ] 定向回歸前三接口及受影響C/G；最後npm run typecheck、npm run build、npm test，命令/退出碼/原始日誌留存。停止與傳輸場景用真實plugin/C RPC；完整性/重複等contract與runtime證明層次分清。
- [ ] 子區回寫D§6：Q1–Q4成立/部分/不成立、最終schema決策、版本條件、unknown處理與仍未解問題。不能稱主區已接入、模型能力已驗、完整D或solved。保存最小必要證據和全部改動源碼manifest；usage不可得為unavailable。

## 主session收口

讀結果後獨立核對diff、原bytes、來源/最終hash、真實公開鏈路、載入正文與必要定向復跑。基線/tmp/d-verification-result-main-baseline.json缺失須明示。實質缺口只回原專屬session繼續本次範圍。
只同步必要原型源碼/原始證據到主區gates並選擇性回寫當前D與必要索引，不合併產品。結果轉入後清理主子已完成plan；確認代碼與失敗證據已保存後歸檔子session並移除該工作樹，核對不影響主區及其他樹。未完成不提前清理。
