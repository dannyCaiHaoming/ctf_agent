# C 探針報告：子會話綁定與預算准入（無模型）

執行日期 2026-10-23。執行模型 Sonnet 5.5。token 預算 0，只用 loopback 替身 provider。
證據路徑均相對於 `scratch/c-probe/evidence/`；`timeline.jsonl:N` 指第 N 行，**行號 = 全局序號 seq**（harness、hook、綁定、替身請求共用同一個遞增序號，同一場景內可直接比大小）。「直接觀察」＝證據檔中的記錄；「推斷」＝由記錄推出。

## 1. 環境記錄

| 項 | 值 |
| --- | --- |
| worktree | `/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/serene-cori-37ea6f`（分支 `claude/serene-cori-37ea6f`） |
| HEAD | `90ffb83f41084f9c4d3474572abdd10dde68a61b` |
| `opencode --version` | `1.19.3`（`~/.opencode/bin/opencode`；`startManagedOpenCode` 也以此校驗，各場景 `checks.json` `opencodeVersion`） |
| node | v26.3.0 |
| `@opencode-ai/plugin` / `sdk` | 1.19.0 / 1.19.0（`package.json` 依賴；hook 類型定義即此版本） |
| node_modules | worktree 內已有真實目錄，只讀使用，未安裝／修改 |
| 啟動方式 | `cwd=/tmp/cprobe-cwd`（倉庫外，無 `.env`）；`TSX_TSCONFIG_PATH=<worktree>/tsconfig.json node --import <worktree>/node_modules/tsx/dist/loader.mjs <worktree>/scratch/c-probe/harness.ts --scenario <ID>`（啟動包裝腳本在 `/tmp/cprobe-run.sh`，倉庫外，未入庫） |
| run 目錄 | `realpath(os.tmpdir())/c-probe-<場景>-XXXXXX/{opencode,workspace}`，如 S1 的工作區 `/private/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/c-probe-S1-fKdBo7/workspace`（見 `S1/sessions.json` 的 `read` 輸出）。倉庫外，未刪除 |
| §0.3 第 6 點 | harness 在 `startManagedOpenCode` 之前設 `HTTP_PROXY=HTTPS_PROXY=ALL_PROXY=http://127.0.0.1:9`、`NO_PROXY=127.0.0.1,localhost`；`startManagedOpenCode` 的原始碼（`packages/opencode-bridge/src/server.ts` 第 73 行）會把這四個變數複製進 OpenCode 環境。**未對運行中進程做 `ps -E` 核對**，屬由原始碼推斷。工作目錄 `/tmp/cprobe-cwd` 無 `.env`；harness 未讀取任何憑據檔 |
| 配置 | 只有 provider `stub`（`@ai-sdk/openai-compatible`，baseURL 為 loopback 隨機埠），`enabled_providers:["stub"]`，`model`／`small_model`＝`stub/scripted`，apiKey＝`{env:C_PROBE_PROVIDER_KEY}`（固定非秘密字串）；內建 agent `build/plan/general/explore/title/summary/compaction` 全部停用；權限一律 allow／deny，**無 `ask`、無 `--auto`**；唯一插件為 `probe-plugin.ts`（RPC 只連 `127.0.0.1`，傳輸憑據隨機 48 hex，不入證據） |

**偏離／補充（如實記錄）**
1. verifier 角色也加了 `external_directory` 對工作區 allow（plan 只明說 solver）。S8 的 verifier 需要讀工作區文件，否則 `read` 在 `external_directory` 層被拒。
2. S8 的 `permission` 不只是「只允許 read」：為了分辨「會話層權限」與「角色層權限」，加了 `read *secret.txt deny`（見 B4）。
3. 增加了兩個**補充場景**（不影響 plan 的場景）：**S3c**（合法的 `task_id` 恢復自己的子會話，用來記錄 OpenCode 原生 `task_id` 行為）、**S6w**（與 S6 完全相同，只把 harness 的額度拒絕理由字樣由 `quota exhausted` 改為 `budget denied`，見 §6 的 S6 超時）。
4. S2b 中 solver 沒有 `task` 權限（plan 的角色定義如此），因此其 `task` 調用被 OpenCode 的**可見性層**攔截，從未到達 `tool.execute.before`（見 V2）。

