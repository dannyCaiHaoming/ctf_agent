# D H7 真實 RPC 回复丟失與停止競爭最小驗證 plan

**依據／Spec：** [D 詳細 design §3](../specs/2026-10-24-design-v1-d-candidate-verification-minimal.md)，尤其「首題接入的當前邊界與延後項」。設計與決策以該文為準。

> 執行者使用 superpowers:executing-plans；使用者已授權本專屬 session 執行，不再開 session／子 agent。使用者禁止 commit／merge／真實模型的要求優先於 skill 的通用流程。

**Goal：** 驗證同一真實 OpenCode plugin→C→發布路徑在回复丟失、停止先後競爭下不誤交付、不重跑來源。
**Architecture：** 沿用既有 D-one 原型、C 准入與原生 task.stop；loopback 替身只輸出預定工具調用。故障注入只控制傳輸／時序，不替代產品的授權、發布、取消或狀態判定。
**Tech Stack：** 現有 TypeScript、Node、OpenCode 公開 plugin/SDK/server、Vitest；版本與 hash 實測記錄。

## 邊界與來源

- 執行工作區：`/Users/caihaoming/.codex/worktrees/1488/pentest-agent`；前一 D session 已完成且空閒。新 session 獨占本次寫入。主區 `/Users/caihaoming/Documents/pentest-agent` 僅只讀。
- 先記錄工作區 git status/HEAD；按舊 `docs/gates/d-artifact-handoff-20261024/final-manifest.json` 核對原型代碼。舊 design 已由主區更新、舊 plan 已刪除，不能誤當代碼漂移；最新 design/本 plan 從主區複製到子區並記錄來源 hash。保留舊證據原樣。
- 只允許 loopback 替身和非秘密 fixture；啟動前核對唯一 enabled provider、baseURL、proxy；不能真實模型、commit/push、合併、清理/歸檔工作區。不得擴展 D 後四接口、H1 隱藏、H5 強隔離或恢復系統。
- 原型缺陷只在子區作本契約必要最小修正，先保存失敗批；無授權內可行路徑時記明缺口，不繞公開 runtime 或降判據。

## 文件與責任

- 新增 `tests/manual/d-h7-rpc-stop.ts`：沿用 `tests/manual/d-artifact-handoff.ts` 的真實 launch 與原生任務交接；該舊探針會讀已刪除 plan，勿恢復舊 plan 冒充現行依據。
- 必要定向測試 `tests/contract/d-h7-rpc-stop.test.ts`；被測來源 `apps/opencode-plugin/src/index.ts`、launcher 的 `control-service.ts`、`artifact-tools.ts`、`launch.ts` 及既有 RPC server。只改實際缺口所需文件，不能預設要改全部。
- 原始證據放 `docs/gates/d-h7-rpc-stop-20261024/`，每次唯一批次目錄拒絕覆寫；子區 D §3 回填候選結論，主區由主 session 選擇性回寫。

## 一個驗收切片：發布的真實傳輸與停止語義

- [ ] 保存來源 manifest、現有差異與版本；讀最新 D §3、C/G 停止契約與舊失敗。盤點公開 RPC/取消鏈路，標記測試注入位置和產品提交點。
- [ ] 建立無故障對照：來源角色受管寫入／真實 job 產生 bytes，實際發布，原生 task 交回引用，Coordinator 分派獨立 Engineer 讀回。不能預置 published、不能由 SDK 向子會話塞引用或內容；SDK 僅觀測。記錄原始 bytes、call/execution/resource、hash、provider 請求與原生事件。
- [ ] **R1 已提交但回复丟失：** plugin 真實發出發布 RPC，C 真正提交登記後，在實際 HTTP 傳輸邊界斷開／吞掉回复。不得僅丟棄函式返回值。記錄 C 提交與 plugin 所見錯誤／超時；host 保有一份完整記錄，沒有半引用。未收到引用不能冒充已交付；來源操作計數不增加，不能自動重發發布。替身遇錯不重試只驗協議裝配，不聲稱模型永不重試。
- [ ] **R2 停止先勝：** 在實際發布尚未提交時以明確 barrier 暫停，Coordinator 從原生公開停止入口停止該 execution；確認停止到達 C，再放行 pending IO。斷言無可用新引用、無遲到成功交接、無來源重跑、資源收束。不能直接調用私有 revoke 取代原生停止；不能 SDK 恢復 child 製造在途狀態。
- [ ] **R3 提交先勝：** C 已提交後延遲真實 RPC 回复，Coordinator 停止該 execution，再釋放／丟棄回复。保留完整既有發布事實，已停止 execution 的遲到结果不成為新交付授權；錯誤／unknown 與已提交事實分開，不盲目重發。記錄原生完成事件、C 執行狀態、plugin 所見結果，不能單靠 fixture 最後說成功。
- [ ] 注入須有可核對 barrier 順序及時間／身份，不依靠 sleep 猜競爭。若 runtime 無法進入某狀態，標記未驗，不能用組件結果替換。以 host 審計、實際 socket／RPC、會話消息、文件 bytes 交叉核對。
- [ ] 定向復跑 `npx --no-install vitest run tests/contract/d-h7-rpc-stop.test.ts tests/contract/d-artifact-handoff.test.ts tests/contract/control-service.test.ts`；runtime 使用 `npx --no-install tsx tests/manual/d-h7-rpc-stop.ts <fresh-batch>`，可在探針內逐案獨立 launch。若改產品代碼，執行既有 typecheck/build/npm test；不反覆重跑未改全套。記錄命令、退出碼及各案真實結果。
- [ ] 回填子區 D：明確 R1–R3 的通過、失敗、未知、產品問題或測試問題；保留所有失敗及修正前後 hash，不把 H7 最小邊界通過寫成完整恢復／D／solved。

## 主 session 收口

主 session 完成後獨立核對來源/final hash、原始事件、原生 task.stop 是否真實、提交點與回复斷開順序、來源操作次數及必要定向復跑。只把必要證據與結論同步主區 design；不複製產品代碼。不以測試數量代替 R1–R3。調查結果完整轉入 design 後刪除本 plan 主／子副本，保留全部失敗。子 session／worktree 不自動歸檔清理。
