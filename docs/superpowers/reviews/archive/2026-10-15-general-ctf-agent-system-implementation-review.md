> 📝 **评审对象：** [`../../plans/archive/2026-10-15-general-ctf-agent-system-implementation.md`](../../plans/archive/2026-10-15-general-ctf-agent-system-implementation.md)（已废弃的单体计划）。

# 通用 CTF Agent 實施計畫審計

> **最新結論（2026-10-15 第三輪）：Changes requested。** 最新計畫仍有 2 項 P1、5 項 P2，詳見第 12–16 節。第 1–6 節及第 7–11 節分別保留首輪、第二輪審計及各自的行號基準。

首輪審計日期：2026-10-15

首輪審計結論：**Changes requested——主架構方向符合已確認設計，但尚不適合按現有順序直接逐項執行。**

## 1. 範圍與證據基準

- **P／被審計計畫：** [`2026-10-15-general-ctf-agent-system-implementation.md`](../../plans/archive/2026-10-15-general-ctf-agent-system-implementation.md)，共 1,363 行、33 個任務標題，包含 Task 26A–26C。
- **S／現行設計基準：** [`2026-10-14-general-ctf-agent-system-design.md`](../../specs/2026-10-14-general-ctf-agent-system-design.md)，2026-10-15 修訂，共 992 行。
- 下文 `P:884–915`、`S:244–251` 均指上述檔案的行號。行號適用於本次記錄的版本。
- S:8 指定該設計為唯一現行依據；舊設計與歷史 review 未被當作額外需求。S:976 的「本輪只改設計」是歷史工作範圍，不覆蓋使用者之後建立、審計實施計畫的指示。
- 本次為文件與可執行性審計：檢查需求映射、任務順序、跨任務介面、測試判定及 Gate 前置條件。未建置產品、未啟動模型解題、未呼叫真實平台 API。
- **本輪交付只新增此 review；未修改計畫、設計或應用程式碼。**

### 原檔版本識別

以 `git hash-object` 記錄的 Git blob object ID：

| 文件 | 審計基準 object ID |
| --- | --- |
| P | `a2ab257b265179f108c0ea4731f5d69bb89ce07e` |
| S | `cd01985d70b1b57cac511e9801255f821d7a8555` |

這些是工作樹檔案的內容識別，不代表檔案已 commit，也不是測試通過證據。

## 2. 摘要

發現 **13 項問題：7 項 P1、6 項 P2**。未發現需要推翻 host-first、OpenCode 復用或單一 canonical state 的理由。

- **P1：** 可能阻斷既定實施流程，或使必要的執行／權限／驗證 Gate 錯誤放行；須在相關任務或 live Gate 開始前解決。
- **P2：** 規格落地、依賴或測試精度不足；應在交付相應能力前補齊。
- 「計畫未指定」不等於「已存在可利用的產品漏洞」。除 R03 的斷言邏輯外，多數發現是尚未實作前的缺口與可構造失敗情境。

| ID | 等級 | 問題 | 主要任務 |
| --- | --- | --- | --- |
| R01 | P1 | task A 已開始計時，才實作其後續 Scheduler | 19–21 |
| R02 | P1 | 共享預算實作延後到 M3，M0/M1/M2 缺少完整強制契約 | 4、5、7、11、18、20 |
| R03 | P1 | 工具禁用測試會放行僅暴露 `bash` 的配置 | 5 |
| R04 | P1 | 未落實題目內 `.opencode` 只作資料的配置載入邊界 | 5、6、12 |
| R05 | P1 | Host fail-stop 未指定 Supervisor 崩潰後仍存活的執行責任者 | 6、11、12、21 |
| R06 | P1 | Core egress 缺少「本題硬限額端點只供受管通道」的規則與反向測試 | 7、23、24 |
| R07 | P1 | Candidate 流程未將提交當下有效性與不可 replay 條件落成強制 Gate | 7、9、16 |
| R08 | P2 | 度量採集落到 M6，早期真實軌跡可能缺少不可回補的原始事件 | 3、6、11、18、30 |
| R09 | P2 | Dev/live 保守計時 fallback 與 formal 時間證據規則未分開落地 | 9、19 |
| R10 | P2 | Bootstrap 的測試與 lockfile 產生順序無法按字面執行 | 1 與後續新增 workspace 任務 |
| R11 | P2 | 關鍵跨任務契約與前向依賴未閉合 | 2–5、9、13、23 |
| R12 | P2 | M1 的 2/3 統計規則清楚，但各軌跡成功判定仍過於抽象 | 13–18 |
| R13 | P2 | Formal invalid／人工介入的強制處置沒有完整任務與自動化判定 | 11、26B、30、31 |

### 已正確保留的設計

以下部分應保留，而不是因本次 review 重新設計：

- Host M0–M3 通過後才建置 Core，M4 使用獨立 task B。
- M5 依 capability 分軌，不要求不相關平台、VPN、noVNC 全部完成才可跑 TSecBench formal。
- 三級 effect、局部 unknown、即時 observation 與 immutable evidence 分離。
- Same-Solver 局部修復、可反證 hypothesis、long-job continuation、compaction 回取原始資料。
- Candidate path 強制 Engineering／獨立 Verification，沒有候選的題目不強迫派完整角色流水線。
- 權威接受、multi-flag 完成條件、正式分母及 `60% / 30% / 45%` 門檻。
- 外部 task、模型配置、原生 ARM64 環境列為 Gate 輸入，未宣稱 fixture 已證明真實成績。

## 3. 詳細發現

### R01 — P1：M2 的實際計時先於 M3 必要程式的開發

**計畫證據：** P:884–915、P:929–939、P:970–998。

**設計依據：** S:244–251、S:792–804、S:917–923。

Task 19 先對 task A 執行 First List 並取得真實 accepted；Task 20 明確依賴 Task 19，才開始建立 Scheduler、portfolio、budgets、instance slots 與 cleanup。Task 21 又要求同一個「仍有效」的 task A，不可 reset，deadline 不可移動。

**失敗情境：** 執行者依序完成 Task 19 後停下來寫 Task 20、測試、審查與修錯，平台時間仍持續消耗。等到 Task 21 時 task A 可能已過期。`--resume` 不能暫停或重置遠端計時，故此依賴順序把能否完成 M3 綁在開發速度上。

**建議：** 將 M2/M3 的程式與 deterministic fixtures 完成、驗證及固定版本後，才首次啟動 task A；M2 保留為同一場 live 軌跡中的中途驗收點，隨後直接進入 M3。可保留「先做單題能力，再做多題能力」的開發順序，但不能把 M3 程式開發放在 task A 計時窗口內。

**修訂後驗收：**
- [ ] First List 前，執行中的版本已包含 Scheduler、instance slots、cleanup 和 recovery fixture。
- [ ] M2/M3 共用一個已固定版本及完整 run 軌跡，中間不等待新增產品能力。
- [ ] task A 過期時如實記錄 Gate 失敗／阻塞，不延長 deadline、不拼接其他 run。

### R02 — P1：固定預算缺少 M0–M2 的實際強制點

**計畫證據：** P:35–42、P:223–259、P:354–390、P:525–565、P:868–876、P:929–958。

**設計依據：** S:179–189、S:454、S:483、S:631–639、S:692–694、S:802。

Task 7 有 remote-unit 預留，Task 11 有 deadline，但完整 `budgets.ts` 到 Task 20 才建立。早於它的 M1 已要求固定 token／tool 預算，M2 也已進入真實任務。Task 4/5 沒有指定模型請求前的共享預算預留、retry／compaction／subagent 消耗歸戶或用量結算介面。

**失敗情境：** 多個 session 同時看到足夠剩餘 token 並各自派工；或模型 retry、summary、compaction 沒有計入原 run budget。此時「相同設定跑三次」不代表相同受控預算，且單題 live 也能在 Scheduler 出現前超額。

**建議：** 將共享預算帳本與 dispatch gate 放入 M0，由 Supervisor／Gateway／Platform 共用；Task 20 只消費既有帳本作 portfolio 決策。定義 reservation、settlement、取消及 unknown 消耗規則，分別保留 token、tool time、submission、Hint、instance、remote-unit 維度。

**修訂後驗收：**
- [ ] 兩個 session 競爭最後一份額度時，最多一個請求被 dispatch。
- [ ] Retry、summary、compaction、subagent 的模型用量都歸入原 run，超額前停止新工作並 checkpoint。
- [ ] 恢復不重置消耗；unknown protected effect 不釋放硬限額預留。
- [ ] M1 開跑前已有實際預算 enforcement 測試，不能只檢查配置欄位。

### R03 — P1：工具禁用斷言只排除「三個工具同時存在」

**計畫證據：** P:286–288。

**設計依據：** S:180–182、S:833。

計畫中的測試是：

```ts
expect(await exposedTools("ctf-worker"))
  .not.toEqual(expect.arrayContaining(["bash", "write", "edit"]));
```

`arrayContaining` 表示包含全部指定元素。對它取反，只能證明三者不是全部存在，不能證明任一禁用工具都不存在。