## 2. 場景完成情況

每個場景（子運行）各自獨立的 OpenCode 實例與 run 目錄。

| 場景 | 完成 | 備註 |
| --- | --- | --- |
| S1 | 完成（約 2.5 s） | 替身 5 個請求，全部有准入；見下 |
| S2a / S2b | 完成 | |
| S3a / S3b | 完成 | |
| S3c（補充） | 完成 | |
| S4 | 完成 | |
| S5a / S5b / S5c | 完成 | |
| S6 | **超時（90 s）** | 原樣記錄，見 §6 |
| S6w（補充） | 完成 | |
| S7 | 不單獨運行 | 如 plan，沿用 S1、S6（及 S6w）運行結束後以 SDK 遞迴列舉會話與訊息（`sessions.json`、`messages-*.json`、`checks.json` 的 `sdkUsageTotal`） |
| S8 | 完成 | |

### 時間線（序號表；S1，`S1/timeline.jsonl`）

| seq | t(ms) | 事件 |
| --- | --- | --- |
| 2 | — | 根會話（SDK 建立）登記為 `coord`（先於 `promptAsync`） |
| 6 | | 根會話 `chat.message`（hook input 帶 `agent:"coord"`） |
| 25 | | 替身收到 coord#1（含 `C_PARENT_PRIVATE_MARKER`） |
| 27–28 | | coord 的 `tool.execute.before(task)`，binder 登記待綁定分派（`dispatch registered`） |
| 31 | | **子會話第一個 hook**：`chat.message`（`agent:"solver"`，帶子會話 ID） |
| 34 | | binder 在該 hook 內以 `session.get` 取得 `parentID`、`agent` 後綁定（`sdkMs`=43） |
| 48 | | solver 首次 `chat.params` 准入（admitNo 2） |
| 51 | | 替身收到 solver#1 |
| 53–54 | | solver 首個 `tool.execute.before`（`probe_whoami`），放行 |
| 55–56 | | `probe_whoami` 執行（`tool.execute` RPC），回傳 `bound_role=solver` |
| 74 / 95 | | solver#2（`read`）／solver#3（文字）請求 |
| 122 | | coord#2 請求 |

## 3. 判據結論

