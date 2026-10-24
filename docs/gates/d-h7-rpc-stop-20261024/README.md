# H7 最小無模型驗證（子區結果，待主核對）

工作區 `/Users/caihaoming/.codex/worktrees/1488/pentest-agent`。本輪沒有新增產品代碼修改，未修改主區、commit/push、合併或清理。design §3 已回填詳細結論，計畫依要求保留。

- `start.json`、`starting.patch`：起始 HEAD、dirty 狀態及舊原型 hash 核對；舊 plan 缺失已知，不是代碼漂移。
- `document-source.json`：主區最新 design/plan 的來源 hash；`source-snapshot/` 保存回填前設計與實際執行探針／產品源碼。
- `initial/`：首批四案完整結果；`final/`：加強原始工具狀態、call/execution/resource、bytes 與事件順序斷言後的完整四案。兩批 exit 0，沒有失敗驗收批；不拼接批次。
- 每案 `observations.json` 是序號化 barrier/傳輸/C 提交/停止觀測；`wire.json` 是實際 publish RPC request/預備 response（不記錄 bearer credential）；`events.json`、`provider.json` 保存原生事件與完整替身請求/回覆選擇。`evidence/`、`workspace/`、`state/` 保留原始會話、審計及 bytes。
- `summary.json` 每案列實際 resource、execution、原生 publish 工具終態；final：對照/R1/R2/R3 的發布數為 1/1/0/1，替身請求數 15/10/13/13，每案真實 job 與 publish 各 1 次，所有資源 settled。
- R1：C 提交後實際 socket destroy，插件 `denied: control unavailable`。R2：rename barrier → C revoke → 放行 → cancelled，沒有發布或殘檔。R3：提交 → hold 真實回复 → native task.stop/abort → socket 關閉 → stop result → 釋放已斷開回复；工具 `Tool execution aborted`，已有發布仍保留，無新交付。
- 定向 `regression-1.log` 56/56，全套 `test-all.log` 348/348。各命令的退出碼單獨保存；typecheck/build 詳見對應檔。`ledger.md` 記判斷與限制。

真實模型調用 0。僅 loopback 預定替身，真實 usage unavailable；替身回報的零值不是實測 provider 消耗。UNKNOWN/不重試的選擇是 fixture 裝配，不證明真實模型會遵守；R3 只證明 native abort 丟棄遲到回复，不聲稱 native 成功收到該回复。無恢復、冪等、跨重啟、H1 路徑隱藏、H5 強隔離或 D 整體／solved 結論。詳見 D design §3。