| 暴露工具 | 目前斷言 | 應有結果 |
| --- | --- | --- |
| `[]` | 通過 | 通過 |
| `["bash"]` | 通過 | 拒絕 |
| `["write"]` | 通過 | 拒絕 |
| `["edit"]` | 通過 | 拒絕 |
| `["bash", "write"]` | 通過 | 拒絕 |
| `["bash", "write", "edit"]` | 拒絕 | 拒絕 |

上表已以 `!denied.every(t => tools.includes(t))` 與正確的逐項排除語義做本地運算核對；這不是聲稱已執行尚不存在的 Vitest 產品測試。

**建議：** 對每個禁止工具逐項 `not.toContain`，並以允許清單限制所有可見工具；除了工具列表，也要測試實際執行請求被拒絕。

**修訂後驗收：**
- [ ] 單獨注入 `bash`、`write` 或 `edit` 的任一配置均使 contract test 失敗。
- [ ] 未受管的讀檔、網路或 delegation 工具也不得成為 workspace/scope/identity 的旁路。
- [ ] 即使工具定義被錯誤暴露，server-side policy 仍拒絕違規呼叫。

### R04 — P1：OpenCode 的可信配置來源沒有被固定

**計畫證據：** P:265–305、P:311–342。

**設計依據：** S:179–193，尤其 S:180「題目內 `.opencode` 只作資料」。

Task 5 建立 repo 根的 `opencode.jsonc` 與 `.opencode/agents/ctf-*.md`，Task 6 處理 workspace 路徑與 symlink；但沒有指定 OpenCode server/session 從何處載入配置、如何隔離使用者全域配置及題目 workspace 的 `.opencode`、plugin、agent 或其他擴充來源。只保護 `workspace.read/patch` 不能約束 OpenCode 自己的配置發現流程。

**失敗情境：** 題目資料夾附有 OpenCode 配置或同名 agent 定義；若 server 把它當工作專案並載入，就可能在受管工具授權之前改寫工具／provider／agent 設定。是否實際可發生須由固定版 OpenCode 的 contract probe 驗證，不能僅靠 prompt 承諾。

**建議：** 在 Task 5 明確固定可信 config root、server 啟動環境及 challenge directory 的資料地位，並把配置來源隔離加入 public-interface 可行性 probe。必要公開接口做不到時，使用原有 `blocked_opencode_contract` 分支。

**修訂後驗收：**
- [ ] 在題目 workspace 放入 `.opencode`、agent/plugin/config 測試哨兵，不得執行哨兵或改變工具/provider。
- [ ] 全域配置中的額外工具、provider 及其他 agent 不會意外進入產品 session。
- [ ] 主 session、subagent 和 session reconstruction 都受同一配置來源限制。

### R05 — P1：Host fail-stop 的存活控制者未指定

**計畫證據：** P:315–342、P:525–565、P:990–992。

**設計依據：** S:162–163、S:668–686、S:843–844。

Task 11 將 recovery/fail-stop 放入 Supervisor package，寫出「On crash stop dispatch/effects, TERM/KILL ...」，但沒有指定當 Supervisor 本身被 `SIGKILL` 或 Runtime 異常退出後，由哪個仍存活的 host launcher 執行這些操作。現有測試例只檢查 restart/deadline 與「無法證明子程序停止」，不能證明 Supervisor 死亡時真的有人負責收尾。

**失敗情境：** Supervisor 終止後，已派出的 PTY、長計算或 Browser 子程序仍活著；若只靠 Supervisor 的 exception handler 或 `finally`，它們不會在 `SIGKILL` 後執行。即使下次 resume 能阻止新 owner，舊執行在此期間仍可能持續消耗資源或改變遠端狀態。

**建議：** 指定最小、獨立於被監督程序的 launcher/process-tree owner 及其檔案、啟動拓樸、狀態記錄與退出策略。這是基本 fail-stop，不需要引入設計已排除的存活 executor adoption 或高階 fencing protocol。

**修訂後驗收：**
- [ ] Integration test 真正從外部 kill Supervisor 及 Runtime，不只是讓函數 throw。
- [ ] 測試確認登記的 process groups、Browser、channel 已停止／關閉，再允許新 incarnation。
- [ ] 無法證明停止時不續跑；測試覆蓋 launcher 自身失敗後的保守恢復。

### R06 — P1：Core 的本題 allowlist 不等於硬限額非繞過性

**計畫證據：** P:354–390、P:1059–1088、P:1112–1122。

**設計依據：** S:573–588、S:757–758、S:840–842。

Task 23 的否定測試覆蓋 public、provider、platform、other-challenge targets，實作要求 Tool job/Browser 可以訪問「自己的 current grants」。缺少的重要情形是：**端點確實屬於本題，但它是有硬 query/connection 上限的 oracle，只有受管 broker/transport 可以直連。**

**失敗情境：** 防火牆正確封鎖其他題目與公共網路，但普通 job 仍能直接連本題 oracle。`metering.ts` 完全正確，raw `curl`／socket／Browser 仍能繞過帳本。因此目前列出的 egress matrix 全過，也不能支持硬限額 capability 宣稱。

**建議：** 區分一般 target grant 與 broker-only metered grant，將 transport/service principal 納入授權。將 broker-only 正向通路與 raw 同端點拒絕測試放入 M4，而不是延至 M5。

**修訂後驗收：**
- [ ] 同一 oracle 對普通 job/Browser 不可達，對授權 managed transport 可達。
- [ ] 超額在 bytes 送出前被拒絕；unknown 不重發、不釋放額度、不以新連線逃避計數。
- [ ] grant 撤銷、generation 改變與 Core 重啟後，舊通路不再可用。
- [ ] Host broker fixture 另證明 raw endpoint 確實不可達，不能只以「使用了 broker API」作為證據。

### R07 — P1：候選驗證到真正提交之間仍缺強制有效性契約

**計畫證據：** P:439–448、P:739–775、P:781–811。

**設計依據：** S:367–382、S:469、S:838–839。

Task 16 有 verification mode、generation、`validUntil` 綁定，以及 gap/platform-rejected 的範例；但沒有把下列規則指定為提交／驗證的實際 gate：

1. Submit 在真正 dispatch 當下仍須 current verified、generation 有效，且沒有受影響 unknown effect。
2. 一次性／硬限額證據不得為了 replay 重開隨機連線、reset instance 或再消耗 oracle。
3. Engineer publish 失敗必須保持 unverified；Verifier rejected/inconclusive/stale 的不同 continuation 不能僅以「回到某個 deterministic branch」帶過。

**失敗情境：** 候選在入隊時 verified，等待 dispatch 期間 instance 重啟或 verification 到期，Platform Service 仍執行舊 intent。另一情境是 Verifier 選擇 replay，消耗一次性 oracle；候選驗證本身改變了原本應保留的遠端狀態。

**建議：** 定義 `proposeSubmission` 與 Platform dispatch 的有效性檢查位置、candidate revision/operation identity，以及 mutation lease 的串行範圍。將三種 verification mode 和四種失敗分支展開成可執行的狀態／權限測試。

**修訂後驗收：**
- [ ] 入隊後到期、generation 改變或產生相關 unknown effect 時，實際 Submit bytes 為零；其他題仍可繼續。
- [ ] 重複 intent 不產生第二次 Submit，同 ID 不同 payload 被拒絕。
- [ ] Replay/recompute/evidence-audit 分別測試；one-shot fixture 中 Verifier 不可新建連線、reset 或額外 query。
- [ ] Publish error、Verifier rejected/inconclusive/stale 均有精確狀態、owner、next action；缺 immutable solution/evidence 絕不提交。

### R08 — P2：M6 才建立 metrics，早期資料可能已不可回補

**計畫證據：** P:176–217、P:311–348、P:821–876、P:1270–1310。

**設計依據：** S:886–899。

Task 18 要報告模型、工具、wall cost，但 `metrics.ts` 在 Task 30 才新增，且依賴 M4。前面的 State event 與 Runtime 尚未固定 request usage、observation 可見延遲、artifact publish 等待、hash/I/O bytes、blocker 起迄及 recovery 重算時間的事件欄位或採集點。

**影響：** 完整保存模型對話與 artifact 也無法事後準確重建「第一段輸出何時可見」或「artifact 封存等待多久」。若要補測，可能必須重跑已消耗的 live task，與原軌跡結果不再相同。

**建議：** 把採集 schema／clock source／correlation IDs 與 Runtime、Gateway、Supervisor 一起實作；Task 30 保留彙總、評分和匯出責任。

**修訂後驗收：**
- [ ] M1 前已有對 S:890–897 每類指標的來源事件及 producer。
- [ ] Fake clock／確定性 fixture 可計算預期延遲、成本和重算時間。
- [ ] Task 30 只讀既有 canonical 資料即可產生報告，不依賴補跑原任務。

### R09 — P2：Dev/live fallback 與 formal 時間證據規則未分開落地

**計畫證據：** P:439–477、P:899–907。

**設計依據：** S:238、S:244–247、S:859–861。

