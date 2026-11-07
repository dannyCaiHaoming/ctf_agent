# a5 E2 生命週期分析：root `stop` 後為何沒收束

工程模式：只讀排查。證據為 `runs/alibaba-easy-20261107-a5/runs/E2/alibaba-a5-ezoj-2/` 的 `state/run.json`、`progress.jsonl`、`evidence/control-audit.json`、`evidence/task-executions.json`，只取結構化欄位（op／role／時間戳／status），未讀 messages 正文。時間為距 run 起點的秒數（`elapsedMs/1000`）。

## 結論摘要

1. **settle 沒走是正確的**：root 回合 `stop` 的同時，最後一個 background task（domain-solver resume）還在跑，`hasOutstandingWork` 為 true。run 並非卡死，而是 deadline（1800s）前這個 task 只跑了約 86s 就被 `stopAll('deadline')` 取消。
2. **engineer 從未被派出**：整個 run 的 coordinator `task` 調用只有 intake／recon／domain-solver／reference／recovery-critic，沒有 `ControlDenied` 擋住 engineer，是 Coordinator 自己沒選。
3. **兩者並存**：收束規則本身沒缺口；缺口在 Coordinator 的分派決策與其可見狀態（見下）。

## 問題 1：settle 條件逐條對照（`launch.ts:330-355`、`root-result.ts:44`、`control-service.ts:206`）

| 條件 | 取值 | 依據 |
| --- | --- | --- |
| root session `idle` | 成立（觀察點為最後一個 root 回合之後） | `run.json.rootResult` |
| `canSettleRoot`：有 assistant、`completed`、`finish !== 'tool-calls'` | **成立** | `rootResult.finish="stop"`、`completed=true`、`completeness="complete"`、`reason="stop"`；assistant created→completed 約 1716s |
| 非 length 續跑分支 | 不適用 | `finish` 不是 `length`；`rootContinuations=1`（691s 一次，已完成） |
| `!hasOutstandingWork(statuses)` | **不成立** | `task-executions.json` 唯一未完成項 `ref=4762631a`、role=domain-solver、`mode=background`、`callID` 為 1714s 的 `task` 調用，最終 `state=cancelled`、`delivery=suppressed`（deadline 取消）；符合 `hasOutstandingWork` 的 `state==='running'／!delivered` 條件 |
| 連兩次 idle（`idleSeen>=2`） | 未累積 | `canSettleRoot && !outstanding` 為 false，每輪 `idleSeen` 歸 0 |

root 的最後回合是在 1714s 發出 background `task`（domain-solver resume）之後結束的；子 task 在 1800s 被 `stop_marked{reason:"deadline"}` 中止，`progress.jsonl` 此後沒有 `task.completion`、`root_idle`。`run.json.timeline` 也只有 `deadline`，沒有 `root_idle`。

## 問題 2：Coordinator 分派時間線

| 秒 | coordinator 回合後的動作 | child 交回（`task.delivered`） |
| --- | --- | --- |
| 5 | intake（task） | 約 9s（intake 5 次 model.call，已完成） |
| 23／30 | assign ezoj → recon | 127 |
| 139／145 | assign → recon resume | 184 |
| 191／201 | assign → domain-solver | 538 |
| 545／549 | assign → domain-solver resume | 634 |
| 696／700 | reference（task）＋ 705 domain-solver resume；root.continuation 在 691 | reference：762／770；domain-solver：**1560**（單回合約 13 分鐘，期間 coordinator 無 model.call） |
| 1600／1605 | assign → recovery-critic；1615 domain-solver resume | domain-solver 1668；recovery-critic 1684／1696 |
| 1711／1714 | `progress.note`（route=`redirect`）→ assign → domain-solver resume（背景） | **未交回**，1800s deadline 取消 |

Coordinator 每次看到的狀態：
- `control-audit.json` 共 12 筆 `allow:false`，全是 `tool.before／tool.execute` 的路徑類拒絕（`read path` 10、`material path` 1、`scope` 1）：發生在 intake、coordinator（20s、21s 的 `read`）與後續各角色的 `read`，**沒有任何 engineer 分派被拒**，也沒有 budget／deadline／job 類拒絕。
- `ctf_progress_read` 的輸出含 `completion.budget`：`admittedModelCalls`、`observedTokens`、`deadline`（絕對時間）、`stopped`；沒有各角色預算，也沒有 engineer 可用性提示（`control-service.ts:963-967`）。預算全程寬鬆（`maxSteps/maxToolJobs=100000`，`maxObservableTokens=3000000`，`stopReason` 僅為最終 `deadline`）。
- 回合分佈與 a5 報告一致：coordinator 35、domain-solver 58（其中 `ctf_http_request` 115 次 tool.before、`ctf_job_run` 13）、recovery-critic 8、reference 6、recon 11、intake 5、engineer 0。

## 問題 3：harness 缺口還是模型選擇

| 面向 | 判斷 | 依據欄位 |
| --- | --- | --- |
| 收束規則 | **不是缺口** | `hasOutstandingWork` 命中 `4762631a`（`state`、`delivery`）；run 並未卡死 |
| 預算 | **不是缺口** | `budget.*` 未觸及，`stopReason` 只有 deadline |
| 準入／拒絕 | **不是缺口** | `control-audit.json` 無 engineer 相關 `allow:false` |
| 狀態可見性 | **輕微缺口** | `progress.read` 只給絕對 `deadline`，不給剩餘時間、各角色已用回合、「已派過／未派過」角色，也沒有 domain-solver 單回合 13 分鐘的耗時；Coordinator 無法據此判斷何時該轉派 engineer。 |
| 分派選擇 | **主要是模型選擇** | 7 次 `dispatch.resume` 中 4 次為 domain-solver；全 run `task` 調用角色集合不含 engineer；recovery-critic 的 `redirect` 後仍續派同一個 domain-solver |

另有兩點需要留意：1560s 那回合 domain-solver 沒有時間上限，使 coordinator 約 13 分鐘無法介入；最後一回合在 1714s 才續派，離 deadline 只剩 86s，沒有餘裕。

## 最小修正方向（不實作）

在 `progress.read` 的 `completion.budget` 加剩餘時間與「各角色已派次數／最近一次派出時間」；並可考慮在 domain-solver 單回合超過某個時間門檻（如 deadline 的 1/3）時把它交回 coordinator。這兩者都只是增加 Coordinator 的決策依據，不改收束規則。
