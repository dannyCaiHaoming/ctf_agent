# G 已定部分接入：c323 交付候選

日期：2026-10-24（Asia/Tokyo）。工作區 `/Users/caihaoming/.codex/worktrees/c323/pentest-agent`，detached HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`。依 G §10.1 與指定 integration plan 執行；所有產品、測試、文檔和新證據只寫本工作區。未 commit、push、合併、開其他 session／子 agent 或調用真實模型。主區文檔僅只讀 hash 比對，六份依據與啟動快照一致，未編輯主區。

**結論：G 已定接線在此 worktree 完成無模型同入口驗收。主區尚未接入，獨立主 session 核對待完成。** 完整多 Agent 做題流程、真實模型能力、solved 均未成立；直接阻斷完整交接的是 D 未定的產物發布／固定候選／驗證結果有效性接口，而非本次 G 已定工具接線。

## 來源與修改

- `sources.json`：來源 HEAD、C/RPC 原型逐文件來源與 sha256、起始設計／plan hash、主區只讀比較，以及三份保存 patch／原候選 manifest hash。
- 原 joint 工作區不存在；仍存的 `g-c-rpc-slow-tools` 產品／測試文件全部先核對 joint `sources.json`，再於本區 `.superpowers/sdd/2026-10-23-g-team-execution-integration/restored/` 恢復長 job、stop、joint 增量。plugin 重疊的恢復拒絕記錄保留，修復到原候選精確 hash 後才選取產品文件。`restored-hashes.json` 全部 match；不是宣稱舊工作區已取回，也未整份合併其他 worktree。
- `changed-files.json` 列本次 35 個產品／測試／本區 design、plan 文件及繼承的 dirty 文檔。繼承的 AGENTS／CLAUDE／核心／C／E／README 未由本次編輯，不能算作本次修改。
- 接入原型的題目 assign/unassign、E 真實三根、workspace/HTTP/job、Symbol call 關聯、完整 RPC 取消／等待、原生 background 自動交回／去重／恢復與 task.stop、可信 idle 收束。
- 新增真實 prepareRun 集成與九角色雙層准入／配置矩陣回歸；模型 job 只暴露 argv／timeout_ms。保留原型 direct-host 顯式 wait_ms/completion 的舊回歸路徑；它不在模型 schema 或正常模型入口契約內。
- E／G 的 UTF-8 分頁、cursor／binary 判定抽取為 `file-page.ts`；路徑授權與錯誤類型仍由各自適配器負責。原有及新 parity 測試通過。未擴張到其他模組。
- 更新產品共用約定與 Coordinator、Recon、Domain Solver、Engineer、Verifier 的必要操作說明；其餘既有角色責任保留，未新增角色、工具或 D stub。G §9.1 僅本區候選回填，§6 舊「公開入口待驗」改為已選 §7.2.2 映射；plan 按明確指令保留給主 session 核對。

## 本次驗證命令與結果

命令均在本 worktree 執行；下表的數字是本次輸出，不借用歷史通過數。

| 命令 | 結果／原始輸出 |
| --- | --- |
| `npm ci` | 退出 0；未升級依賴。安裝輸出 `00-install.log` |
| `npm test`（初始基線） | 退出 0，`00-baseline.log` |
| `npx --no-install vitest run tests/contract/control-service.test.ts tests/contract/g-async-lifecycle.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/slow-tools.test.ts`（只移測試、未接產品） | 預期退出 1，67 failed / 7 passed；`01-imported-tests-red.log` |
| `npx --no-install vitest run tests/contract/g-team-integration.test.ts`（未接產品） | 預期退出 1，缺少題目 assign；`02-team-red.log` |
| `npx --no-install vitest run tests/contract/control-service.test.ts tests/contract/run-prep.test.ts tests/contract/g-team-integration.test.ts` | 初次 46/47：新測試誤寫拒絕短碼，實際為既有 `tool not permitted`；只修測試期待，`03-task1.log` 保留，後續定向全部覆蓋通過 |
| `npx --no-install vitest run tests/contract/control-service.test.ts tests/contract/run-prep.test.ts tests/contract/intake-tools.test.ts tests/contract/slow-tools.test.ts tests/contract/g-team-integration.test.ts tests/contract/g-async-lifecycle.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/launch-evidence.test.ts` | 退出 0，110/110，`04-directed.log` |
| `npx --no-install vitest run tests/contract/opencode-config.test.ts tests/contract/g-team-integration.test.ts` | 退出 0，5/5，`05-role-matrix.log` |
| `npx --no-install vitest run tests/contract/intake-tools.test.ts tests/contract/workspace-tools.test.ts tests/contract/g-team-integration.test.ts` | 退出 0，`06-shared-read.log` |
| `npx --no-install tsx tests/manual/g-team-integration.ts` | 退出 0，同次 launch 通過；`07-team-runtime.log`、`team-runtime/` |
| `npx --no-install tsx tests/manual/g-joint-lifecycle.ts integration-review` | 退出 1；stop-job / stop-http 的測試替身未發 stop，兩項 deadline_exceeded；其他四項符合預期。原始完整失敗批保留於 joint/runtime/integration-review/、`09-joint-runtime.log` |
| `npx --no-install tsx tests/manual/g-joint-lifecycle.ts integration-review-fixed` | 退出 0，五個 completed、一個預期 budget_exceeded；新完整批在 joint/runtime/integration-review-fixed/、`12-joint-runtime-fixed.log` |
| `python3 docs/gates/g-solver-verification-20261023/integration-20261024/verify-current.py` | 退出 0，保留原 joint 原始事件核對判據並增加 team 已保存輸出核對；`13-evidence-check.log`、`verification.json`、`team-verification.json` |
| `npm run typecheck` | 退出 0，初次 `08-typecheck.log`、最終 `14-typecheck-final.log` |
| `npm run build` | 退出 0，`10-build.log` |
| `npm test`（接入後及最終） | 退出 0，42 文件 323/323；`11-full-test.log`、`15-full-test-final.log` |
| `git diff --check` | 退出 0 |

Node v26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0、Vitest 2.1.8。runtime 的 Node module.register deprecation warning 保留，未作產品失敗或篡改輸出。

## 同入口證據與界限

`team-runtime/` 是單次 launch：真實 E prepareRun，Intake list/read 並 task 交回，Reference／Strategy，Recon 真實文件與 loopback HTTP，Domain Solver 失敗腳本，Coordinator 恢復同 task_id 後修正腳本，Engineer 與 Verifier 分開讀同一份材料、在自己 work 本地重算，原生完成通知交回後正常收束。順序只存在確定性 provider 測試腳本，未硬編碼到產品。

40 次替身請求／40 次准入，5 次背景 execution，12 項資源 settled；Solver 同 child 兩個不同 ref 各 consumed 一次，首次 native 回覆未被覆寫；一個授權 loopback HTTP 請求。原始 stdout 分別保存實際 42，stderr 保留第一次腳本錯誤。published 為空，未使用測試預置發布文件或候選工具。Engineer／Verifier 本地材料重算不是 Solver 解法產物交接，不能替代 D。一次普通腳本失敗不觸發 Recovery Critic；責任及持續停滯觸發保留。

原始請求／事件、bindings／admissions／executions／resources／messages、job stdout／stderr、run 狀態均存 `team-runtime/`。六情境新批另存 `../joint-async-lifecycle/runtime/integration-review-fixed/`；`verification.json` 逐情境結果與 usage。替身回報零 tokens 僅是測試數值；真實模型 usage unavailable，無自主解題能力結論。

六情境首次失敗原因已由原始 provider messages 核對：新的 Coordinator 指令包含 `ctf_task_stop`，fixture 的全文 substring 判斷誤以為工具已呼叫，未發 stop。修正只看 assistant.tool_calls，原產品與 deadline 未改。完整新六情境單批通過，不從舊成功補失敗。延遲 child／重複通知／啟動失敗／unknown 等部分仍是確定性覆蓋，不冒稱所有競態都有 runtime 注入。

## 工程取捨與核對狀態

1. 依明確指令不 commit／子 agent／刪 plan，也不修改主區；保留 scratch／ledger 供主 session 核對。代價：沒有提交邊界，主 session 必須按 changed-files 與 hash 選取。
2. 缺失 joint 工作區以有來源 hash 的原型＋補丁恢復，不重寫另一套。代價：補丁重疊須人工核對；以恢復後全文件 match 證明等價，最終產品另驗。
3. 只共用 E／G 分頁，不重構路徑授權。代價：共用部分回歸會同時影響兩者，既有 adapter 與 parity 測試覆蓋。
4. 舊 direct-host wait/completion 僅保留已驗回歸入口，模型 schema／正常入口終態等待。代價：持有控制 RPC 憑據的 raw client 仍能調舊模式；沒有宣稱同 uid OS 隔離已成立。
5. D 與隔離／網路／完整容量／跨重啟部署保持延後，不造 stub。代價：本次不能宣稱完整解題、verified、solved 或正式運行邊界成立。
6. fixture 停止判斷修正保留兩次失敗，使用完整新六情境檢驗；沒有修改產品來遷就 fixture。

依執行指令只做作者自審，按 plan Review Focus 檢查 pending／call 關聯、私有 work、長 RPC、execution 恢復世代、停止／預算／unknown 競態；本 G 接線切片無待修 Critical／Important。沒有額外擴充或待辦 minor。作者自審不替代主 session 獨立審查。

`candidate-hashes-before.json`／`candidate-hashes-after.json` 核對 98 個產品／測試來源零漂移。`final-hashes.json` 列最終本次修改、依據文檔及新批所有證據（排除 manifest 自身）的 sha256；原始歷史證據未改寫。原先未追蹤的大型歷史證據不作本次新增實作。