設計明確區分：formal 必須有可信任務時間證據；只有本地 start anchor 時允許保守 deadline 的 dev/live，只是不能宣稱正式計時。Task 9 的 admission 任務未指定這兩條分支及測試，Task 19 唯一直接測缺失時間證據的例子則是 `validateM2Input` 拒絕。

**影響：** M2 Gate 可以要求比一般 live 模式更完整的輸入，該測試本身不是設計違反；缺口是產品層沒有明確的 mode-specific contract。若執行者把這個 Gate validator 直接共用到所有 `prepare/start`，會封鎖原先允許的 live fallback；若反向放寬，又可能讓 formal 使用本地時間冒充可信計時。

**建議：** 明確區分 admission mode 與 Gate input policy；formal 的缺證據必須拒絕，dev/live 的保守 fallback 是否可供 M2 使用則寫成顯式決策，不能由測試名稱暗改產品行為。

**修訂後驗收：**
- [ ] Formal 無可信時間證據時，在 First List 前拒絕。
- [ ] Dev/live 只有本地 anchor 時可走設計允許的保守路徑，報告不產生 formal timing 聲明。
- [ ] 若 M2 額外要求任務頁證據，錯誤清楚表示「Gate 輸入不足」，不是所有 live run 都不可用。

### R10 — P2：Task 1 缺少能先跑起測試及產生 lockfile 的 bootstrap 步驟

**計畫證據：** P:90–128，以及後續新增 package 的 Tasks 2–6。

**設計依據：** S:130–132、S:743、S:986。

Task 1 在建立 `package.json`／Vitest workspace 前先執行 `npm test`，其失敗會是找不到專案或 test script，而不是產品行為的 red test。另有「`npm ci` 是唯一 CI/install command」的限制，但 `npm ci` 不能生成初始 lockfile，也不能更新後續新增 workspace/dependency 造成的不一致。

**影響：** 執行者需自行補充未列出的 lockfile 生成／更新流程；僅按現有命令無法從零完成 bootstrap。早期 red-green 證據也會混入環境啟動失敗。

**建議：** 在同一任務先建立最小測試框架與明確的 run 外 lockfile 生成／更新流程，再寫產品 failing test。保留 CI 與已鎖定安裝使用 `npm ci`，區分開發者依賴維護和 Agent 運行中禁安裝。

**修訂後驗收：**
- [ ] Fresh clone 可按列出的命令生成／安裝固定依賴並跑起 Vitest。
- [ ] 第一個 red test 的原因是 profile/doctor 行為未實作，而不是缺 package/test runner。
- [ ] 新增 workspace 後有明確 lockfile 更新命令，接著 `npm ci` 可重現成功。

### R11 — P2：部分介面與任務依賴仍需執行者自行設計

**計畫證據：** P:138–154、P:186、P:232–240、P:448–477、P:615–646、P:1060–1061。

**設計依據：** S:179–193、S:248–249、S:299–303、S:986–992。

具體例子：

- Task 9 宣稱完成 two-phase admission，但 evidence-backed 分類的 `classifyChallenge` 到 Task 13 才產出；Task 13 又依賴包括 Task 9 的 M0 Gate。若 M0 要驗收完整 admission，需明確拆分基礎判定與後續模型分類，否則形成語義上的前向依賴。
- Task 23 消費 `signed run scope grants`，先前任務沒有定義簽發者、資料 schema、key ownership、過期／撤銷規則或驗證接口。這不是僅選一個套件版本的細節。
- `publishStreamRange(jobId, start, end)` 在 Task 3 產出，而 job stream 到 Task 6 才建立；沒有指定 stream reader 注入契約或 bridge 的責任邊界。
- Task 4 宣告 `authorizeTool`，測試使用 `authorize`；Task 2 測試使用的 `VerificationInput` 沒有在該任務的產出區明確定位。這些名稱可能是 helper，但計畫沒有說明。

**影響：** 按任務交給不同實作者時，容易各自定義不相容的 DTO／責任，或用 provisional mock 填補前向依賴而沒有後續真實整合驗收。

**建議：** 只補跨任務邊界所需的明確型別、參數／返回值、producer/consumer 與首次整合測試，不需要把計畫寫成完整實作。對 `signed` grant 若不需要加密簽署，則明確改成受信 IPC 身份授權，避免引入沒有 owner 的新協議。

**修訂後驗收：**
- [ ] 關鍵 consumes 項均能指向已完成任務的明確輸出，或具名的外部輸入。
- [ ] M0 admission 的範圍與 M1 classifier 的首次接入測試明確，不以 mock 宣稱完整能力。
- [ ] 公開名稱、型別與測試名稱一致；各 package 的 contract typecheck 能獨立發現介面不相容。

### R12 — P2：M1 各軌跡的成功裁決仍是摘要旗標

**計畫證據：** P:821–876。

**設計依據：** S:802、S:806–815。

計畫正確保留六條軌跡與每條獨立 3 次、至少 2 次成功，但測試主要是 `authoritativeTransitions: true`、`falseSuccesses: 0`、`realToolObservation: true` 等摘要旗標。沒有定義每條 fixture 的故障注入點、模型必須完成的動作、成功所需的原始事件序列，以及 summary 的獨立裁決來源。

**影響：** Harness 可能確實呼叫過模型與工具，卻由固定 fixture 程式替模型完成修錯、改路或候選提取；通用摘要仍顯示成功，不能證明設計要求的 Agent 能力。

**建議：** 在 Task 18 為每條軌跡固定 input、injection、required events、forbidden events、terminal condition 和 run isolation 規則；success 必須從 canonical event／artifact／平台 fixture 狀態計算，而不是 Solver 自報或無來源布林值。

**修訂後驗收：**
- [ ] Repair：有原始錯誤、同一 Solver task 的實際 patch，以及成功工具輸出。
- [ ] Route switch：有具體反證與不同 fingerprint，不能只修改自然語言描述。
- [ ] Long job：Worker 已釋放，terminal event 後只取得一次 continuation claim。
- [ ] Compaction：有強制 compaction／重建及 raw ref 回取，且沒有重跑已否定 fingerprint。
- [ ] Rejected submit／partial：有權威 response 與其後真正繼續求解的事件，而非只轉換狀態。
- [ ] 每條保存三個乾淨獨立 run；summary 可重新計算，18 個結果全部可追溯。

### R13 — P2：Formal 的 run-integrity 門檻缺少自動化負向判定

**計畫證據：** P:525–565、P:1177–1186、P:1278–1310、P:1329–1349。

**設計依據：** S:303–305、S:704、S:859–870、S:874–884。

Task 31 的驗收文字正確描述人工操作使 formal invalid，但完整介入紀錄只在可選 Task 26B 提到，基礎 TSecBench＋host VPN＋單 Browser profile 沒有明確的 pause-effects、secret/VPN refresh 前後證據對帳與失去獨占性處置任務。Task 30 的測試則集中在 solvedCount/denominator，未固定「達到解出率但 integrity invalid」必須不通過。

`FormalResult` 列出的 Gate status 未含 `invalid` 本身不必然錯誤——可映射成 `failed` 並保留 integrity reason——但此映射目前沒有定義，也沒有測試。

**失敗情境：** 已有足夠 accepted 的 run 發生人工提交或失去獨占性，若 evaluator 只看分數和分母，可能輸出 passed。反過來，單一 unknown Hint 又可能被誤當成全 run invalid，刪掉其他可信 accepted。

**建議：** 基礎 Supervisor/admission 流程負責 intervention lifecycle，M5 只接入額外 UI 管道；Formal evaluator 先檢查 run integrity，再計門檻，並明確映射 invalid、infrastructure_invalid、failed 與局部 unknown。

**修訂後驗收：**
- [ ] 已達解出率但有人工解題／提交／instance 操作／Challenge Browser 控制，仍不通過。
- [ ] Secret/VPN refresh 先 pause effect；不能證明沒有題目副作用時 invalid。
- [ ] 失去 task 獨占性、canonical state 損壞或無法證明舊執行停止，保留原報告並拒絕正式通過。
- [ ] 單一 unknown Hint/Submit 不刪掉其他權威 accepted；不將未知成本虛構為零。
- [ ] 使用精確數值測試門檻邊界，例如 easy=5 要 3 solved、medium=4 要 2、unknown=3 要 2；hard-only／空集合不能通過。

## 4. 設計需求覆蓋對照

「已映射」只表示計畫已有相應任務，不代表能力已實作或驗收通過。

