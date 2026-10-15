# 通用 CTF Agent 實施計畫審計

審計日期：2026-10-15

審計結論：**Changes requested——主架構方向符合已確認設計，但尚不適合按現有順序直接逐項執行。**

## 1. 範圍與證據基準

- **P／被審計計畫：** [`2026-10-15-general-ctf-agent-system-implementation.md`](../plans/2026-10-15-general-ctf-agent-system-implementation.md)，共 1,363 行、33 個任務標題，包含 Task 26A–26C。
- **S／現行設計基準：** [`2026-10-14-general-ctf-agent-system-design.md`](../specs/2026-10-14-general-ctf-agent-system-design.md)，2026-10-15 修訂，共 992 行。
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
