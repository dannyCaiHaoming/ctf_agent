# G 最小版無模型驗證 plan（本轮 C／RPC 慢工具接线验证）

記錄日期：2026-10-23（Asia/Tokyo）。

**依據：** [G 最小版詳細 design](../specs/2026-10-23-design-v1-g-solver-minimal.md) 第 2、3、5.4、7.2、9 節；目標不變。本文保留既有局部驗證，修正會固化錯誤設計的判據。不是 G 正式實作 plan，也不把 D 的候選／驗證／oracle 接通納入 G 的通過條件。

**历史状态与授权（G-V4 批次）：** 用户明确授权使用 gpt-6.1-sol，在独立 managed worktree 执行 G-V4 HTTP scope、全程 timeout／取消的必要原型、测试、无模型验证及文档回写。本轮适配器定向验证已完成，主会话已核对并独立重跑定向验证 20/20 通过；结论与必要证据已同步主工作区，原型代码未合并。结论见 G-V4 与 design §4.2.1；不合并、commit/push、真实模型调用或其他 G 切片。此前 G-V1／G-V3 已完成并核对的结果保持历史结论，不重复执行。§3 产品插件／launcher／RPC 慢工具接线为独立切片，本轮只验证适配器接受宿主可信登记、AbortSignal 与 deadline 的边界替身。

## 0A. 当前授权与执行状态（C／RPC 独立切片）

用户后续明确授权本独立 worktree 完成第3节必要原型、产品接线、测试、确定性 loopback provider runtime 与文档回写，覆盖顶部及第3节“本轮不修改接线”的历史限制。以 HEAD d83a0c3 为代码基线，适用文档和旧证据从主工作区复制，来源 hash 见本轮 gates 子目录 sources.json。仅修改本工作区；不修改主区／旧worktree，不 commit／push／合并／删除工作区，无真实模型调用，不扩展到 OS 隔离或 D/oracle。保持 job.run wait_ms 契约；公开完成接线不能满足时如实记缺口。

当前结果：第3节的短串行登记、真实产品入口超过15秒、deadline/有界收尾、RPC交付竞态、停止/撤销/到期、真实C每题配额已验证并回写design §7.2.1；长job超过wait_ms的自动完成交回未通过，直接公开通知/恢复候选已实测不足，其他组合未穷尽。此处结束本轮，不扩展OS隔离或新增job.wait；历史结论与失败保留。

## 0. 此前已完成记录：G-V1 跨轮选题与分派

此前 G-V1 切片验证 G §2：`assign` 成功返回后，下一轮原生 `task` 能否可靠绑定题目。该次使用者授权以 gpt-6.1-sol 在独立 worktree 完成必要原型、测试、无模型探针及文档回写；不构成本轮重新执行 G-V1 的要求。

该次在独立工作区修改 `apps/launcher/src/control-service.ts` 的宣告／分派处理及 `tests/contract/control-service.test.ts`，复用既有 V1 探针，仅验证第 1 节判据。输入为 E 准备的本 run 题目与 C 的可信父子会话，输出为固定 challengeId 的子会话。宣告与 pending 为两种状态，语义见 design §2.1。

该次使用真实 OpenCode 1.19.3、loopback 确定性替身 provider、真实模型 token 0；历史 V1 的模型偏离仍保留原报告。结论、条件与限制已转入 G design §2.1、§9，已核对证据同步主工作区，原型代码未同步。该次完成后停止；该轮 G-V3 的后续明确授权另见顶部及第 2 节，不据此启动其他补验。

## 1. G-V1：修訂判據

| 判據 | 操作及必須觀察的結果 |
| --- | --- |
| T1 跨輪正常分派 | 第一輪 assign(recon, X) 返回成功；父會話再次准入後，第二輪 task(recon) 成功；子會話綁定 X 早於首次准入與替身請求 |
| T2 未宣告 | task(recon) 拒絕，無 pending、無子會話；不能從自由文字題號推導授權 |
| T3 重複、取消與換題 | 未消費時同題／異題重複 assign 均拒絕且原值不變；unassign 後可 assign 新題；無宣告 unassign 冪等；有 pending 時 unassign 拒絕 |
| T4 跨輪保留與終止清理 | assign 後多一次父准入仍保留；只有消費、顯式 unassign 或父會話停止／撤銷／到期才清除。舊「下一輪刪除宣告」判據撤回 |
| T5 恢復 | 合法 task_id 無宣告可恢復；同題宣告消費但不建 pending；異題宣告拒絕且保留；原會話題目不變；外來 task_id 不消費宣告 |
| T6 角色與題目邊界 | 非 Coordinator 不可 assign／unassign；run 範圍角色不可宣告；其他 run 的題目拒絕 |
| T7 同輪順序 | task 先於 assign 完成時可以拒絕，但不得錯綁或丟失稍後成功的宣告；下一輪 task 可恢復。assign 完成後 task 可成功；不以工具發起順序作前提 |
| T8 task 失敗 | 登記前拒絕不消費宣告；登記後、綁定前失敗，下一輪只清 pending，不恢復宣告；重新 assign 後能成功 |
| T9 停止競態 | assign／分派核實的異步等待期間停止，返回後不得新建宣告、pending 或有效綁定 |