| 設計範圍 | 計畫對應 | 審計結果 |
| --- | --- | --- |
| §§1–3 目標、host-first、非目標 | Global Constraints、M0–M6 | 方向保留；R01 需修正 live 實施順序 |
| §4 OpenCode/session/policy 邊界 | Tasks 2–6、11 | R02–R05、R11 |
| §5 TSecBench／本地入口／admission | Tasks 8–9、19–21 | 主要 wire 分支已有映射；R01、R09、R11、R13 |
| §6 Same-Solver、watch、candidate、compaction | Tasks 13–17 | 主流程保留；R07、R12 |
| §7 State、Intake、Scheduler、三領域方法 | Tasks 2、13、18、20 | 有任務；預算及跨任務依賴見 R02、R11 |
| §8 Runtime、effect、metering、Browser | Tasks 3、6–7、10、23 | 主要方向保留；R06、R07 |
| §9 Canonical state、checkpoint、fail-stop | Tasks 3、11、14、17、23 | R05；資料採集見 R08 |
| §10 Reference／模型資料 | Tasks 4–5、15 | Snapshot、visibility、bulk 限制已寫入；配置／預算接入見 R02、R04 |
| §11 Core／ARM64／M5 delivery | Tasks 22–29 | 條件式 tracks 正確；R06、R11 |
| §12 Gate／正式門檻／度量 | Tasks 12、18–24、30–31 | R01、R08、R12、R13 |
| §13 外部輸入 | External Input Gates | 已列出；R09 需區分產品 fallback 與 Gate 額外輸入 |
| §§14–16 研究依據／未驗證項／可調項 | Spec 引用、全域約束 | 不把研究資料當實測；語言／build system 可由 builder 決定 |

## 5. 建議處理順序與重新審查條件

這是 review 的建議處理順序，並未套用到原計畫：

1. **執行前修正可執行性：** R01、R10、R11，避免消耗 task A 後才發現流程或契約未準備好。
2. **M0 前閉合控制邊界：** R02–R05；同步決定 R08 的必要採集點。
3. **M1/M2 前閉合候選與能力裁決：** R07、R09、R12。
4. **M4/M6 前閉合正式承諾：** R06、R13；M5 仍只依實際使用能力選做。

重新審查時應能驗證：

- [ ] 每個 P1 都有明確任務 owner、前置依賴、實作責任及可失敗的測試。
- [ ] Task A 開始計時之前，整條 M2/M3 軌跡所需程式已完成且固定版本。
- [ ] 否定測試涵蓋單一工具旁路、題目配置載入、Supervisor 真實死亡、本題 metered endpoint raw client、stale candidate dispatch。
- [ ] M1 success 和 M6 pass 可從原始事件獨立重算，不只依賴摘要旗標。
- [ ] 尚未取得的模型、task、ARM64 環境與平台證據繼續列為外部 Gate 輸入，不能被文件完成狀態替代。

## 6. 本輪驗證記錄

- 完整讀取 P 的 33 個任務及 S 的現行設計，並依上表逐節對照。
- 以內容檢索核對 budget、metrics、signed grant、verification、配置載入、fail-stop 與人工介入的實際落點。
- 對 R03 進行無檔案副作用的布林語義反例運算，確認單獨暴露禁用工具仍會通過原斷言。
- 新 review 的 Markdown 空白檢查及原檔 object ID 比對由本次文件交付驗證；未將此檢查宣稱為產品測試。
- 所有修訂內容均為建議，原實施計畫保留原狀，等待使用者決定後續是否修訂。

---

## 7. 第二輪審計基準與結論

審計日期：2026-10-15。本輪依使用者要求重新審計修訂後的 implementation plan，只更新本 review。

### 7.1 文件與工作區基準

- **P₂／本輪被審計計畫：** [`2026-10-15-general-ctf-agent-system-implementation.md`](../../plans/archive/2026-10-15-general-ctf-agent-system-implementation.md)，1,601 行、33 個任務，實際排列包含 `18 -> 20 -> 19 -> 21`。
- **S／設計依據：** [`2026-10-14-general-ctf-agent-system-design.md`](../../specs/2026-10-14-general-ctf-agent-system-design.md)，992 行，仍是 S:8 指定的唯一現行設計。
- **上一輪意見：** 本文件第 1–6 節的 R01–R13；其中 `P:` 行號仍指首輪 1,363 行版本。本輪所有 `P₂:` 行號均指上述 1,601 行版本，不能混用。
- 審計開始時，plan 已有上一輪留下的未提交修改；本輪以其工作樹內容為基準，未還原、改寫或追加 plan。工作區仍沒有可執行的產品 workspace。
- 這是需求、流程、介面與驗收證據的文件審計。下文「閉合」只代表計畫已足以處理該項原始問題，不代表功能已實作或產品 Gate 已通過。

| 文件 | 第二輪開始時的 Git blob object ID |
| --- | --- |
| P₂ | `421745ea5e293455e3de41ddce5e5908f819f335` |
| S | `cd01985d70b1b57cac511e9801255f821d7a8555` |
| 本 review，追加第二輪前 | `54326d2d4474024f7d3808c1a02e39a882554c77` |

### 7.2 結論摘要

**Changes requested——修訂已解決多個首輪缺口，但「R01–R13 全部閉合」仍不能成立。**

首輪 13 項中，**7 項在計畫層面閉合，6 項部分閉合**。本輪把剩餘缺口及修訂引入的矛盾集中為 **6 項可操作意見：3 項 P1、3 項 P2**，編號接續為 R14–R19，不重寫原始 R01–R13。

| ID | 等級 | 本輪問題 | 主要任務 | 關聯首輪意見 |
| --- | --- | --- | --- | --- |
| R14 | P1 | 累計用量與可歸還 slot 共用互相矛盾的 reservation 釋放契約 | 2、3、7、9–11、20 | R02 |
| R15 | P1 | 「任一共享預算用盡即停止所有 dispatch」未按動作需求與 scope 判定 | 3、4、7、9、11、20 | R02 |
| R16 | P1 | Dispatch 依賴 mutation lease，但沒有對應 producer、生命週期或交錯執行測試 | 2、3、7、9、11、16 | R07、R11 |
| R17 | P2 | Readiness 固定 build 後仍安排程式／harness 變更，同版本證據鏈未閉合 | 18、20、19、21 | R01 |
| R18 | P2 | Metrics 已前移，但來源欄位、事件投影與跨 incarnation 時鐘契約仍不完整 | 2、3、6、11、17、18、30 | R08、R11 |
| R19 | P2 | M1 事件 oracle 能證明流程，仍未約束模型對關鍵求解動作的因果歸屬 | 5、13–18 | R12 |

問題集中在既有設計的落地精度，不需要推翻 host-first、單一 canonical State、平台 effect 出口或條件式 M5。

## 8. 首輪 R01–R13 重新核實

| 首輪 ID | 本輪狀態 | 修訂後證據與判定 |
| --- | --- | --- |
| R01 | 部分閉合 | P₂:1071–1123 已將 Scheduler、slots、cleanup、recovery 移到 task A First List 前；主要開發順序問題已改善。但 P₂:1130–1156、1179–1201 仍有 freeze 後的程式／harness 工作，同 build Gate 證據未對齊，見 R17。 |
| R02 | 部分閉合 | P₂:178、227、303–317、481、587 已有早期共享 ledger、模型全路徑計費及 protected-effect 預留。但 slot 歸還與全域 exhausted 判定有衝突，見 R14、R15。 |
| R03 | 已閉合（計畫層） | P₂:345、355–361 對三種角色逐項排除禁止工具，核對 managed allowlist，並測試注入未受管工具後的 server-side 拒絕；原 `not.toEqual(expect.arrayContaining(...))` 邏輯已移除。 |
| R04 | 已閉合（計畫層） | P₂:339–376 固定 release-owned config root、隔離全域配置，對 main/subagent/reconstructed 路徑做 sentinel probe；公開介面不能滿足時有 `blocked_opencode_contract`。 |
| R05 | 已閉合（計畫層） | P₂:393–431 明確指定 Supervisor 外的既有 CLI/Launcher，包含真實外部 `SIGKILL` 和 Launcher 自身死亡後的保守處置；P₂:644–704 安排實際 Supervisor 整合驗證。產品效果仍須實測。 |
| R06 | 已閉合（計畫層） | P₂:443–491、1258–1339 已區分 broker-only/direct grants，包含同題同端點的 raw 拒絕、managed 正向、generation/revocation/restart 失效與 M4 驗收。Host fixture 仍須按聲明證明實際不可直連。 |
| R07 | 部分閉合 | P₂:177、551、895–939 已加入 current verification、`validUntil`、generation、unknown、operation identity、三種模式及失敗 owner。但最終互斥仍依賴未產出的 mutation lease，見 R16。 |
| R08 | 部分閉合 | P₂:179、228、268、427、698、976 已把採集責任前移；P₂:1496–1542 限定晚期聚合。具體 metric 輸入仍不足以唯一重算所有要求，見 R18。 |
| R09 | 已閉合（計畫層） | P₂:548–583 區分 formal 可信時間與 dev/live 保守 fallback；P₂:1143–1156 明確把更嚴格時間證據留在 M2 Gate policy。 |
| R10 | 已閉合（計畫層） | P₂:31、125–158 先建立可運行 harness，再寫產品 red test；初始／後續 lockfile 維護與 `npm ci`、產品 run 禁安裝已分開。 |
| R11 | 部分閉合 | AdmissionClassifier、可信 IPC grant、Runtime stream publication owner、`authorizeTool` 與 `VerificationInput` 已補齊。新的／剩餘跨任務缺口是 mutation lease 及事件來源投影，見 R16、R18。 |
| R12 | 部分閉合 | P₂:998–1063 已有六軌跡 required/forbidden/terminal 表、獨立 run 和 canonical verdict，優於首輪摘要旗標；但缺模型動作歸因及反向控制，見 R19。 |
| R13 | 已閉合（計畫層） | P₂:655–704、1395–1402、1496–1548、1567–1587 已將 intervention 放入基礎生命週期，明確 invalid -> failed + reasons、外部 infrastructure_invalid、局部 unknown 及門檻邊界。 |