| # | 結論 | 依據（證據檔：行號） |
| --- | --- | --- |
| **V1 綁定時序** | **成立**（S1、S6，及其他全部有子會話的場景） | 直接觀察。S1 子會話 `…lgy4`：綁定 `S1/timeline.jsonl:34` < `chat.params` 准入 `:48` < 替身首個請求 `:51`；第一次工具 `tool.execute.before` `:53–54` 在綁定之後且帶子會話 ID；綁定記錄帶 `sdkParentID`＝根會話、`sdkAgent:"solver"`（`:34`），`session.get` 在子會話第一個 hook（`chat.message`，`:31`）內即返回正確的 `parentID`／`agent`。S6 兩個並行子會話：solver 綁定 `S6/timeline.jsonl:39` < 准入 `:63` < 替身 `:69`；verifier 綁定 `:47` < 准入 `:71` < 替身 `:74`。子會話在綁定前只收到 `event`（`session.created`、`session.updated`）與觸發綁定的 `chat.message` 本身（`checks.json` 由 /tmp 分析腳本核對，S1 `:31`–`:34`） |
| **V2 角色不可冒充** | **成立（有保留）** | 直接觀察。S1：模型呼叫 `probe_whoami {claimed_role:"verifier"}`（`S1/timeline.jsonl:55` `claimed_role`），回傳 `bound_role=solver`（`S1/sessions.json` solver 的 `probe_whoami` 輸出），綁定表中該會話仍為 `solver`（`checks.json` `entries`）。hook input `agent` 與 SDK 返回一致：每個子會話的綁定都做了比對，無 `agent mismatch` 拒絕（`bind_refused` 在 S1–S3、S5、S6 無此類記錄）。S2a：coord 分派 `reference` 在 `tool.execute.before` 被拒（`S2a/timeline.jsonl:28` `dispatch table: coord may not dispatch reference`），其後沒有任何新子會話、`sessions.json` 只有根會話。**保留**：S2b 的「solver 嘗試 `task` 分派 `verifier`」**沒有到達 `tool.execute.before`**——solver 的權限不含 `task`，OpenCode 把該調用轉成 `invalid` 工具並報 `Model tried to call unavailable tool 'invalid'. Available tools: probe_whoami, read.`（`S2b/sessions.json` solver 的 `task` 部分），`S2b/timeline.jsonl` 中 solver 完全無 `tool.execute.before`。因此「執行許可」層對越權 `task` 的拒絕在此場景**未被觸發**，僅觀察到可見性層攔截。若可見性設定出錯（solver 被賦予 `task`），此探針沒有證據說明分派表能攔住 |
| **V3 `task_id` 不可劫持** | **成立（原生行為只部分記錄）** | 直接觀察。S3a：coord 以已完成的 verifier 的會話 ID 作 `task_id` 並要求 `subagent_type:solver`，在 `tool.execute.before` 被拒（`S3a/timeline.jsonl:81` `task_id not owned / role mismatch / inactive`）；目標 verifier 其後零新請求（`checks.json` `perSession` 該會話 `stubReqs:1`，只有分派時的 n=1）。S3b：`task_id` 為 harness 以 SDK 另建的無父會話，同樣被拒（`S3b/timeline.jsonl:29`）；該外來會話 `stubReqs:0`、`bind:null`、無任何非 event hook。**原生行為（S3c，補充，binder 在 `subagent_type` 與角色一致時放行）**：帶有效 `task_id` 時 OpenCode **恢復同一個會話**（`S3c/timeline.jsonl:83` 同一 verifier 會話 ID 再收到 `chat.message`，`:99` 同一會話的 n=2 請求；`task_after` metadata `sessionId` 相同，`:107`）；以原 agent（verifier）運行；已綁定會話不再消費待綁定分派（恢復時 binder 未登記新分派）。**未觀察到**：`task_id` 與 `subagent_type` 角色不符時 OpenCode 是否改用該會話原角色、`task_id` 不存在時是否靜默新建——這兩種情形被 binder 在 hook 層拒絕，沒有放行，故沒有原生行為記錄 |
| **V4 未分派會話被阻止** | **成立** | 直接觀察。S4：SDK 以 `session.create({parentID, agent:"solver"})` 建立並 `promptAsync` 後，其第一個非 event hook `chat.message` 即被拒（`S4/timeline.jsonl:41` `bind_refused … pendingFound:false`、`:42` `unbound`）；替身全程只有 coord 的 1 個請求（`checks.json` `stubRequests:1`）；該會話 `stubReqs:0`、無工具 hook、`sessions.json` 該會話 `assistantMessages:0`。`promptAsync` 本身仍返回成功，會話以 `session.error` 事件結束（`:43`） |
| **V5 停止與撤銷有效** | **成立（有保留）** | 直接觀察。**S5a 停止**：binder 先標記（`S5a/timeline.jsonl:74`）再 `session.abort`（`:89`），標記對象為 `session.children` 遞迴列舉的全部會話（根＋1 子，`stop_marked.sessions`）；之後無新請求（總共 3 個，最後一個是被延遲的 solver#2，`:72`，停止前已發出）；延遲請求的 `probe_whoami` 沒有執行（無 `tool.execute.before`/`tool.execute`），solver 訊息只有一個已完成的 `read` 與一個 `MessageAbortedError`（`S5a/sessions.json`）。延遲請求本身在 OpenCode 側被中止，替身沒有記錄到該請求的完成（`stub_res_end` 只有 `:26`、`:52`；該 run 在 3.7 s 結束，早於替身 5 s 延遲，所以不能由此判斷替身是否曾向已關閉連線寫入）。**S5b 撤銷**：替身收到 solver#1 時先撤銷（`S5b/timeline.jsonl:51`），其後 `probe_whoami` 的 `tool.execute.before` 被拒（`:55` `revoked`），`probe_whoami` 未執行，下一次 `chat.params` 被拒（`:68`）。**S5c 到期**：綁定 2 s 後（綁定 `ttlMs:2000`，`S5c/timeline.jsonl:34`），延遲 3 s 的回應到達時 `tool.execute.before` 被拒（`:54` `expired`），`chat.params` 被拒（`:67`）。保留：S5a 中正在執行的 `task`（根會話一側）以 `Tool execution aborted` 結束 |
| **V6 不重複花用** | **成立** | 直接觀察。S6（額度 3）：准入 3 次（`S6/checks.json` `admits:3`，`ledgerAdmits:3`），替身請求 3 個（`stubRequests:3`），`unadmittedRequests:[]`；超額的請求（solver#2 及 coord#2 的各次重試）均在 `chat.params` 被拒（`S6/timeline.jsonl` 多條 `allow:false reason:"quota exhausted"`）。兩個並行子會話的替身請求時間重疊：solver `:69` t=2440 ms，verifier `:74` t=2441 ms，各延遲 800 ms，`stub_res_end` `:75`、`:76` 同在 3242 ms。S6w 同樣：准入 3、請求 3、拒絕 2（`S6w/timeline.jsonl:103`、`:122`） |
| **V7 上下文隔離** | **成立** | 直接觀察。全部 solver／verifier 子會話請求的 `hasPrivateMarker` 均為 false（S1 `:51 :74 :95`；S6／S6w／S2b／S3a／S3c／S5／S8 的 `checks.json` `perSession.*.privateMarkerReqs:0`），而 coord 的請求均為 true（S1 `:25 :122`）。S8（SDK 先建的子會話）也為 0 |
| **V8 用量歸屬** | **成立（正常結束的運行）；中止的運行有缺口** | 直接觀察。S1：SDK 遞迴列舉 2 個會話，assistant 訊息 usage 合計 input 100／output 25，等於替身發出的 5×(20,5)（`S1/checks.json` `stubUsageTotal` vs `sdkUsageTotal`）；S6：60／15 對 60／15（3 個會話）；S6w、S8 等同。**缺口（S5a，不是 plan 要求的場景，順帶記錄）**：中止的運行 SDK 合計 20／5，替身實際完整送出的是 40／10（coord#1 與 solver#1）；coord#1 已完成回應但其訊息被後續 `MessageAbortedError` 取代，tokens 為 0（`S5a/messages-ses_…049U.json`）。即「停止時正在執行工具的訊息」usage 會丟失，計量對停止路徑偏低 |
| **V9 hook 覆蓋** | **大部分成立；`skill` 未能判定** | 直接觀察。見 §5。`chat.message`、`chat.params`、`chat.headers`、`tool.execute.before`（根會話：`task`；子會話：`read`、`probe_whoami`）、`tool.execute.after`（`task`、`read`、`probe_whoami`）對根會話與子會話都觸發；`chat.params`／`tool.execute.before` 都帶 `sessionID`。V1–V8 的全部判據只依賴非實驗接口（`chat.message`、`chat.params`、`chat.headers`、`tool.execute.before`、SDK）；`experimental.chat.system.transform` 帶 `sessionID`，`experimental.chat.messages.transform` 的 input 為空（不能按會話判斷），二者只被觀察，沒有被判據使用。**`skill` 工具沒有被任何場景調用**，所以「必要 hook 對原生 `skill` 觸發」未被驗證 |
| **B1 SDK 先建後跑** | **成立** | 直接觀察。S8：`session.create`（`S8/timeline.jsonl:38`）到綁定（`:40`）之間 2 s（`sdk_quiet_window_end` `:39`）該會話只有 `event`（`session.created`，`:37`），無任何非 event hook、無替身請求 |
| **B2 SDK 綁定與閘門** | **成立** | 直接觀察。綁定後（`:40`）`chat.message` `:43`、`chat.params` 准入（`checks.json` `perSession` `firstAdmitSeq:57`）、替身 `:60`、`tool.execute.before` `:63 :65` 均帶該會話 ID，且經 binder 判定（`hook_out`） |
| **B3 SDK 可取消** | **成立（弱）** | 直接觀察。S8 在 verifier 兩次請求都完成後才 `session.abort`（`:92` 標記 stopped，之後 abort），其後 2.5 s 窗口內零請求（`sdk_post_abort_window_end` `:95` 前無 `stub_req`）。按 plan 寫法 abort 時會話已完成，所以這**只證明 abort 呼叫不報錯、之後無活動**；進行中 abort 的有效性由 S5a 的 native 子會話證明（V5），並非 SDK 先建的會話 |
| **B4 SDK 可隔離** | **成立** | 直接觀察。建立時傳入的 `permission` 原樣出現在 `session.get`（`S8/sessions.json` 該會話 `permission`）；verifier 角色的 agent 權限允許讀任意路徑，但同一輪 `read secret.txt` 被會話層規則 `*secret.txt deny` 拒絕（錯誤訊息中的規則列表含 `{"permission":"read","pattern":"*secret.txt","action":"deny"}`），`read ok.txt` 通過——兩者差異只能來自會話層權限；請求不含父會話私有標記（`perSession.*.privateMarkerReqs:0`） |
| **G 無未准入請求** | **成立（在已停用內建標題／摘要 agent 的前提下）** | 直接觀察。全部場景 `checks.json` 的 `unadmittedRequests` 均為 `[]`，`requestsWithoutSessionHeader` 為 `[]`，`stubOther` 為 `[]`，無 `unscripted` 請求；逐條比對「每個替身請求之前有同會話一條放行的 `chat.params`」（比對算法見 `harness.ts` `unadmitted`）。無例外。**限制**：配置按 plan 停用了 `title`／`summary`／`compaction` agent，OpenCode 自發請求是否被 `chat.params` 覆蓋未被檢驗（它們沒有發生） |
| **Z 無真實模型請求** | **成立** | 直接觀察。全部場景 `providersSeen:["stub/scripted"]`、`authJsonPresent:false`、`configProviders:["stub"]`；S6（超時）也已在 stop-all 後收集到證據並符合。未做 OS 層抓包，「無外部連線」屬由代理設定＋旗標＋替身日誌的推斷 |

