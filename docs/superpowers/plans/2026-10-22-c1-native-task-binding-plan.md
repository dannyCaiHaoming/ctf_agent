# C.1 原生 task 子會話綁定時序：無模型驗證計劃

記錄日期：2026-10-22（Asia/Tokyo）。

依據：[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）C、C.1、H 與第 3 節第一項待決項；[現狀、教訓與遷移記錄](../specs/2026-10-22-ctf-agent-current-state-and-migration.md) 第 2 節、3.4、3.5。

本文是交給實作模型（Haiku 5.5）的 §0 交接物。實作模型照 §0 做完、寫報告後停下；**結論由 Opus 5.5 讀報告後寫回 design v1，實作模型不改 design v1、不改本文。**

---

## §0 當前卡點與這一步要做的事

卡點：design v1 C.1——宿主能否在原生 `task` 子會話第一次模型請求與工具操作之前，取得可信父子關係和實際角色，完成綁定與共享預算准入。現有控制層只綁定一個根會話（`OpenCodeTask.control` 拒絕其他 session ID；插件 `tool.execute.before` 拒絕全部非受管工具，含 `task`），從未在真實 OpenCode 上觀察過子會話。這一步只做**觀察與判據收集**，不實作產品功能。

### §0.1 授權範圍

| 項目 | 本步授權 |
| --- | --- |
| 真實模型調用 | **不允許**。token 預算為 0。任何對外 provider 請求都算違規並立即停止（見 §0.7） |
| provider | 只允許 §0.4 的本地確定性替身（loopback HTTP）；不接任何真實 provider、不讀取任何真實 key |
| 靶場／平台 | 不接 |
| 運行 OpenCode | 允許：只運行本機已安裝的固定版本 `opencode` 1.19.3（`~/.opencode/bin/opencode`），經 `startManagedOpenCode` 啟動、隔離 HOME |
| 程式修改 | 只允許在 `scratch/c1-probe/` 下**新增**臨時檔（§0.3）。不改任何既有檔 |
| 刪除 | 不允許刪除任何文件 |
| 依賴安裝 | 不允許 `npm ci`／`npm install`／下載任何東西 |
| commit／push | 不允許 |

### §0.2 工作區

1. 在自己的 git worktree 中工作（基於 `main` 的 `f101abd` 或其後的 main），不在主工作區 `/Users/caihaoming/Documents/pentest-agent` 寫任何檔。
2. worktree 沒有 `node_modules`：建立符號連結 `<worktree>/node_modules -> /Users/caihaoming/Documents/pentest-agent/node_modules`，只讀使用。不在主工作區執行任何寫入命令。
3. 開工先記錄：`git -C <worktree> rev-parse HEAD`、`opencode --version`（必須輸出 `1.19.3`，否則停下報告）、`node --version`、`node_modules/@opencode-ai/plugin/package.json` 與 `@opencode-ai/sdk` 的 version（目前為 1.19.0，與 binary 版本不同，照實記錄）。

### §0.3 改哪些檔

只新增以下檔案，全部位於 `<worktree>/scratch/c1-probe/`（此路徑不在 `tsconfig.json` 與 `vitest.config.ts` 的 include 範圍，不影響既有 typecheck／test）：

| 檔案 | 用途 | 約束 |
| --- | --- | --- |
| `probe-plugin.ts` | OpenCode 插件。對 §0.5 列出的每個 hook：把 hook 名、`sessionID`、`agent`、`callID`、`tool`、完整 input 的鍵名清單、task 工具的 `args`，POST 到 harness 的 loopback `/hook`，**await** 回覆；回覆為 deny 時 `throw`。`chat.params` 依回覆設定 `maxOutputTokens`。`chat.headers` 加 `x-c1-session: <input.sessionID>`。另註冊一個自訂工具 `probe_whoami`（參數 `claimed_role: string`），執行時把 `context.sessionID`、`context.agent` 與 `claimed_role` 送 harness，回傳 harness 綁定的身份 | 只 import node 內建模組與 `@opencode-ai/plugin`；不 import `@ctf/*`；token 經插件 options 傳入，長度 ≥ 32；只連 `127.0.0.1` |
| `stub-provider.ts` | 本地確定性 OpenAI-compatible SSE 替身。按請求 body 中 system 內容的角色標記（`C1_ROLE_MARKER:<role>`）與該 session 的請求序號選腳本（§0.4）；支持一則回應內多個 `tool_calls`；每則回應帶固定 usage（prompt 20、completion 5）；記錄每個請求的序號、時間、`x-c1-session` header、角色標記、body sha256、body 是否含 `C1_PARENT_PRIVATE_MARKER` | 只監聽 `127.0.0.1:0`；對腳本外請求回固定文字 `Finished.` 並在記錄中標 `unscripted: true` |
| `harness.ts` | 啟動 stub、hook 接收端、綁定器（binder）與帳本（ledger）；用 `@ctf/opencode-bridge` 的 `startManagedOpenCode`（只 import、不修改）啟動真實 OpenCode；用其回傳的 SDK client 建立根會話、`promptAsync`、`session.get`、`session.children`、`session.messages`、`session.abort`，並訂閱 SDK 事件流記錄 `session.created`、`message.part.updated`（task 工具部件的 `state.metadata`）等事件；逐場景寫證據 | 以 `node --import tsx scratch/c1-probe/harness.ts --scenario <ID>` 運行；每場景獨立 OpenCode 實例與獨立臨時目錄；每場景 wall clock 上限 60 秒，超時即 kill 並記為該場景未完成 |
| `REPORT.md` | 收尾報告（§0.8） | — |
| `evidence/<場景ID>/…` | 原始證據（§0.8） | 不含任何秘密值 |

**綁定器規則（被驗證的候選機制，照寫，不自行改良）：**

- 角色表：`coord` 可分派 `solver`、`verifier`；`solver`、`verifier`、`reference` 不可分派任何角色。
- 根會話：harness 用 SDK 建立後立即綁定為 `coord`（這是宿主自己建立的會話，非待驗項）。
- 分派登記：收到 `tool.execute.before` 且 `tool === 'task'`、`sessionID` 為已綁定會話時：若該角色不允許分派 `args.subagent_type`，deny；若 `args.task_id` 存在且不是「由同一父會話分派、同一角色、仍綁定中」的子會話，deny；否則登記 pending dispatch `{parentSessionID, callID, subagent_type}`。
- 子會話綁定：收到任何 hook 帶有未知 `sessionID` 時，harness 先以 SDK `session.get` 取得 `parentID` 與 `agent`；僅當 `parentID` 是本 run 已綁定會話、且存在該父會話未消費的 pending dispatch 其 `subagent_type === agent` 時綁定（消費該 pending），否則 deny。若事件流中已出現 task 部件 `metadata.sessionId` 指向此 session，同時記錄其 `callID` 對應關係。
- 准入：每次 `chat.params` 為一次模型調用准入，從共享帳本原子扣 1；餘額為 0 則 deny。`tool.execute.before`（含原生工具）對未綁定、已撤銷、已取消或已過 deadline 的會話 deny。
- 撤銷／取消：harness 可對會話標記 revoked；取消父會話時，用 `session.children` 列舉全部子會話逐一 `session.abort` 並標記 canceled。

配置（每場景相同，個別場景另註）：只有 provider `stub`（`@ai-sdk/openai-compatible`，baseURL 指向 stub，apiKey 用 `{env:C1_STUB_KEY}`，值為固定非秘密字串 `c1-stub-not-a-secret`）；`enabled_providers: ["stub"]`；`model` 與 `small_model` 都是 `stub/scripted`；agents：`coord`（primary，`permission.task` allow）、`solver`（subagent，允許 `probe_whoami`、`read`）、`verifier`（subagent，只允許 `read`）、`reference`（subagent）；每個 agent 的 prompt 含 `C1_ROLE_MARKER:<role>`；插件只載入 `probe-plugin.ts`。根會話首則使用者訊息含 `C1_PARENT_PRIVATE_MARKER`。

### §0.4 場景

stub 腳本以「角色 / 該 session 第 n 次請求」描述。

| ID | 做法 | 主要回答 |
| --- | --- | --- |
| S1 單子會話 | coord#1：`task {subagent_type:"solver", description, prompt}`；solver#1：`probe_whoami {claimed_role:"verifier"}`；solver#2：`read` 一個 harness 預先放在工作目錄的 `c1-probe.txt`；solver#3：文字；coord#2：文字 | Q1、Q2、Q3c、Q7 |
| S2 越權分派 | coord#1：`task {subagent_type:"reference"}`（角色表不允許）。另一次子運行：coord#1 派 solver，solver#1 嘗試 `task {subagent_type:"verifier"}` | Q3a |
| S3 task_id 劫持 | coord#1 派 verifier（verifier#1 文字結束）；coord#2：`task {subagent_type:"solver", task_id:<從上一個 task 工具輸出中解析出的 verifier session id>}`。另一子運行：`task_id` 用 harness 以 SDK 另建的無父根會話 id | Q3b |
| S4 未綁定會話 | harness 以 SDK `session.create({parentID:<coord>, agent:"solver"})` 建立會話並 `promptAsync`，沒有任何 task 分派 | Q4a |
| S5 取消傳播 | coord 派 solver；stub 收到 solver#2 後延遲 5 秒再回應；延遲期間 harness 對 coord 執行 `session.abort`，再按綁定器規則取消全部子會話。子運行 S5b：stub 收到 solver#1 時先通知 harness 撤銷該 solver，再回應 `probe_whoami` 工具調用 | Q4b、Q6 |
| S6 deadline | 子會話綁定時 deadline = 綁定時刻 + 2 秒；stub 對 solver#1 延遲 3 秒再回應 `probe_whoami` 工具調用 | Q4b、Q6 |
| S7 並行與共享預算 | 帳本總額 3 次模型調用。coord#1 在**同一則回應**中發兩個 `task` 工具調用（solver、verifier）；solver 腳本需 2 次、verifier 需 1 次、coord 收尾需 1 次（總需 5） | Q5、Q6 |
| S8 SDK 備案原語 | harness 以 SDK `session.create({parentID:<coord>, agent:"verifier", permission:<只允許 read>})`；等 2 秒，期間該 session 不得出現任何 hook 或 stub 請求；然後綁定、`promptAsync`；verifier#1 回 `read` 工具調用，verifier#2 文字；結束後 `session.abort` 並確認其後無請求 | 分支 2／3 判別 |
| S9（補充） | 環境加 `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`（經 `startManagedOpenCode` 的 `environment` 傳入），coord#1 `task {…, background:true}`，其餘同 S1 | 只記錄限制，不入分支判定 |

### §0.5 要回答的問題與行為判據

每個場景記錄所有 hook 的接收順序（harness 單調序號）。需觀察的 hook：`event`、`chat.message`、`experimental.chat.system.transform`、`experimental.chat.messages.transform`、`chat.params`、`chat.headers`、`tool.execute.before`、`tool.execute.after`、`permission.ask`。

「子會話的請求」以 stub 記錄中 `x-c1-session` 等於該子會話 id 認定；若 `chat.headers` 從不觸發，改以角色標記 + 時間順序認定，並在報告中標明「歸屬為推斷」。

| # | 問題（取自 C.1） | 通過 | 不通過 |
| --- | --- | --- | --- |
| Q1 | 宿主能否在子會話**第一次模型請求前**完成綁定與預算准入 | S1、S7 的每個子會話：binder 的 `bound` 記錄序號 < 該子會話 `chat.params` 准入記錄序號 < stub 收到該子會話第一個請求的時間；且不存在任何 stub 請求早於其會話的准入記錄 | 任一子會話的 stub 請求早於綁定或准入；或子會話第一次請求前沒有任何帶其 `sessionID` 的 hook 觸發 |
| Q1' | 同上，**第一次工具操作前** | S1 中 `probe_whoami` 與 `read` 的 `tool.execute.before` 都在綁定之後，且帶子會話 id | 子會話的原生或自訂工具執行沒有經過帶子會話 id 的 `tool.execute.before` |
| Q2 | 能否取得**可信父子關係與實際角色** | 綁定時 SDK `session.get` 回傳的 `parentID` 等於 coord id、`agent` 等於分派的 `subagent_type`，且與 `chat.message`／`chat.params` input 中的 `agent` 一致；這些值在子會話第一次 hook 時已可取得 | `parentID` 或 `agent` 在第一次 hook 時缺失、與分派參數不符，或只能從模型可控內容（prompt、工具參數）得到 |
| Q3a | 越權分派能否被阻止 | S2：`reference` 分派在 `tool.execute.before` 被 deny，事件流與 `session.children` 中無新子會話或新子會話零 stub 請求；solver 的巢狀 task 被 OpenCode 原生（depth／permission）或 binder 拒絕，零新子會話請求 | 被拒角色的子會話產生任何 stub 請求或工具執行 |
| Q3b | `task_id` 能否被用來冒充／劫持 | S3：兩個子運行中帶非法 `task_id` 的 task 調用在 `tool.execute.before` 被 deny，被指向的會話其後零新 stub 請求。另記錄 OpenCode 對該 `task_id` 的原生行為（是否恢復該會話、以哪個 agent 運行、查找失敗是否靜默新建） | 非法 `task_id` 導致任何會話以錯誤角色或錯誤父關係產生 stub 請求 |
| Q3c | 角色能否被**呼叫參數**冒充 | S1：`probe_whoami` 回傳的身份是 binder 綁定的 `solver`，`claimed_role:"verifier"` 未改變綁定；`context.agent` 為 `solver` | 綁定角色隨模型提供的參數改變 |
| Q4a | 未綁定子會話是否被阻止 | S4：該會話第一個 hook 即被 deny；stub 對該會話零請求；零工具執行 | 該會話產生任何 stub 請求或工具執行 |
| Q4b | 已取消／撤銷／過期子會話是否被阻止 | S5：abort 後 solver 不再有新 stub 請求（延遲中的那個除外，須記錄其結果狀態），`session.children` 列出的所有子會話都進入 aborted／idle；S5b、S6：被撤銷或過期後的 `tool.execute.before` 被 deny、`probe_whoami` 未執行、其後 `chat.params` 被 deny | 取消、撤銷或過期後仍有新 stub 請求或工具執行；或有子會話無法由宿主列舉並停止 |
| Q5 | 並行子會話不得重複花用同一份剩餘預算 | S7：帳本准入總數 ≤ 3；stub 請求總數 == 准入總數（含 coord）；超額請求均在 `chat.params` 被 deny；另記錄兩個子會話的請求時間是否重疊（是否真並行） | stub 請求總數 > 准入總數，或准入總數 > 3 |
| Q6 | 用量回收覆蓋全部子會話 | S1、S5、S6、S7 結束後，以 SDK 遍歷根會話及 `session.children`（遞迴）的 `session.messages`，assistant 訊息 tokens 合計等於 stub 發出的 usage 合計；無遺漏會話 | 任何 stub 發出的 usage 無法歸到某個可列舉的會話 |
| Q7 | Verifier／子會話上下文隔離 | S1、S8：子會話的所有 stub 請求 body 均不含 `C1_PARENT_PRIVATE_MARKER` | 子會話請求含父會話私有標記 |
| G | 不存在未准入的模型請求 | 全部場景：stub 每個請求都對應一條在它之前的 `chat.params` 准入；含標題／摘要等由 OpenCode 自行發出的請求 | 出現沒有對應准入的請求（無論來源，逐條列出其角色標記與 body 摘要） |

S8 的判據（分支 2／3 判別用）：

| # | 通過 | 不通過 |
| --- | --- | --- |
| K1 先建後跑 | `session.create` 後到 `promptAsync` 前，該 session 零 hook（`event` 除外）、零 stub 請求 | 建立即觸發模型請求 |
| K2 綁定與閘門 | 綁定後 `chat.params`、`tool.execute.before` 均帶該 session id 並受 binder 准入 | 同 Q1／Q1' 不通過條件 |
| K3 取消 | `session.abort` 後零新 stub 請求、零新工具執行 | abort 後仍有請求或執行 |
| K4 隔離 | 同 Q7；且建立時傳入的 `permission` 生效（嘗試的非 `read` 工具被拒或不可見） | 含父標記，或 permission 未生效 |
| K5 計量 | 同 G 與 Q6 | 同 G 與 Q6 |

### §0.6 結果對應 C.1 三個分支

實作模型只按下表**標出候選分支**並列出依據的判據編號，不做設計結論：

| 條件 | 候選分支（C.1 表格） |
| --- | --- |
| Q1、Q1'、Q2、Q3a–c、Q4a–b、Q5、Q6、Q7、G 全部通過 | 分支 1：採原生 `task` |
| 上述任一項不通過，且 K1–K5 全部通過 | 分支 2：有界 SDK 接線 |
| 上述任一項不通過，且 K1–K5 任一項不通過 | 分支 3：架構阻塞 |
| 環境前提不成立（binary 非 1.19.3、插件未載入、stub 從未收到請求、§0.7 停止條件觸發） | 不給分支，報告「未完成」及原因 |

另須在報告中單列（不改變上表，供 Opus 判斷）：通過是否依賴 `experimental.*` hook；binder 在 hook 中是否必須同步回查 SDK、回查耗時；`chat.headers` 是否觸發；`permission.ask` 是否觸發；S9 的觀察。

### §0.7 確保沒有真實模型請求

1. 配置只含 `stub` provider 並設 `enabled_providers: ["stub"]`；`model`、`small_model` 都指向 stub。
2. 經 `startManagedOpenCode` 啟動：HOME／XDG 全部指向臨時目錄，env 由 `safeEnvironment` 重建，不帶入宿主的 provider key。
3. harness 啟動前設定 `HTTP_PROXY=HTTPS_PROXY=ALL_PROXY=http://127.0.0.1:9`、`NO_PROXY=127.0.0.1,localhost`（`startManagedOpenCode` 會把這四個變數傳給 OpenCode），使非 loopback HTTP 失敗。
4. harness 開跑前檢查：臨時 data 目錄下不存在 `auth.json`；配置序列化後不含 `stub` 以外的 provider id。
5. **停止條件**：任一場景出現 G 不通過且該請求不是送到 stub（例如 OpenCode 日誌或錯誤中出現外部 provider 主機名、或 SDK 回傳的 assistant 訊息 `providerID` 不是 `stub`），立即停止全部後續場景，報告原文證據。

### §0.8 收尾報告與證據

證據放在 `<worktree>/scratch/c1-probe/evidence/<場景ID>/`：

- `hooks.jsonl`：harness 收到的每個 hook（序號、時間、hook 名、sessionID、agent、callID、tool、input 鍵名、task args、binder 決定與原因）。
- `stub-requests.jsonl`：stub 每個請求（序號、時間、`x-c1-session`、角色標記、body sha256、是否含父標記、回應腳本 id、是否 unscripted）。
- `ledger.jsonl`：綁定、准入、拒絕、撤銷、取消記錄。
- `events.jsonl`：SDK 事件流中與會話、task 部件相關的事件。
- `sessions.json`：結束後 SDK 的根會話、遞迴 children、各會話 `parentID`／`agent`／`permission`、messages 的 info（不含模型可讀秘密，本步也不存在秘密）。
- `env.json`：OpenCode 版本、插件／SDK npm 版本、node 版本、HEAD、配置（apiKey 只記 env 引用名）。

`<worktree>/scratch/c1-probe/REPORT.md` 必含：

1. 環境前提記錄（§0.2 第 3 點）與 §0.7 第 4 點檢查結果。
2. 每個場景：是否完成；關鍵 hook／請求時間線（序號表，只列與判據相關的行）。
3. §0.5 每個判據：通過／不通過／未能判定，附證據檔與行號；推斷與直接觀察分開標註。
4. OpenCode 原生行為觀察：`task_id` 恢復行為、巢狀 task 拒絕方式、parent abort 對子會話的傳播、是否真並行、標題／摘要請求、各 hook 實際 input 鍵名與 1.19.0 類型定義的差異。
5. §0.6 的候選分支與依據；§0.6 末段的單列事項。
6. 失敗、超時、未完成的場景及原因，原樣記錄，不重跑掩蓋。
7. worktree 絕對路徑與 `git status` 輸出（應只有 `scratch/c1-probe/` 與 `node_modules` 連結為未追蹤）。

臨時代碼的處理：`scratch/c1-probe/` 只作為本次證據，不合入 main、不移入 `apps/`／`packages/`、不作為後續實作的起點。報告完成後保留在 worktree 原地，由 Opus 5.5 讀完後與使用者決定刪除 worktree 或摘錄必要證據；實作模型不自行刪除。

### §0.9 禁做清單

- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；`scratch/c1-probe/` 以外不新增任何檔；不把 probe 寫成可重用測試或接入 `npm test`。
- 不新建直連 provider 的求解循環，不維護 OpenCode fork，不修改 OpenCode binary 或 `node_modules`。
- 不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench。
- 不改控制層既有行為：不修改 `apps/opencode-plugin`、`packages/opencode-bridge`、`apps/cli`、`packages/*` 任何檔；只允許 import 調用 `startManagedOpenCode`。不重構。不刪除任何文件。
- 不調用真實模型、不接任何 provider、不接靶場或平台；不讀取或傳遞任何真實憑據。控制憑據（OpenCode server password、hook RPC token）不寫入 stub 回應、agent prompt 或證據檔。
- 不用手寫事件、偽造的 session ID 或 mock 的 OpenCode 證明任何判據；所有 session ID、parentID、agent、hook 順序必須來自真實 OpenCode 1.19.3 運行。stub 只替代 provider 的回應內容。
- 不為讓判據通過而修改 §0.3 的綁定器規則、角色表或 §0.5 判據；規則不夠用時記錄為發現。
- 驗收按 design v1 1.6 分層陳述：本步只陳述「確定性工具接線／時序」層，不聲稱多 Agent 協作或解題能力。
- 不改 design v1、本文、`AGENTS.md`、`CLAUDE.md`；不 commit、不 push；不 stash、reset、切換主工作區分支。
- 寫完 `REPORT.md` 就停，不開始任何後續實作。