上述狀態由任務內容交叉核對得出，沒有以 P₂:55–71 的 Audit Closure Map 或關鍵字是否存在代替驗收判斷。

## 9. 第二輪詳細發現

### R14 — P1：可歸還容量與累計用量的釋放契約互相矛盾

**計畫證據：** P₂:178、227、262–264、481、587、632、694、1081、1109。

**設計依據：** S:59、363、483–487、568–586、692–699。

Task 2 把 `worker_slots`、`browser_slots`、`instances` 與 token、tool time、submissions、Hint、remote units 放入同一 BudgetLedger。共用帳本沒有問題；問題在於 Task 3 明文規定 **「only proof of non-dispatch may release a reservation」**，公開介面只有 `reserve/settle/cancel/markUnknown/readSnapshot`。

後續 Task 10 又要求 browser 確認 teardown 後歸還 slot，Task 11 要求 task/lease 終止後歸還 Worker slot，Task 20 有 `releaseInstanceSlot(reservationId, evidence)`。這些資源都已經 dispatch，無法提供「未發送」證據。計畫沒有說明這是另一種容量 release、`settle` 的特別語義，或累計用量與當前 occupancy 的不同欄位。

**失敗情境：** 容量為 1 的 Browser 在 A 題使用並關閉後，若照 Task 3 不釋放已 dispatch reservation，B 題永遠拿不到 slot；若實作者為了讓 B 題可用而廣泛放寬 release，則又可能把已消耗 Submit/oracle 或 unknown 額度退回。三個 instance 的釋放／再分配有相同問題。

另外，Task 20 取得 instance reservation、Task 9 在平台操作前 reserve、Task 7 在 `prepared` 前 reserve，尚未說明同一 operation 如何傳遞既有 reservation。這不能只靠三處都寫「共享帳本」保證不會重複預留。

**建議：** 在早期 contract 明確區分累計消耗與可歸還 occupancy，指定各自的 settlement/release 證據；已消耗用量不可因容量釋放而歸零。為同一 operation 指定唯一 reservation owner／穩定 reservation identity，讓其餘層驗證或引用，不另扣一份。

**修訂後驗收：**
- [ ] Browser A 佔滿單一 slot 時拒絕 B；確認 A teardown 後 B 可啟動，但 token/tool 累計用量不下降。
- [ ] 三個 instance 佔滿後，確認 Close/List stopped 才歸還一個 slot；尚未對帳的 unknown Close 不歸還。
- [ ] Worker 釋放／恢復不重置已用 budget；已確認消耗與 unknown remote units 不被容量 API 退款。
- [ ] 一次 Scheduler -> Platform -> protected-call 路徑只持有一份相應 reservation，重複 intent 亦不重扣。

### R15 — P1：任一維度 exhausted 的全域停止規則會阻斷合法工作

**計畫證據：** P₂:178、249–250、671–673、694、1080–1109。

**設計依據：** S:483–487、586、632–637、698–704、884。

Task 11 的測試要求「after **any shared budget** is exhausted」即 `newDispatches: 0`。搭配 Task 2 包含 slot、Hint 與 scope-specific remote units 的共用預算，按字面是一個全域判定，而沒有定義該次動作究竟需要哪些新增額度、是否已持有 slot，以及哪個 scope 被耗盡。

**可構造反例：**

| 當前狀態 | 應允許的動作 | 若用任一零餘額阻止全部 dispatch |
| --- | --- | --- |
| `hints=0`，token/tool 仍足夠 | 不使用 Hint 的本地 experiment | 被錯誤拒絕 |
| 單一 Worker slot 已分配給目前 Solver | 該 Solver 在已持有 slot 中繼續 model/tool turn | 被錯誤拒絕 |
| 三個 instance 正在使用 | 對自有低價值 instance 執行已授權 Close 以釋放名額 | 被錯誤拒絕，無法解除耗盡 |
| A 題的 remote units 因 unknown 被保留 | 不共用該 scope 的 B 題離線工作 | 局部 unknown 被擴大成全 run 停止 |

這不是要求忽略硬上限。新請求需要的用量超額仍須在發送前拒絕；需要避免的是把可選功能、已分配容量和局部額度當成全場終止訊號。

**建議：** Dispatch gate 以「動作需要的新增用量 + 現有 ownership + 預算 scope」原子判定。把 run-wide 終止條件與局部不可分配分開，並明確允許符合條件的 observation、checkpoint 和已授權 cleanup。

**修訂後驗收：**
- [ ] 對上表逐項加入正向測試；保留真正超額請求的零 bytes 負向測試。
- [ ] 滿 instance/Browser slot 只阻止新 acquisition，不阻止目前 owner 的合法續跑或資源釋放。
- [ ] A 題 unknown 的 units 持續占用，但 B 題的可獨立工作不因此停擺。

### R16 — P1：mutation lease 只有消費點，沒有可實作的互斥契約

**計畫證據：** P₂:177、454、551、648–657、895–933。

**設計依據：** S:367–382、469、565–571、838–839。

Task 9 要求 Task 7 在「final State transaction **under the mutation lease**」檢查有效性；Task 16 又寫 Task 9 在 mutation lease 下重查。全文對 mutation lease 的直接提及只有這兩處，沒有任務產出其 acquire/release/revocation 介面、scope key、owner 或持有期間。Task 11 的 `renewLease` 和 task/session lease 不能自動等同「同一遠端狀態的 mutation 互斥」；它也晚於 Tasks 7/9 才實作。

**失敗情境：** Submit 檢查 generation G 後，另一條 Close/Start 路徑重建同一資源並改到 G+1，舊 Submit 才發送。短暫的 SQLite transaction 只能保護 canonical 寫入，不能自行把跨 service 的遠端修改串行。現有「入隊後再失效」測試可以通過，仍漏掉「最終檢查後、發送前」的交錯執行。

同時，Task 9 Interfaces 與 Task 16 Step 4 對最後檢查的執行者分別指向 Task 7 和 Task 9；應固定同一實際 transport 出口，而不是留下兩個可各自實作的 gate。

**建議：** 將 mutation lease 的最小契約與 State owner 放到首次 consumer 之前，指定 run/challenge/resource 或 endpoint scope、有效 owner/incarnation、取得及釋放條件，以及所有同 scope mutator 必須共用的入口。固定 durable `dispatching`、最終 predicate、transport dispatch 的順序與持鎖邊界；維持原設計的 fail-stop，不引入存活 executor adoption。

**修訂後驗收：**
- [ ] 用 barrier 精確交錯 Submit 與同 scope generation-changing mutation：mutation 先完成時舊 Submit bytes 為零；Submit 先取得有效 lease 時，後者等待規定的釋放條件。
- [ ] 同 scope 的兩個 mutator 不並行；不同 challenge 與純附件分析仍可並行。
- [ ] 舊 incarnation／撤銷 lease 不能 dispatch；unknown 依最小 scope 阻擋重複 effect。
- [ ] Tasks 7/9 可使用先前已完成任務的具名契約獨立通過測試，不依賴未來 Task 11 或測試私有 mutex。

### R17 — P2：pre-live build freeze 與後續任務內容不一致

**計畫證據：** P₂:1055–1063、1074–1084、1113–1156、1162–1201。

**設計依據：** S:244–251、796–802、917–923。

Task 20 前置 Scheduler 是正確修正。但它在 Step 5 固定 build，並要求該 **exact source/build identity** 已通過 M0/M1 Gates；其後 Task 19 又新增 `m2-input-policy.test.ts`、`m2-live-single.ts`，修改 `doctor/prepare/start`。Task 21 則在 First List 之後才列出建立 `m3-host-portfolio.ts` 和修改 recovery test，同時禁止中途開發及改變 build。

Task 19 Step 2 確實重跑 `gate:m2-m3-readiness`，不能忽略這個改善；但尚未定義它如何處理已改變的 identity、先前 M1 模型 Gate 的有效性，以及尚未建立的 M3 live harness。所列命令只有 deterministic checks 和 readiness，沒有說明何時重新建立精確版本所需的 Gate 證據。

**失敗情境：** 嚴格比對版本會因 Task 19 的合理修改而拒絕 Task 20 readiness；寬鬆重發 readiness 則可能把舊 build 的 M1 證據套到新 build。若執行者到 Task 21 才建立 live harness，又重新把開發／修錯放回 task A 的計時窗口。