## 4. 候選分支

按 plan「要回答的問題」表格：

- **候選：原生 `task`（C design 第 3 節機制）。** 依據 V1（綁定早於准入與請求，且在子會話第一個 hook 內即可經 SDK 取得正確 `parentID`／`agent`）、V2–V7、V8（正常結束）、V9（非實驗 hook 足夠）全部有直接證據。
- 對該候選的**限制／待 Opus 判斷**（不構成不成立）：
  1. V2：越權 `task` 在 `tool.execute.before` 的拒絕只在 S2a（coord 分派 `reference`）被觸發；S2b 被可見性層攔截，執行許可層沒有被單獨證明。
  2. V3：`task_id` 與 `subagent_type` 角色不符、或 `task_id` 不存在時 OpenCode 的原生行為沒有放行過，所以未記錄。
  3. V9：`skill` 沒有被調用。
  4. V8：停止路徑會丟失被中止訊息的 usage（S5a）。
  5. 額度拒絕的措辭會影響 OpenCode 的重試（S6／S6w，見 §5 觀察）。
- **備案：SDK 分支原語（S8：B1–B4）全部成立**（B3 為弱證據），因此即使原生 `task` 被判不採用，SDK 分支具備「先建立、綁定、再執行、可取消、可隔離」的原語。