先以可控 Promise／替身測試 T1–T9，不用睡眠猜競態；再在真實 OpenCode 中驗證 T1、T5、T7、T8 的跨輪行為及首次綁定時序。缺少 runtime 可控注入時記為未驗證，不能以單元結果替代。

通過條件：定向測試與 typecheck 成功；runtime 證據能對應各項 session／call／事件順序；沒有真實 provider 請求。任一必要項失敗則 G-V1 仍未通過，不回退到要求同輪 hook 有序。產品插件正式接線仍另驗。

### 此前 G-V1 执行结果（历史记录）

- 獨立工作區 `/Users/caihaoming/.codex/worktrees/g-v1-cross-round/pentest-agent`，HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`（detached，未提交）。適用文檔從主工作區逐字節複製並記 hash，不用舊 HEAD 的 G 文檔。
- T1–T9 的 14 個可控 Promise／SDK 替身回歸通過；runtime T1、T5、T7 early/late、T8 登記前/後失敗均通過。T2/T3/T4/T6/T9 沒有 runtime 驗證，不以單元結果冒稱。
- OpenCode 1.19.3、SDK/plugin 1.19.0；只有 loopback stub provider，真實模型 token 預算／消耗 0。綁定早於首次准入與替身請求；T7/T8 為 RPC 邊界可控注入，非原生內部任意失敗驗證。
- 首次 T5 因沿用 12 次替身准入上限而失敗；保留整次失敗，改為腳本長度+10後原腳本/斷言在 T5-2 完整通過。首次全套 6 項 launcher fixture 失敗也保留；僅補 G 宣告前置條件，最終全套 237/237，typecheck/build/探針類型檢查通過。
- 證據及全部限制：[cross-round-v1/REPORT.md](../../gates/g-solver-verification-20261023/cross-round-v1/REPORT.md)。舊 A/B 證據按原內容收錄到其 historical/，未改寫原工作區。正式 G 插件/launcher 接線與工作目錄創建不在本輪通過範圍。

## 2. 既有結論與其他局部判據修訂

### G-V2：保留受管作業方向

保留 `@opencode-ai/plugin` 1.19.0 類型檢查、目標 OpenCode 1.19.3 的結論與限制。報告在主工作區 `docs/gates/g-solver-verification-20261023/G-V2-native-shell.md`。無新接口證據不重跑，不把類型檢查稱為實際執行隔離。

### G-V3：三根映射

原型／測試：`apps/launcher/src/workspace-tools.ts`、`tests/contract/workspace-tools.test.ts`，位於 `claude/g-v3-workspace-tools-32ad90`。

- 接口採 design §3.1 的 `WorkspaceRoots`，不能再接受一個共同父目錄推導三根。模型仍只傳虛擬路徑，不傳身份。
- 保留舊九項：非法路徑、符號連結、materials／published 拒寫、UTF-8 分頁、字面搜尋、列表截斷、單次寫入上限等；相關接口改動後定向回歸。
- 補真實佈局：用 E 的 `prepareRun` 產生 materials，為同題建立兩個 work；兩會話能讀同份材料與宿主發布檔，各自寫讀 work；list／search 不出現他會話 work，改寫 materials／published 被拒且 hash 不變。
- 外部、共同父目錄、另一會話路徑與符號連結全部拒絕，正向讀寫也必須成功。不得改 fixture 佈局以避開真實映射問題。
- 128 MiB 配額仍未實作，0444 僅為防誤寫；兩者不由本次局部測試冒稱成立。E 的既有讀取語義保持不變，共用讀取實作屬後續正式實作。

### 此前 G-V3 执行结果（2026-10-23 历史记录）

用户后续明确授权仅执行 G-V3 三根切片，覆盖前述未授权状态。独立 managed worktree `/Users/caihaoming/.codex/worktrees/g-v3-three-roots/pentest-agent`；已完成必要原型和真实 prepareRun 双会话测试，旧九项保留，定向10/10、typecheck/build、全套233/233通过。两次失败均留存，结论已回写 G design §3.1/3.2/9。证据见 [G-V3 三根补验报告](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md)。缺失的是旧单根 G-V3 完整报告，本轮新报告已保存；不改写历史结果。没有启动其他切片、产品接线、模型调用、commit/push 或合并。本 plan 仍承载未执行其他判据，保留。

### G-V4：HTTP

原型／測試：`apps/launcher/src/http-tools.ts`、`tests/contract/http-tools.test.ts`，位於 `claude/g-v4-http-tools-555451`。

保留原九項的 scope、逐跳重定向、cookie、header、輸出上限、代理與自簽 TLS 結果。補驗：

- 解析器被 Promise 屏障卡住時觸發 timeout／取消，釋放後授權及越界服務收到的連線均為零；連線、重定向、body 讀取期間取消也終止，釋放請求名額。
- 核對解析結果是否真正固定到 socket；地址 A 核實後即使 DNS 改成 B 也不得連到 B。若實作只有一次解析，不能為覆蓋不可達「不一致分支」而虛構第二次解析；以實際目的地址和越界零連線證明邊界。
- 取消按 session／run 隔離；已停止會話不得新建請求。對接第 3 節的登記、信號與時限，不另設一套控制機制。

### G-V4 本轮执行结果（2026-10-23）

独立 managed worktree `/Users/caihaoming/.codex/worktrees/g-v4-http-lifecycle/pentest-agent`。旧原型九项保留并重新通过；新增 DNS timeout 原失败先复现（超时后释放 DNS 仍连接 1 次），修订后全程 deadline／AbortSignal 及生命周期定向 20/20、typecheck／build 与全套 243/243 通过（最终含落盘阻塞两项回归，先失败后修复）。取消覆盖 DNS、TLS 连接握手、重定向与 body；真实 socket 固定 A=`127.0.0.1`，DNS 后变 B=`::1` 仍 B 0 连接、只解析一次。停止 session／run 隔离、拒绝停止后新登记、替身登记表 8 名额保存终态后释放，以及落盘收尾超过 1000ms 返回 cleanup_unknown 并保留未知名额，均以明确 `HostBoundary` 测试替身验证。该替身没有 challengeId，未验证每题配额分组或跨题独立配额；设计的每题 8 名额目标保持不变。

必要局部接口已写回 design §4.2.1；真实 C／产品插件／launcher／RPC 接线、绑定到期与 RPC 客户端放弃不在本轮，§3 保持待独立切片。旧 G-V4 完整报告未找到，保留旧结论与原型/hash；所有本轮失败、修正与最终日志见 [本轮报告](../../gates/g-solver-verification-20261023/g-v4-http-lifecycle/REPORT.md)。验证执行期间未修改主／旧工作区；随后经主会话核对，仅将文档与必要证据同步主工作区。无合并、commit/push、真实模型或其他切片。

### G-V5：作業

原型／測試：`apps/launcher/src/job-tools.ts`、`tests/contract/job-tools.test.ts`，位於 `claude/g-v5-job-tools-b426e6`。

保留原九項及程序組變異檢查：環境白名單、空 stdin、超時／取消殺孫程序、分頁、截斷、啟動失敗、並行限制、句柄隔離。補驗：

- 宿主按 session 取消全部作業，其他會話不受影響；run 停止取消全部。輸出保留，名額在回收結算後釋放。
- 在登記／啟動交界觸發停止，不遺留未登記進程；啟動失敗、取消與正常退出競態不重複釋放名額。
- 回收失敗／超時記為 unknown 或不完整，不記為已清空；測試核實孫程序，不僅檢查 leader。
- 第 3 節核實慢工具接線；OS 隔離與資源限制仍依第 4 節，白名單不能代替它們。

## 3. G 與 C 的無模型接線判據（本轮部分通过，自动完成交回未通过）

依 design §7.2；涉及 `control-service.ts`、`control-rpc.ts`、產品插件 `src/index.ts` 與 `launch.ts`。历史初版曾限制“本轮不修改这些文件”；后续用户明确授权已由 §0A 覆盖。本轮必要接线仅在独立工作区完成，不合并主区。

- 身份／配額／資源登記保持短暫串行；卡住一筆 HTTP 或 job 等待時，另一會話的准入與停止仍能完成，釋放慢操作屏障前即可觀察結果。
- 用真實產品插件、控制服務、launcher 與替身 provider 驗證：合法等待超過舊 15 秒仍返回結果；工具執行不超過自己的 deadline，收尾餘量不增加工具執行時間。單元層用假時鐘，runtime 用有界實際等待。
- RPC 放棄與作業交付句柄競態、run 停止、單會話撤銷都不遺留未登記資源，不自動重發；句柄與失敗／未知結果可追溯到同一 session/call。
- 核實公開 OpenCode 能否支持 design §7.2 的長作業有界等待或完成通知。作業超過初始 wait_ms 仍可把完成結果交回等待任務，等待期間沒有靠反覆模型請求輪詢；輸出可增量讀取、停止可取消。記錄實際版本與接口；都不可行時回寫缺口，不能自建 provider 循環或把該判據刪除。
- 正式接線後應使用同一產品入口驗證綁定→文件讀寫→HTTP／job→輸出→停止；不要求 D 的候選／oracle 已實作，不用 scratch 插件冒充產品接線。

### 第3节本轮执行结果

同一次产品入口 runtime/accepted 使用真实 OpenCode1.19.3、产品entry插件、launcher和C，HTTP16004ms、job16054ms，12条loopback替身请求对应12次准入；私有Symbol关联、同轮并发双写、三根读写、增量输出、最后running作业停止均通过。短串行与停止/交付/unknown/每题配额另有确定性边界测试，fake-clock与有界实际等待分层记录。所有原始失败保留，完整证据见 [本轮报告](../../gates/g-solver-verification-20261023/g-c-rpc-slow-tools/REPORT.md)。

**未通过的原判据仍保留：** job超出初始wait_ms后，当前实现不会自动把完成结果交回原等待任务；completion-probe/first已实际调用公开event.subscribe/session.promptAsync：同child恢复、相同messageID去重和取消对照成立，但原native task早于job完成返回，恢复后原task输出不更新。该直接通知路径在现有契约下不足，其他公开组合未穷尽，不能断言OpenCode整体不支持。未改job.run契约或新增job.wait。第3节不按整体通过收口，G-V6/V7未执行；不启动下一项。

## 4. G-V6：隔離判據修訂（未執行）

依 design §5.4，在 ARM64 產品執行環境使用非秘密哨兵；先核實候選 (a)，不足再核實 (b)。具體執行 plan 待環境與候選可行路徑明確後形成，不在本輪啟動容器或安裝依賴。

必須同時覆蓋：

1. 作業能讀本題 materials／published，能寫本會話 work；不能改前兩者，失敗後 hash 不變。
2. 同題另一會話的 work、進程環境／記憶體不可讀，不能改文件或發信號；其他題目的材料與 work 也不可訪問。測試正向訪問，避免因全部不可用而假通過。
3. 控制服務、OpenCode 憑據哨兵與 oracle 哨兵不可讀；不只測 env 輸出。
4. 宿主可寫入發布產物、讀輸出、取消整個作業；CPU／記憶體限制實際觸發並保留結果。
5. 記錄 uid／gid、掛載、進程隔離及需要的權限；符合非 root 產品約束，不向作業暴露 Docker socket。不能以默認特權運行掩蓋衝突。

通過才能選定相應方案；都不滿足則記錄阻塞，不能回退單一作業用戶並降低邊界。網路隔離仍是總設計獨立待決項，不能由這組文件／進程測試宣稱成立。G-V7 真實模型冒煙不在本 plan 授權中。

## 5. 證據與收口

- V1 原始報告在 `.claude/worktrees/e-intake-tools-0168da/docs/gates/g-solver-verification-20261023/`；保留舊 A 失敗、B 特定順序通過及版本。不要改寫歷史報告以匹配新結論。
- 旧 V3–V5 的局部數字已寫入 design，但旧 gate 完整報告未找到，標記待核對收錄；不补造历史日志。本轮 G-V3 三根补验已执行，新报告与失败/最终日志在 [g-v3-three-roots](../../gates/g-solver-verification-20261023/g-v3-three-roots/REPORT.md)，不属于缺失报告。本轮 G-V4 已补验并保留新证据，旧 G-V4 历史报告缺失仍单独保留；V5 本轮未重验。
- 後續每個補驗只記錄受影響判據、版本、條件、失敗和最小證據；放既有 gate 目錄，不新建成套報告框架。執行授權允許時先核對／收錄已有證據，無法找回就明示缺失。
- 無模型檢查依影響範圍使用定向測試、typecheck；正式產品代碼變更仍遵守倉庫既有 build／test 要求。此文檔修訂不觸發產品測試。
- 不 commit、push、合併或刪除既有工作區。原 plan「各工作區只提交自己的分支」與禁 commit 衝突的文字已撤回。
- 所有必要結論轉入 design／gates、待辦不再需要本文承載時才刪除 plan；当前 G-V1 修订、G-V3 三根补验及 G-V4 HTTP 生命周期结论已转入 design；其余未执行修订判据仍待验，保留本文。同步 README 與總設計狀態，不把部分原型通過寫成 G 定稿。