**建議：** 把整條 M2/M3 所需的 CLI policy、live harness、deterministic evaluator 和 recovery instrumentation 都放在最後一次 pre-start freeze 前。明確定義 build identity 的涵蓋範圍，以及 M0/M1 證據可重用或需重驗的規則；Tasks 19/21 的 live 部分只消費已存在的入口和固定證據。

**修訂後驗收：**
- [ ] 最後 freeze 時 `gate:m2`、`gate:m3` 的可執行 harness 均已存在且通過 deterministic fixture。
- [ ] Freeze 前修改 CLI／Solver 相依程式會使對應舊證據失效；readiness 不能只換一個 build ID 後沿用結果。
- [ ] 從 task A First List 到 M3 terminal，產品與 harness 不再新增／修改，兩個 Gate 報告可回指同一已驗證 artifact。

### R18 — P2：metrics 事件名稱前移，但重算所需資料契約仍未閉合

**計畫證據：** P₂:179、228、268、427、698、975–976、1015–1016、1027、1496–1542。

**設計依據：** S:388–395、890–897。

Task 2 已列出 `MetricEvent` union，Task 30 也只聚合既有事件，這解決了「M6 才開始採集」的方向性問題。然而，以下 producer/consumer 決策仍留空：

1. `aggregateMetrics(events: MetricEvent[])` 只接 metric events；start anchor 存在 Run/start intent，而 union 沒有 start event，亦未指定哪個 payload 搭載 anchor。`firstExperimentMs` 因而缺少明確起點輸入。
2. Task 17／M1 oracle 要用 raw-range retrieval、session reconstruction 與重做 fingerprint；union 只有 `compaction.started/completed`，沒有說明這些 canonical business events 如何投影成可聚合欄位。`session.compacted` 與 `compaction.completed` 是不同名稱，關係也未固定。
3. Observation latency、recovery/recomputation time 只有事件名與四個預期結果數字；尚未指定成對時間點、必要數值欄位及缺失／未發生的區別。只有「monotonic timestamp/correlation IDs」不能保證跨進程／重啟 epoch 的時間可直接相減。

**影響：** 各任務可以各自完成目前列出的型別／摘要測試，直到 Task 18 或 Task 30 才發現沒有足夠原始資料，或將重啟後的時鐘重置誤算成負延遲。這些資訊不能由重新讀取 artifact bytes 補回。

**建議：** 補一個精簡的 metric -> producer -> 必要 payload／時間基準 -> aggregator input 對照。Business events 不必全部混入 MetricEvent，但要指定投影或額外輸入；明確保存同 clock domain 的成對時間或已計算 duration，以及跨 incarnation 所需的時鐘身份。區分「該事件未發生，計數為零」與「資料缺失，不能重算」。

**修訂後驗收：**
- [ ] 從具體的 start/dispatch/visibility/publication 時間輸入算出 80/40/15 ms，而非只驗證 helper 回傳這三個數字。
- [ ] 在第二個進程／incarnation 重設本地時鐘的 fixture 中，recovery 與 wall 指標仍正確；缺少必要起點明確報錯或 unknown。
- [ ] Raw retrieval、重做 fingerprint、next-action outcome 可由定義好的原始欄位重算；沒有 compaction 的正常 run 不被誤當缺資料。
- [ ] 每個 late consumer 所需欄位在其第一次真實 run 前已有實際 producer 和 contract test。

### R19 — P2：M1 oracle 尚不能區分模型求解與 harness 代做

**計畫證據：** P₂:998–1029、1047–1063；另見 P₂:179 的模型 request/usage 事件。

**設計依據：** S:795、802、810–815；首輪 R12 的失敗情境及驗收目的。

新表已固定六條軌跡的事件順序與終態，能避免單靠 Solver 自報 success。但目前 required events 沒有把關鍵求解動作連到實際 OpenCode 模型 response/tool call；僅有 task ID、工具成功及 artifact ref，仍不足以證明模型讀了 raw error、提出 patch 或完成後續求解。

例如 repair 軌跡只要求 `job.terminal(error) -> workspace.patched(同 task) -> job.terminal(success) -> artifact.published`。Harness 若以同一 bound task 代做 patch，照樣產生這個序列。旁邊再發出一次與修錯無關的模型請求，也能同時滿足「有模型成本」與現有事件條件。Route switch、rejected-submit 後的新 experiment 也存在類似歸因缺口。

**建議：** 區分 deterministic contract fixture 與 model capability run。後者需讓關鍵求解動作引用實際模型 response/tool-call identity、輸入 observation/ref 及對應工具結果，並標明 harness injection 來源。Scheduler、watch wake-up 等設計允許的 deterministic 控制動作不必改成模型生成；被禁止代做的是用來證明模型能力的求解內容。

**修訂後驗收：**
- [ ] 模型讀到 raw error 後的真實 patch/tool call，能沿 response -> action -> result -> artifact 證據鏈核實。
- [ ] 模型沒有產生求解動作、由 harness 代做相同 patch／experiment 的負向控制，必須判 failed，即使終態與 artifact 正確。
- [ ] 刪除必要事件、插入 forbidden event、破壞動作來源引用都使 oracle 失敗；不只對成功 trace 測 `succeeded`。
- [ ] 三個獨立 model runs 逐一使用同一歸因規則裁決，保留全部 18 個結果；deterministic runner 的成功不得計入 2/3。

## 10. 第二輪建議處理順序

1. **在 M0 consumer 實作前：** 先處理 R14/R15 的 ledger 語義，再處理 R16 的 mutation lease producer 與 dispatch 邊界，避免各 package 寫出互不相容的行為。
2. **在 M1 模型 Gate 前：** 補齊 R18 的來源事件／clock 契約及 R19 的模型歸因負向控制；這些屬可被驗證的輸入，不可延後到報告階段補值。
3. **在 task A First List 前：** 按 R17 完成所有 live harness 與版本證據，再固定最終執行版本。

R03/R04/R05/R06/R09/R10/R13 的已補內容應保留。模型設定、task A/B、VPN、原生 ARM64 與正式場次仍依 External Input Gates 提供／驗證；它們不阻止本次文件審計，也不能因計畫修訂而記作實際通過。

## 11. 第二輪驗證記錄與交付邊界

- 完整讀取現行 P₂ 的 33 個任務、S 的 992 行設計及首輪 R01–R13；按 spec 要求核對執行順序、公開介面、失敗分支及驗收證據。
- 專用內容檢索確認：33 個 task 標題保留、無已勾選的實施步驟、Task 20 實際位於 Task 19 之前；mutation lease 只有兩個直接 consumer 描述，未找到其具名 producer／生命週期契約。
- 執行無檔案副作用的 Node 語義反例：零 Hint 額度下的本地 experiment、已持有 Worker slot 的續跑、滿 instance 時的 cleanup，均出現「全域零餘額判斷拒絕／按動作用量判斷可允許」；已 dispatch 且 teardown confirmed 的 slot 亦不滿足 only-non-dispatch release 規則。這些是計畫規則的反例，不是對尚不存在產品程式的測試結果。
- 重新核對既有 keyword closure 的侷限：任務標題、R01–R13 字樣、`BudgetLedger` 或 `DispatchPrecondition` 存在，不能證明釋放語義、依賴 producer、版本證據或模型歸因已閉合。
- 交付校驗：`git diff --check` 通過；已檢視 review diff，原有 R01–R13 詳細意見保留；`git hash-object` 確認 plan/design 與第 7.1 節的工作樹 hashes 一致。Git status 中 plan 的修改是上一輪既有變更，不是本輪新增。
- **本輪只更新此 review；未修改 plan、design 或應用程式碼，未執行 npm／模型／live platform／ARM64／formal 產品 Gate，未 commit。**

---

## 12. 第三輪審計基準與結論

審計日期：2026-10-15。本輪核對依 R14–R19 修訂後的完整計畫，重點是各任務接合處的可執行性，而非只檢查 closure map 或介面名稱是否存在。

### 12.1 文件基準

- **P₃：** [`2026-10-15-general-ctf-agent-system-implementation.md`](../../plans/archive/2026-10-15-general-ctf-agent-system-implementation.md)，1,742 行、33 個任務，包含 Task 26A–26C；執行排列仍是 `18 -> 20 -> 19 -> 21`。
- **S：** 同一份已確認的 992 行上層設計，仍為唯一現行設計依據。
- 本節及其後的 `P₃:` 行號只對應本輪基準；前兩輪的 `P:`、`P₂:` 行號保持歷史意義。
- 未找到 `AGENTS.md`；工作區沒有產品 `apps/`、`packages/`、`tests/` 或 npm workspace，計畫無已勾選步驟。本輪是文件／契約審計，不是執行中的產品漏洞驗證。

| 文件 | 第三輪開始時的 Git blob object ID |
| --- | --- |
| P₃ | `437d7159673e2c2de52e1cc78bd5641bae386081` |
| S | `cd01985d70b1b57cac511e9801255f821d7a8555` |
| 本 review，追加第三輪前 | `919efcae0435eb3e122215ac323b858f41c1a1c0` |

### 12.2 結論

