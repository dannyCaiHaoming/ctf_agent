# 入口無頭啟動與子會話指令：無模型探針報告

執行日期 2026-10-22。執行模型 Sonnet 5.5。token 預算 0，只用 loopback 替身 provider。證據路徑均相對於 `scratch/entry-probe/`。

## 1. 環境記錄

| 項 | 值 |
| --- | --- |
| worktree | `/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/hopeful-diffie-392bf5`（分支 `claude/hopeful-diffie-392bf5`） |
| HEAD | `6215e0e6db05cff32d4f1f3e2f2df2e8fdf5eddd` |
| `opencode --version` | `1.19.3`（`~/.opencode/bin/opencode`） |
| node | v26.3.0 |
| node_modules | worktree 內已有真實目錄（非符號連結），只讀使用，未安裝/修改 |
| 代理 | 啟動前設 `HTTP_PROXY=HTTPS_PROXY=ALL_PROXY=http://127.0.0.1:9`、`NO_PROXY=127.0.0.1,localhost` |
| 運行目錄 | `realpathSync(os.tmpdir())` 下 `entry-probe-<場景>-XXXX/opencode/{work,config/opencode,data,state,cache}`，不在 git 倉庫內 |

### 環境變數名稱對照（§0.3 第 2 點）

- harness 的 `opencode run` 環境（`evidence/R1/env-names.txt`，R2–R4 同，已逐檔比對相同）共 28 個名稱：`ALL_PROXY ENTRY_STUB_KEY HOME HTTPS_PROXY HTTP_PROXY LANG NO_PROXY NPM_CONFIG_OFFLINE OPENCODE_CONFIG_CONTENT OPENCODE_CONFIG_DIR OPENCODE_DISABLE_AUTOCOMPACT OPENCODE_DISABLE_AUTOUPDATE OPENCODE_DISABLE_CLAUDE_CODE OPENCODE_DISABLE_DEFAULT_PLUGINS OPENCODE_DISABLE_EXTERNAL_SKILLS OPENCODE_DISABLE_LSP_DOWNLOAD OPENCODE_DISABLE_MODELS_FETCH OPENCODE_DISABLE_PROJECT_CONFIG OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER OPENCODE_SERVER_PASSWORD PATH TZ XDG_CACHE_HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME npm_config_ignore_scripts npm_config_offline`。
- `startManagedOpenCode` 實際啟動的 `opencode serve` 進程（R5，以 `ps -E` 只取名稱，`evidence/R5/serve-env-names.txt`）：同樣 28 個名稱，與上面集合 **完全一致，差異為空**。
- 與 `server.ts` 第 59–72 行原始碼的旗標清單逐名比對（加上 `safeEnvironment` 的 `PATH/HOME/LANG/TZ` 與 `input.environment` 的 `ENTRY_STUB_KEY`）：無增無減。
- `OPENCODE_SERVER_PASSWORD`：兩邊都設為隨機值（run 側也設，以保持名稱一致）；值未寫入任何證據，`stderr.txt` 寫入前做了替換。結論：無差異（計劃預期的 password 例外在此未出現差異，因為 run 側也帶了該名稱）。

## 2. 場景完成情況與時間線

時間為 ms，起點為 harness 啟動進程。「stub」指 `evidence/<場景>/stub.jsonl` 行號＝請求序號 seq。

**R1 單子會話（完成，exit 0，wall 16 314 ms）** `evidence/R1/`
- stub 5 個請求：coord#1（seq1）→ worker 三次（seq2–4，各延遲 5 s）→ coord#2（seq5，`tStart` 距 seq1 約 15.2 s）。worker 最後一次回應結束早於 coord#2 開始（stub.jsonl 行 4 `tEnd` < 行 5 `tStart`）。
- stdout 的 JSON 事件（`stdout.jsonl` 6 行）：1 step_start、2 `tool_use(task)` completed、3 step_finish、4–6 coord 收尾文字 `ENTRY_DONE coord finished`。進程在 coord 收尾後約 30 ms 內退出（wall 16 314 ms vs `stdout.stamped.tsv` 最後一行 16 283 ms）。

**R2 並行子會話（完成，exit 0，wall 11 279 ms）** `evidence/R2/`
- coord#1 同一則回應含兩個 `task`（stub 行 1 `toolCalls` 兩個）。兩個 worker 會話並行（行 2、3 `tStart` 相差 0 ms；行 4、5 同），共 4 個 worker 請求，全部早於 coord#2（行 6）。`db-sessions.json` 顯示兩個 `parent_id` 指向根會話的子會話。stdout 兩個 `tool_use(task)` 都 completed（`stdout.jsonl` 第 2、3 行）。