## 5. 單列觀察

**綁定時同步查詢 SDK 的耗時**（`bind` 記錄 `sdkMs`）：每個運行裡第一次查詢約 42–51 ms（S1 43、S2b 47、S3a 42、S5a 46、S5b 43、S5c 44、S6 51），同一時刻第二個並行綁定 12–13 ms（S6 verifier 12、S6w 13），S3c 3 ms，S4 5 ms；`handlerMs`（含串行排隊）最大 58 ms（S6 `:48`，等待前一個綁定）。

**`permission.ask`**：全部運行 0 次（`checks.json` `permissionAsk:0`，13 個運行）。權限被拒（S8 `secret.txt`、S2b 隱藏工具）由 OpenCode 直接以錯誤返回，不經 `permission.ask`。

**hook 觸發矩陣**（`hook_in` 計數，13 個運行合計；root＝根會話，child＝子會話）：

| hook | root | child | 備註 |
| --- | --- | --- | --- |
| `chat.message` | 13 | 14 | 子會話首個 hook；S3c 恢復時同一子會話再次觸發 |
| `chat.params` | 28 | 27 | |
| `chat.headers` | 23 | 18 | `chat.params` 放行後才觸發；`x-c-session` 頭被替身收到 |
| `experimental.chat.system.transform` | 28 | 27 | 實驗接口；input 帶 `sessionID` |
| `experimental.chat.messages.transform` | — | — | 無 `sessionID`（`inputKeys:[]`），共 47 次 |
| `tool.execute.before` | `task` 15 | `read` 6、`probe_whoami` 3 | |
| `tool.execute.after` | `task` 7 | `read` 5、`probe_whoami` 1 | |
| `permission.ask` | 0 | 0 | |
| `event` | 有 | 有 | 含 `session.created`、`session.updated`、`message.updated` 等；未計入判據 |