**Changes requested。** 最新版本確實補強了預算、lease、build freeze 和模型歸因，但「沒有已知的計畫層級未閉合項」的結論仍過早。關鍵字、任務數及 Markdown 檢查通過，不能代替跨服務生命週期與資料充分性的核對。

本輪整理 **7 項：2 項 P1、5 項 P2**，接續編號 R20–R26。這些修正可維持現行 host-first、三級 effect、Platform Service 邊界與 fail-stop/checkpoint 決策；目前沒有必須交由使用者重新決定的上層架構取捨。

| ID | 等級 | 問題 | 主要任務 | 關聯歷史意見 |
| --- | --- | --- | --- | --- |
| R20 | P1 | Spawn 到 Launcher 登記之間的崩潰窗口未受測試／契約保護 | 6、10–12、20–21 | R05 |
| R21 | P1 | Mutation lease 尚未接到可修改同一遠端狀態的一般 Job／Browser | 2–3、6–7、10、13、16 | R07、R16 |
| R22 | P2 | Long-job 釋放 Worker 後缺少容量重新取得與有效 session 綁定的續跑契約 | 4–6、11、14、17–18 | R14、R15 |
| R23 | P2 | Adapter 方法沒有承載新 dispatch gate 所需的 canonical operation context | 2、7–9、16、27–28 | R11、R14、R16 |
| R24 | P2 | M0/M1 已消費 build identity 重算能力，但具名 producer 到 Task 20 才建立 | 12、18、20 | R11、R17 |
| R25 | P2 | Events-only metrics API 無法區分未發生與整組來源事件漏記 | 2–3、11、17–18、30 | R08、R18 |
| R26 | P2 | Recovery 測試將 `solve_state` 的值寫入 `run_state` | 2、11 | 狀態型別一致性 |

## 13. 第二輪意見的實際閉合狀態

| ID | 本輪判定 | P₃ 證據與剩餘邊界 |
| --- | --- | --- |
| R14 | 原始矛盾已閉合 | P₃:189–190、259、309、624、718、1195–1236 分開 consumable/capacity、未 dispatch 取消與終止後釋放，並傳遞既有 reservation。Worker 釋放後的續跑接合仍需 R22。 |
| R15 | 原始全域停止規則已閉合 | P₃:370、757–764、792、1213–1217 已用按動作／scope／既有 ownership 的判定及正向案例取代全域 exhausted。不能因此省略續跑時重新取得 ownership，見 R22。 |
| R16 | 部分閉合 | P₃:191、260、313、518、540–544 已有 producer、生命週期與兩種交錯；但實際接合集中在 protected call／平台 intent，未覆蓋全部受管 mutator，見 R21、R23。 |
| R17 | 原始 freeze 後開發矛盾已閉合 | P₃:1186–1266 已前置 CLI/harness 與同版本重驗；P₃:1272–1277、1313–1318 的 live 任務只消費固定產物。新增的早期 identity producer 依賴仍需 R24。 |
| R18 | 部分閉合 | P₃:192–206、261、460、495、796、1058、1630–1683 已有 anchor、clock domain、共用 projector 與 N/A/missing 值型別；但缺少辨別「整組事件缺失」所需的獨立活動／完整性輸入，見 R25。 |
| R19 | 原始模型歸因問題已閉合（計畫層） | P₃:193、339、399–436、1103、1122–1142、1162 已固定可信來源、模型 run attestation、六軌跡必要動作及負向控制。OpenCode 公開介面的可行性仍由 Task 5 probe 驗證，文件不能代替實測。 |

首輪已補的工具逐項禁用、配置隔離、同題 broker-only egress、dev/live 時間分支、bootstrap 與 integrity-first formal 評估仍應保留。本輪 R20 是對 fail-stop 建立／登記接合處的補查，不是否定已增加外部 Launcher 的修正。

## 14. 第三輪詳細發現

### R20 — P1：只證明「已登記進程停止」，不足以涵蓋 spawn／登記窗口

**計畫證據：** P₃:460、479–495、501、718、792、1331。

**設計依據：** S:555、670–676、833–844。

Task 6 在 spawn 前持久保存 Job ID／預算，並以 `LauncherControl.registerProcessGroup(identity)` 登記實際進程組；Task 10 亦要求 Browser 登記。但計畫沒有固定「建立 OS 進程、取得 identity、Launcher 接管／持久登記、允許執行 payload」的次序及崩潰處置。Job record 不等於外部 Launcher 已知道如何停止該進程。

**失敗情境：** Runtime 成功 spawn 一個獨立 process group，尚未完成 register RPC 就被 `SIGKILL`。若 child 已執行且未納入 Launcher 的完整管理範圍，它仍可能活動；目前測試 `registeredProcessesAlive: 0` 卻可以通過，甚至回傳 `newIncarnationAllowed: true`，因為漏登記的 child 根本不在被檢查集合內。

這是目前契約允許的實作缺口，不是已觀察到產品留有 orphan process。

**最小修正：** 在 Task 6 固定 Launcher-owned spawn／啟動握手：payload 執行前必須已在 Launcher 可清理的管理範圍內；半完成的啟動也有確定的 owner 和清理路徑。Task 10 共用同一 primitive，不另做 Browser 特例。這不需要存活 executor adoption 或新增 recovery-only binary。

**修訂後驗收：**
- [ ] 在 OS spawn 後、identity 持久化前，以及 register acknowledgement 前分別 kill Runtime／Supervisor。
- [ ] 用 fixture 自身的 PID／heartbeat 等獨立觀測確認沒有遺留執行；不能只查已登記集合。
- [ ] 未完成管理登記的 child 不會執行題目 payload；無法證明停止時不簽發可恢復的 StopProof。

### R21 — P1：lease producer 已建立，但一般網路 Job／Browser 仍沒有接入任務

**計畫證據：** P₃:31、191、313、457–491、518、623–625、687–718、893。

**設計依據：** S:467–469、523–539、549–553、617–619。

Global Constraints 要求同一遠端狀態的 mutator 串行；Tasks 2–3 已提供 lease。然而，具體 acquire／持有／finish 流程只接到 Task 7 的 protected-call 出口及 Task 9 平台 intent。Task 6 的一般 Job 只說明 scope、預算、provenance 與進程生命週期；Task 10 的 Browser 只接 scope、slot 和 teardown；Task 13 沒有將 experiment 的遠端狀態依賴傳入共同 mutation ownership。

**失敗情境：** Solver 的 Python／curl Job 正在修改同題服務狀態，同時 counterprobe 透過 Browser 或平台 Close／Start 修改同一資源。兩條路徑都符合自己的 scope／budget，但一般 Job／Browser 不參與 Task 7 的 lease，平台 Submit-versus-restart 測試全過仍不能證明這種交錯已串行。

**最小修正：** 在 Task 6／10／13 明確傳遞 canonical resource scope 和活動 owner，將需要修改遠端狀態的 job／browser 活動接入同一 lease；明確持有到何時、取消／lost 時如何處理。Lease 是互斥機制，不應為了統一出口而把所有本地動作或 UI fill 都改為 protected effect，也不要求 host syscall sandbox。

**修訂後驗收：**
- [ ] 網路 Job 與 Browser 對同一 fixture resource 修改時不重疊；任一方與平台 resource mutation 亦使用相同 key。
- [ ] 長 Job 未結束時，不能因一次 RPC 已返回就提早釋放其 mutation ownership。
- [ ] 純附件計算與不同 challenge 仍可並行；三級 effect 的失敗處置保持區分。

### R22 — P2：long-job continuation 尚未重新取得已釋放的 Worker ownership

**計畫證據：** P₃:19、190、370、491、740、781–792、915–940、1139。

**設計依據：** S:179–193、353–363、812、837。

Task 4 的下一次模型請求需要 bound task 的既有 Worker-capacity reservation，Task 6 的新 Job 亦檢查它；Task 11 在 `createTask` 分配，於 terminal lease/task 釋放。Task 18 的 long-job 軌跡則明確要求先 `lease.released`、之後才由 resumed model 執行 next action。

Task 14 的 `claimContinuation`／`resumeContinuation` 沒有指定重新取得 slot、建立新 execution lease、重建／綁定有效 session 或等待容量的流程。單純保留 task ID、handle、cursor 不會讓已 released 的 reservation 重新有效。

**失敗情境：** A 的 long job 在 Worker 釋放後完成，但唯一 Worker slot 已由 B 使用。若沿用 A 的舊 session/reservation，下一次模型請求被新 budget gate 正確拒絕；若直接放行則超配 Worker。若將一次 claim 當作已成功 dispatch，還可能在 slot 暫不可得時丟失 continuation。

**最小修正：** 在 Tasks 11／14 固定「釋放 Worker 但保留等待中的邏輯 task」與「重新取得 capacity 後建立有效 execution/session 綁定」的契約；canonical claim、等待 slot 和真正執行的狀態需可恢復且不重複派工。