**R3 權限詢問（完成，exit 0，wall 6 197 ms）** `evidence/R3/`
- worker `read: ask`。worker#1（stub 行 2）回 `read` 後，`run` 在 stderr 輸出 `permission requested: read (…/probe.txt); auto-rejecting`（`stderr.txt` 行 1），該 worker 工具調用被拒；worker 子會話隨即以 error 結束（不再有第 2 次 worker 請求），task 工具結果為 `Subagent failed (…): The user rejected permission to use this specific tool call.`（`stdout.stamped.tsv` 行 2），coord#2 照常收尾（stub 行 3）。

**R4 失敗結束（完成，exit 1，wall 70 345 ms）** `evidence/R4/`
- stub 對 coord 每個請求回 HTTP 500；OpenCode 自動重試共 6 次（stub.jsonl 6 行，約 70 s），最後 stdout 輸出單一 `{"type":"error",…,"error":{"name":"APIError","data":{"message":"stub scripted failure","statusCode":500,"isRetryable":true,…}}}`（`stdout.jsonl` 行 1），進程 exit 1。未超過 120 s 上限，但接近半程；真實運行的重試窗口長度由 OpenCode 決定。

**R5 備案 serve（完成，SDK 判定完成，wall 18 292 ms）** `evidence/R5/`
- `startManagedOpenCode` 啟動 serve；SDK `session.create` + 一次 `session.promptAsync`（HTTP 204，`meta.json`）。stub 與 R1 相同 5 個請求。SDK 事件流：子會話 idle 在 `sdk-events.tsv` 行 113，根會話 `session.status: idle`＋`session.idle` 在行 135–136（約 16 583 ms，晚於 coord#2 結束，`meta.json` `sendToIdleMs` 15 890）。`sdk-root-messages.json` 可取根會話訊息。

## 3. 判據結論

| # | 結論 | 依據 |
| --- | --- | --- |
| E1 不提前退出 | **通過**（R1、R2）。直接觀察：兩場景所有 worker 請求的 `tEnd` 都早於 coord 收尾請求的 `tStart`（R1 stub 行 2–4 對行 5；R2 行 2–5 對行 6）；進程在 coord 收尾事件之後退出（R1 `stdout.stamped.tsv` 最後行 16 283 ms，進程 16 314 ms）；R2 兩個並行 worker 均完成後才收尾。stub 日誌無未結束請求。不能由此推斷「更長時間（分鐘級以上）」仍成立：最長單次 wall 僅 16 s（R4 的 70 s 是重試而非運行）。 | `evidence/R1,R2/stub.jsonl`、`stdout.stamped.tsv` |
| E2 權限詢問不卡死 | **通過，行為為「自動拒絕」**。直接觀察：`run` 不等待人工回答，`ask` 權限在 stderr 打印 `auto-rejecting` 並使該工具調用失敗，進程在 6.2 s 內正常結束。副作用：worker 子會話被整個終止，錯誤只在根會話的 `task` 工具結果與 stderr 中出現；退出碼仍是 0。 | `evidence/R3/stderr.txt:1`、`stdout.stamped.tsv:2`、`stub.jsonl`（worker 僅 1 次請求） |
| E3 結果狀態可判讀 | **通過（有保留）**。直接觀察：R1–R4 的 `--format json` stdout 每行均為合法 JSON；可從每行 `sessionID` 取根會話 ID，從 `type:"text"` 事件取最終 assistant 文字（R1 行 5、R2 行 6、R3 行 5）；R4 退出碼 1 且含 `type:"error"` 事件。保留：**退出碼 0 不代表任務成功**——R3（及首次 R1 嘗試，見 §5）有工具被權限自動拒絕、子 Agent 失敗，退出碼依然 0；stdout 不含子會話事件，子會話失敗只能從根會話 `task` 工具結果（`state.status:"error"`）或 stderr 得知。 | `evidence/R1–R4/stdout.jsonl`、`R4/stdout.jsonl:1`、`R3/stdout.stamped.tsv:2` |
| E4 子會話套用產品指令 | **通過**（`run` 與 `serve`）。直接觀察：全部 worker 請求（R1 3 個、R2 4 個、R3 1 個、R5 3 個）的 system 訊息都含 `E_PRODUCT_AGENTS_MARKER` 與 `E_ROLE_MARKER:worker`，且整個請求不含 `E_ROLE_MARKER:coord`（stub.jsonl 欄位 `hasProductMarkerInSystem`／`systemHasWorkerMarker`／`hasCoordMarker`）。coord 請求同樣含 product marker 與 coord marker。 | `evidence/R1,R2,R3,R5/stub.jsonl` |
| E5 備案可行 | **通過**。SDK 只送一次 `promptAsync`（204），整個 coord→worker→coord 流程完成；完成時刻由根會話的 `session.status idle`／`session.idle` 事件判斷（`sdk-events.tsv:135-136`）。 | `evidence/R5/` |
| E6 無真實模型請求 | **通過**（R1–R5 全部）。直接觀察：各場景 `db-messages.json` 內全部 assistant 訊息 provider／model 為 `stub/scripted`、user 訊息 model 亦為 `stub/scripted`；各場景 `data-dir-listing.txt` 無 `auth.json`（`meta.json` `authJsonPresent:false`）；`config.json` 只有 provider `stub`，`enabled_providers:["stub"]`；stub 日誌除 `chat` 外無其他請求（`kind:other` 為 0）；進程均帶 127.0.0.1:9 代理。限制：未做 OS 層抓包，「沒有對外連線」是由代理設定＋`OPENCODE_DISABLE_MODELS_FETCH` 等旗標＋stub 日誌推斷，而非直接觀察。 | 各 `evidence/*/` |

