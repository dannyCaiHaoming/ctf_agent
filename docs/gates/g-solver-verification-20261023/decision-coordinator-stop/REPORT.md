# G：Coordinator 停止入口——部分通過，產品時序未定稿

2026-10-23，Asia/Tokyo。只做本地無模型驗證；沒有真實模型、真實 provider 或外部靶場呼叫，沒有 Docker、commit、push、合併或刪除 worktree。

**結論：受管停止候選的授權與回收成立，完整產品主動停止判據尚未通過。** 建議保留 `task.stop(task_id)` 作權限／回收入口候選；不能把 SDK 時序 fixture 視為 Coordinator 已能在前台 task 等待時自主停止。G/C design 已保留此缺口，候選工具未獲主線整合或外部契約定稿。

## 判據與候選比較

| 問題 | 證據與結論 |
| --- | --- |
| 原生工具能否直接停止 | 實際 Coordinator 模型請求只含原生 read/skill/task，無停止工具，task schema 無 background。原生 SDK 有 session.abort，但不是模型工具；它不撤銷 C 綁定，也不回收已交付受管 job。native-control runtime 中 abort 回 true 後已交付 job 的孫進程仍在，接著才由產品 task.stop 回收 |
| 授權從哪來 | 沿用 C 本實例 dispatched 與 binding 的父子、via、role、有效期。task_id 來自原生 task 結果，只選擇 child，不授予權限。非 Coordinator、他 parent/run、偽造、未綁定和到期句柄拒絕；before/execute 都核實 |
| 是否重複清理／誤報 | 短串行區先撤銷，隊列外清理。child 單一停止 promise；重複不再 abort/歸還名額。resources 與 sessionAbort 分開報告，未知保持 unknown。SDK 不返回、失敗、程序組探測 unknown 都有定向用例；完成與停止競態只結算一次 |
| 正在等待時能否回收 | accepted/http 與 accepted/job-wait 中，Coordinator 真正調產品工具，停止已在 HTTP 或 job.run 等待的 child；原已交付 job、等待 job 的孫進程在全局收尾前消失，輸出保存；另一 child 的模型與 job.read 繼續。**前置等待由測試側公開 SDK 恢復原 child 建立，僅證明接線** |
| 自然產品入口是否成立 | 無 SDK 恢復的 accepted/foreground：HTTP entered=1792760252913，closed=1792760254120；父下一輪=1792760254184，停止決策=1792760254335。父等待整段沒有下一次模型請求，task_id 在原 task 結果中才交付。新分派 task 未結束時的主動停止未通過 |

公開 SDK 可以作 C 最終執行原語，不能取代 C 授權／資源帳本。補充下載的 [上游 task 原始碼](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/tool/task.ts) 保存在 `native-task-source.ts.txt`；其中有實驗背景分支，但本次已安裝 runtime 暴露 schema 無 background。判斷優先用實測版本／設定，未啟用或窮盡其他公開背景、並行、通知組合，不推論 OpenCode 整體無法滿足。

## 原型契約與改動

僅新增候選 `ctf_task_stop`，參數 `task_id`，只有 Coordinator 可見。C 返回 `{state, resources, sessionAbort, alreadyStopped}`，清理未知或 SDK 結果未知時 state=unknown，不重發未知停止。沿用資源收尾 4000ms，候選另設 SDK abort 4000ms／RPC 10000ms；數值適用性未定。已完成 task 仍可有 running job；停止只撤銷往後操作與剩餘資源，已 exited job 保持 exited。host revoke 復用相同停止 promise。

本項產品增量只有 `apps/launcher/src/control-service.ts`、`apps/opencode-plugin/src/index.ts`、`product/opencode/opencode.json`；新增 `tests/contract/g-coordinator-stop.test.ts` 和 `tests/manual/g-coordinator-stop-runtime.ts`。其餘產品差異為從指定原型匯入的基線，不是本項新增。相對原型補丁為 `candidate.patch`，源碼副本與 hash 見 `candidate-source/`、`final-hashes.json`。文檔只回寫本區 G §7.1/9/10 與 C §5/6，plan 保留給主會話處理。

## 驗證與原始記錄

| 命令／範圍 | 實際結果 |
| --- | --- |
| `npm ci` | 退出 0，`npm-ci.log`；無模型運行前完成 |
| 新測試修正前 | `red.log`：5/5 因工具未註冊／未允許而失敗；當時 wrapper 的 tail 退出 0，未單獨捕獲 Vitest 退出碼，因此原始 Vitest code=unavailable，不能記成成功 |
| `npx --no-install vitest run tests/contract/g-coordinator-stop.test.ts tests/contract/control-service.test.ts tests/contract/slow-tools.test.ts` | 退出 0，3 文件、55/55，含新增 9 項及原 C 停止准入競態，`targeted.log` |
| `npx --no-install tsx tests/manual/g-coordinator-stop-runtime.ts accepted` | 退出 0，三個獨立 launch 均 completed；`runtime/accepted/{foreground,http,job-wait}/` 各有 provider、events、C audit、resources、bindings、messages、stdout、result。不同 launch 不拼接為同一次驗收 |
| `npx --no-install tsx tests/manual/g-coordinator-stop-runtime.ts native-control foreground` | 退出 0，無 SDK 恢復，額外原生 SDK abort 對照成立；`runtime/native-control/foreground/`。SDK abort 僅作候選比較，實際回收仍由 Coordinator 的產品工具觸發 |
| `npm run typecheck` | 退出 0，`typecheck-final.log`（包含全部手動探針源碼） |
| `npm run build` | 退出 0，`build.log` |
| `npm test` | 退出 0，40 文件、300/300，`full.log` |

`runtime/first/`、`runtime-first.log` 是較早的兩條接線驗證，保留但不代替 accepted 的前台對照。`checks.json` 保存命令／退出碼；`resource-cleanup.json` 記錄各自 PID 的收尾檢查。未調用真實模型，stub 報告 token=0；不將該值當作真實模型 usage 或解題能力證據。

## 來源、條件與待主會話判斷

工作區：`/Users/caihaoming/.codex/worktrees/93f6/pentest-agent`，detached HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`，初始 clean。AGENTS/CLAUDE 與 docs/superpowers 來自主區當時副本；產品原型只來自 `/Users/caihaoming/.codex/worktrees/g-c-rpc-slow-tools/pentest-agent`。`source-manifest.json` 保留逐文件來源/hash；指定原型既有 final-hashes 的 20 個產品／測試條目與所複製來源全部一致，見 `prototype-hash-check.json`。版本 Node v26.3.0、npm 11.16.0、Vitest 2.1.8、OpenCode 1.19.3、SDK/plugin 1.19.0；完整 hash 見 final-hashes。

主會話需要決定的只有：**如何讓 Coordinator 在前台 task 尚未返回時，透過產品公開接口自然取得已授權 child 的控制機會／句柄。** 可另比較公開背景 task、其他並行控制或與長作業完成交回協議協同，但這涉及分派／交回契約，不能由本項默認增加。先同步本項文檔與證據即可；候選產品源碼不自動合併。無 OS／網路隔離、真實模型、D/oracle 或通用並行排程的驗證結論。