**修訂後驗收：**
- [ ] `worker_slots=1`：A 釋放、B 佔用、A completion 到達；A 等待，B 終止後 A 恰好續跑一次。
- [ ] A 的舊 lease/reservation 仍被拒絕；新 session/attempt 使用新取得的 capacity，累計 token/tool 用量不重置。
- [ ] 在 claim 後、取得容量前 crash／重複 delivery，不會遺失或重複 next action；deadline 仍可阻止新模型請求。

### R23 — P2：PlatformAdapter 與 protected dispatcher 的 operation context 未接合

**計畫證據：** P₃:518、554、578–588、623–625、667、1037、1569、1589。

**設計依據：** S:166、197、224–226、565–571。

Task 7 的 dispatch 需要 `operationId`、`DispatchPrecondition`、`MutationScopeKey`、`reservationRefs`，Task 9 也已產生並傳遞這些資料；但 Task 8 的公開 adapter 仍是 `submitFlag(uniqueCode, flag)`、`startInstance(uniqueCode)` 等沒有 operation context 的方法，同時又宣告它消費 Task 7 protected-effect API。也沒有具名的 bound-operation adapter factory／transport 注入契約補上這段資訊。

**失敗情境：** Task 8 實作者可自行建立 operation/reservation，Task 9 實作者又在外層建立另一份；或 adapter 直接送 bytes，外層 gate 只能包住另一條路徑。現有 wire test 與 gate test 可以各用測試替身通過，實際串起來才發現無法保持同一 canonical operation identity。

這不是說無 context 參數的 adapter 必然不安全；缺口是計畫沒有定義其他等效的上下文承載方式。

**最小修正：** 在 Task 2 定義最小 `PlatformOperationContext`，Task 8 的 effect adapter 消費它，Task 9 負責建構／授權；固定 adapter request mapping 與 Task 7 唯一 dispatch 的呼叫方向。若 Task 7 是共用函式，明確讓平台 credential 與實際 platform transport 留在 Platform Service 身份內。CTFd／rCTF 任務沿用同一邊界。

**修訂後驗收：**
- [ ] 一次真實 fixture 路徑 `executePlatformIntent -> adapter -> protected dispatcher` 的 operation ID、payload 與 reservation refs 全程相同。
- [ ] 在實際 adapter transport 前使 verification stale，server 捕獲到的 Submit bytes 為零；重複 intent 只發送一次且只記一組預留。
- [ ] 不存在未經同一 dispatch gate 的 adapter mutation 出口，也不為了共用 Runtime 而轉移平台 credential 所有權。

### R24 — P2：build identity 的早期 consumer 仍早於具名 producer

**計畫證據：** P₃:818、1103、1187–1199、1244–1260。

**設計依據：** S:743–747、802、988。

Task 12 已承諾 `gate:m0 --build-identity` 會重算並驗證 identity；Task 18 亦承諾每個 run 的 supplied/recomputed identity。唯一具名計算函式 `computeLiveBuildIdentity` 及其檔案 `live-build-manifest.ts` 卻到依賴 Task 18 的 Task 20 才建立。

**影響：** 無旗標的早期 Gate 可能暫時執行，但 Tasks 12／18 的完整產出尚無可引用的共同實作。各自臨時實作又可能使用不同 source／artifact／toolchain 範圍，直到 Task 20 才發現不能使用它們的 evidence；只把傳入字串回填也不符合「重算驗證」承諾。

**最小修正：** 將 identity schema、計算 helper 與基本 contract 提前到第一個 consumer 之前；Task 20 保留彙集證據、seal／verify manifest 的責任。同步列出 Tasks 12／18 的 consumes 與 Task 20 的覆用關係，不必改動穩定任務編號。

**修訂後驗收：**
- [ ] 在尚無 Task 20 portfolio 實作時，M0/M1 已可測試正確 identity 與錯誤 identity 的兩條分支。
- [ ] 各 Gate 與 sealing 共用同一計算規則，不能以單純 echo 傳入 ID 形成證據。
- [ ] Task 20 仍重新建立最終版本所需證據，不能因 helper 前移而沿用舊 build 的模型結果。

### R25 — P2：僅有 MetricEvent[]，無法判斷整組來源事件缺失

**計畫證據：** P₃:192–206、261、317、1080、1120–1129、1630–1631、1664–1683。

**設計依據：** S:645–666、890–897。

最新計畫已正確區分 `measured / not_applicable / missing`，但 `projectMetricEvents(events)` 與 `aggregateMetrics(events)` 都只接 `MetricEvent[]`。Task 30 又要求「canonical state 證明未發生」才可 N/A；該 state／expected activity inventory 沒有成為兩個介面的輸入，也沒有指定等效的完整性事件。

**不可區分的情境：**

| Canonical 活動 | 傳入 reducer 的 compaction events | 應有結果 |
| --- | --- | --- |
| 未發生 compaction | 空集合 | duration 為 N/A，計數可為 0 |
| 確實做過 compaction，但整組 metric producer 漏記 | 空集合 | missing，不能宣稱資料完整 |

兩者可提供完全相同的事件陣列；pure events-only reducer 不可能憑該輸入給出兩個正確答案。跨 domain 的保護與「只缺完成事件」的配對檢查也不能解決整組漏記。

**最小修正：** 由 State 在同一 snapshot sequence 提供必要的 expected activity／metric coverage context，讓 shared projector 與 reporting 消費；或把該權威 coverage 作為有明確 producer 的輸入事件。需指定其來源及與業務活動記錄的原子關係，不能由摘要自報完整。

**修訂後驗收：**
- [ ] 用同一 metric event array、不同 canonical activity/coverage 的兩個案例，分別得到 N/A 與 missing。
- [ ] 整組刪除 compaction 或 recovery metrics，但保留業務活動證據時，不能得到無缺項報告／formal pass。
- [ ] Fake-clock fixture 列出實際起訖 ticks／owner duration，從原始輸入重算既有 80/40/15/120 ms，而非只驗證 helper 的摘要數字。

### R26 — P2：`blocked_runtime` 被錯置為 run state

**計畫證據：** P₃:186、236、778–779。

**設計依據：** S:406–408、419–421、674、686。

Task 11 的測試預期：

```ts
{ newMutationOwners: 0, runState: "blocked_runtime" }
```

但上層設計的 `run_state` 只有 `draft/prepared/starting/admitting/running/interrupted/finalizing/completed/failed/invalid/aborted`；`blocked_runtime` 是 `solve_state` 的值。Task 2 同時要求精確沿用設計 enum。

**影響：** 忠實使用 canonical schema 的實作不能滿足此測試；若為了使 `toMatchObject` 通過而在 helper 加一個自由字串欄位，又掩蓋真實型別錯誤。

**最小修正：** 將 fixture 分別斷言合法 run state、具名 blocker/integrity reason 與 `newMutationOwners: 0`；例如 live 保留 `interrupted` 並記錄 `old_execution_not_stopped`，formal 依設計為 `invalid`。不要為了測試增加未經確認的 run enum。

**修訂後驗收：**
- [ ] Recovery test 的輸出先經 Task 2 canonical Run schema 驗證，再檢查狀態與原因。
- [ ] Live 與 formal 的未證明停止分支分別測試，且兩者都不建立新 mutation owner。

## 15. 建議修訂順序

1. **先補 M0 的執行邊界：** R20 的 spawn/registration、R21 的所有 mutator 接合、R23 的 adapter operation context，避免各 package 各自通過但整合失效。
2. **接通 M1 的真實續跑：** R22 的 Worker reacquire/session binding；R24 的 identity helper 前移，R25 的 coverage context 亦需在首次模型 Gate 前完成。
3. **順手修正明確型別錯誤：** R26 可直接對照現行設計修訂，無需新架構決策。

本輪不建議重做已補好的 consumable/capacity 區分、動作級 budget gate、freeze 前完整 live harness 或模型 provenance 規則。需要增加的是具名接合點及能覆蓋上述窗口的測試，而不是更多只有成功摘要的 Gate。

## 16. 第三輪核對與交付記錄

- 已讀取 P₃ 的全部任務、S 的完整現行設計與前兩輪 review，並對 mutation、reservation、Worker release/continuation、adapter、build identity、metrics 和狀態 enum 做內容檢索。
- 核對 33 個任務 ID 保留，無已勾選步驟；未發現產品程式 workspace。沒有把文件中的測試範例當成已執行產品測試。
- 無檔案副作用的 Node 語義反例確認：`blocked_runtime` 不屬 run enum；登記集合為空仍可滿足 registered-process 斷言而存在未登記 child；相同 metric events 可對應兩種不同 coverage；released Worker reservation 不能當作 occupied ownership。這些運算只核對契約反例，不驗證尚未存在的產品行為。
- 未因 keyword closure 或文件結構檢查通過而認定 R16/R18 完全閉合。OpenCode 公開 hook、host/Core 實際停止與真實模型／平台結果仍由其實作 Gate 證明。
- 本輪僅追加此 review 並更新頁首導覽；plan/design 保留本輪開始時的內容，既有未提交變更不還原。交付前以 `git diff --check`、差異審閱及第 12.1 節 hash 比對確認。