## 4. U1／U2 候選結論

| # | 候選結論（只標候選，不改 design） | 依據 |
| --- | --- | --- |
| U1 | **傾向成立：入口可定為 `opencode run`**。子會話（含並行）完成前不提前退出（E1）；權限詢問不卡死但為自動拒絕（E2），故產品需在權限設計上明確 allow/deny，不能依賴詢問；異常有非 0 退出碼和 error 事件（E3）。需 Opus 決定的風險：(a) 退出碼 0 不等於成功，成功判定需讀最終 text 事件與 `task` 工具結果／或讀 DB；(b) 子 Agent 被權限拒絕會被整個終止而 stdout 無專門事件；(c) API 失敗重試約 70 s 才退出；(d) 本探針最長僅 16 s，未驗證分鐘到小時級。備案 `serve`＋SDK 一次訊息也可行（E5），且可由 `session.idle` 取得精確完成時刻與子會話事件。 | E1、E2、E3、E5 |
| U2 | **傾向成立：配置目錄中的產品 `AGENTS.md` 作用於原生 `task` 子會話**，在 `run` 與 `serve` 兩種形態下都是（worker 系統訊息均含 marker，且角色標記不串）。 | E4 |

## 5. 失敗、超時與重跑（原樣記錄）

1. **R1 首次運行（`evidence/R1-attempt1-tmpdir-symlink/`）**：運行目錄用 `os.tmpdir()`（`/var/folders/...`，macOS 上 `/var` 是 `/private/var` 的符號連結），worker 讀 work 目錄內文件被判 `external_directory` 權限請求並被 `run` 自動拒絕（`stderr.txt` 行 1），子 Agent 失敗，但退出碼 0、wall 僅 6.2 s。這是 harness 路徑問題，不是場景設計。另做了一次相同重跑（`evidence/R1-attempt2-identical/`，同樣結果，因第一次修 harness 的 `sed` 在 macOS 上失敗，實際未生效）。之後 harness 改為 `realpathSync(os.tmpdir())`，R1 第三次（`evidence/R1/`）正常。此現象本身即 E3 的保留意見來源，且說明產品的工作目錄路徑必須是 realpath。判據與場景內容未改。
2. R2–R5 各跑一次，均無重跑、無超時（上限 120 s；最長 R4 70.3 s）。
3. 舊嘗試證據目錄保留（計劃禁止刪除）。

## 6. 其他發現

- `opencode run` 預設行為無 `--auto`；`ask` 與外部目錄權限一律自動拒絕，不會等待輸入。
- 環境與 `startManagedOpenCode` 一致時，OpenCode 能載入配置目錄 `agents/*.md` 與 `AGENTS.md`，停用內建 agent 的配置有效（R1–R5 均無 unscripted 請求，`stub.jsonl` 的 `scripted` 全為 true，沒有 title/summary 等額外模型請求）。

## 7. 檔案與 git

新增檔案僅在 `scratch/entry-probe/`：`stub-provider.ts`、`harness.ts`、`REPORT.md`、`evidence/`。未改任何已追蹤文件；`git status`（`--short`）：

```
?? scratch/
```

未 commit、未 push、未用 `--auto`、未安裝依賴、未刪除檔案。