**hook 實際 input 鍵名 vs 1.19.0 類型定義（`@opencode-ai/plugin/dist/index.d.ts`）：** 觀察到的 input／output 鍵名（取自 `hook_in` 的 `inputKeys`／`outputKeys`／`metadataKeys`）：

| hook | input 鍵 | output 鍵 | 與類型定義的差異 |
| --- | --- | --- | --- |
| `chat.message` | `agent, messageID, model, sessionID, variant` | `message, parts` | 一致（類型標為可選的都出現了） |
| `chat.params` | `agent, message, model, provider, sessionID` | `maxOutputTokens, options, temperature, topK, topP` | 一致 |
| `chat.headers` | 同 `chat.params` | `headers` | 一致 |
| `tool.execute.before` | `callID, sessionID, tool` | `args` | 一致；`agent` 不在 input 中，因此工具層 hook 無法與 hook agent 交叉核對，只能靠綁定表 |
| `tool.execute.after` | `args, callID, sessionID, tool` | `attachments, metadata, output, title` | input 與類型一致；**output 多了 `attachments`**（1.19.0 類型只有 `title, output, metadata`）。`task` 的 `metadata` 鍵：`parentSessionId, sessionId, model, truncated`（可由此直接得到子會話 ID） |
| `experimental.chat.system.transform` | `model, sessionID` | `system` | 一致 |
| `experimental.chat.messages.transform` | （空） | `messages` | 一致（input 為 `{}`） |

**OpenCode 對 hook 拋錯的處理**（影響控制服務設計）：
- `chat.params` 拋錯 → 該次模型請求不發出，會話以 `UnknownError: c-probe: denied (chat.params): …` 結束，根會話看到 `task` 工具 `Subagent failed (task_id: …)`（S5b、S5c、S6w）。
- **但錯誤訊息含 `exhausted` 時 OpenCode 判為可重試**：S6 中拒絕理由為 `quota exhausted`，OpenCode 對被拒的 solver 與 coord 各做約 6 次指數退避重試（`S6/timeline.jsonl` 多條 `allow:false`，t=2255 → 65632 ms，再到 coord 的 68816 → 85251 ms），總時長超過 90 s 上限，造成超時。S6w 把理由改成 `budget denied` 後無重試，2.5 s 內完成。這是 harness 的措辭選擇，不是規則；產品實現時預算拒絕的錯誤文字需避開 OpenCode 的重試判定，或確認重試行為是可接受的（每次重試都會再問一次 `chat.params` 准入，這次被拒不扣額度）。
- `tool.execute.before` 拋錯 → 工具結果為 error，工具不執行，模型迴圈繼續（S2a、S3a、S3b、S5b、S5c）。
- 子會話在首個 hook（`chat.message`）被拒 → 無模型請求，會話以 `session.error` 結束，`promptAsync` 本身仍返回成功（S4）。
- 隱藏（無權限）工具被模型呼叫 → 變成 `invalid` 工具調用，不觸發 `tool.execute.before`（S2b）。

**其他**
- `task` 工具結果文本格式為 `<task id="ses_…" state="completed">…</task>`，含子會話 ID；`tool.execute.after` 的 `metadata.sessionId` 也含子會話 ID，`parentSessionId` 為父會話。
- 同一 `subagent_type` 的多個待綁定分派在本探針中沒有出現（S6 的兩個分派類型不同），所以「按 `subagent_type` 匹配待綁定分派」在同角色並行分派時的歧義**未被檢驗**。
- binder 在串行（單線程）處理下，S6 的兩個並行子會話綁定、准入沒有互相干擾。

## 6. 失敗、超時與重跑

1. **S1 重跑一次**：第一次運行後，我發現替身的 `stub_res_end` 記錄欄位 `seq` 覆蓋了全局序號（純 harness 記錄缺陷，與判據無關），修正為 `reqSeq` 後，**刪除了第一次的 `evidence/S1/` 並重跑**（此時尚未開始正式收集結論，場景、判據、binder 規則均未改）。這與 plan「不重跑掩蓋」不完全一致，在此如實說明；兩次結果一致（5 個請求、全部准入、`bound_role=solver`）。其餘場景均在修正後運行，無此問題。
2. **S6 第一次運行超時**（90 s）：harness 當時在超時時直接殺掉 OpenCode，沒有收集 SDK 證據。原因見 §5（`quota exhausted` 觸發 OpenCode 重試）。保留為 `S6-attempt1-timeout-no-sdk-evidence/`（只有 `timeline.jsonl`、`checks.json`，後者 `providersSeen:[]`）。之後把 harness 的超時處理改為「超時 → 先按 C design 第 6 節停止全部會話（先標記後 abort）→ 再收集證據」，重跑 S6 **仍超時**（原因同上，這是預期的重試行為），但此次收集到完整證據（`evidence/S6/`，outcome `timeout`，`timeline.jsonl:172` 起為超時停止）。V6 的判據（准入≤3、請求＝准入）在超時運行中仍可評估並成立。
3. S6w（補充）完成，說明超時來自措辭，而非預算規則。
4. 其餘場景均一次運行完成，無失敗、無超時。
5. 退出碼：S6 因超時退出碼 3（不是 Z 失敗；Z 在 S6 仍成立）。
6. 舊嘗試證據目錄均保留，沒有刪除（S1 的第一次運行除外，見 1）。

## 7. 檔案與 git

新增檔案僅在 `scratch/c-probe/`：`probe-plugin.ts`、`stub-provider.ts`、`harness.ts`、`REPORT.md`、`evidence/`（13 個運行目錄＋`S6-attempt1-timeout-no-sdk-evidence/`）。`evidence/*/tools-first-request.json` 僅是一個指向 `timeline.jsonl` 的說明檔。倉庫外：`/tmp/cprobe-run.sh`（啟動包裝）、`/tmp/cprobe-cwd`、`/tmp/an.js`、`/tmp/tl.js`（分析輔助腳本）和各運行的 `c-probe-*` 臨時目錄；均未刪除。

`git status --short`：

```
?? scratch/
```

未改任何已追蹤文件、未 commit、未 push、未用 `--auto`、未安裝依賴、未寫主工作區。證據不含 RPC 傳輸憑據與 server password（已 grep 核對 `Bearer`、`OPENCODE_SERVER_PASSWORD`、`c-probe-not-a-secret` 在 `evidence/` 無命中）。
