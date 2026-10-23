# 真實模型冒煙報告（2026-10-23）

結論（design v1 1.6 層級）：**確定性工具接線在真實模型下成立**（綁定、准入、停止、用量、無憑據）。不陳述角色協作效果或解題能力。

## 配置
- worktree：`/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/vigorous-lichterman-9a97b3`
- 端點：`https://ark.cn-beijing.volces.com/api/coding/v3`；模型 `volcano-coding/deepseek-v4-1-flash-261017`；OpenCode 1.19.3
- 適配器：`@ai-sdk/openai-compatible`。理由：端點是第三方 OpenAI 兼容的 chat/completions；`@ai-sdk/openai` 面向 OpenAI 官方（Responses API），不適用。與倉庫既有百鍊配置一致。實測無適配器錯誤。
- `limit.context` 128000 為沿用既有 DeepSeek 配置的假設值（未向方舟核實）；`limit.output` 8000。
- release profile 另填了必填欄位 `maxToolJobs: 1`、`reference.enabled: false`（plan 未規定）。
- sha256：`opencode.volcano-coding.example.json` = ddc7a619a781e1197dfa570e4ed49b558191ac65ce329fc0a124c6fd15fc7baf；`release-profile.volcano-coding.example.json` = b21a2dbe87a5ebc1843c07dae7642081a0d011118511e7b15d1cfe79da129b38
- run.json 的 configSha256（合併後 OpenCode 配置，不含 plugin）：0b52ba2b4cd6976190eba89c07e75463e8dd8b0607c81997c29104d70feb3cf5

## 零 token 預檢
`scratch/smoke/stub.mjs`（loopback OpenAI 兼容替身）+ 同一份配置僅改 baseURL，cwd=/tmp，ARK_API_KEY 用假值，未讀 `.env`、未碰火山。run `preflight-1`：completed，准入 1，替身收到 1 次 `POST /v1/chat/completions`，九角色與 `web-session-diagnosis` 載入，根會話綁定為 coordinator。

## 正式 run（`~/.ctf-agent/runs/volcano-smoke-1`，只跑 1 次，無重跑）
cwd=主倉庫根（讀 `.env`），執行 worktree 的 launcher。結果 `completed`，`stopReason: completed`，22.3 秒。
時間線（ms）：0 start → 585 opencode_started → 651 root_bound → 660 start_message_sent → 675 准入#1 coordinator → 3605 准入#2（intake 子會話，bound 於 dispatch，早於其准入）→ 4573/6084/7393/10025 准入#3–#6 intake → 14065/16682 准入#7–#8 coordinator → 22223 root_idle → 22266 opencode_closed。

## §0.4 逐條
1. 配置載入：通過。inventory.json 9 個 agent（coordinator primary，其餘 subagent），skills 含 `web-session-diagnosis`（另有 `customize-opencode`，OpenCode 內建）。「根會話系統訊息含產品 AGENTS.md」我**沒有單獨核對**（行為上 Coordinator 遵循了產品約定，如缺材料即 STOP，但這不是直接證據）。
2. 綁定：通過。bindings.json：根 `coordinator`（via root，parentID null）；子會話 `intake`（via dispatch，parentID=根，dispatchCallID 已記）；兩者 boundAt 均早於各自首次准入。
3. 准入：通過。admissions 8 次 = assistant 訊息 8 條（coordinator 3 + intake 5）；8 ≤ 12。
4. 輸出上限：通過（無 provider 錯誤）。注意：admissions 記錄的 `maxOutputTokens`（80000→69342）是控制服務的剩餘可觀察額度；插件實際送出值為 `min(OpenCode 給的值, 剩餘額度)`（apps/opencode-plugin/src/index.ts:70），本次未記錄實際請求體中的 max_tokens，故「≤8000」是依代碼推斷，非請求級證據。
5. 用量：provider 回報，complete=true。coordinator in 4629 / out 1146 / reasoning 600；intake in 3622 / out 1531 / reasoning 459。合計 input 8251、output 2677、reasoning 1059（是否已含於 output 未確認）：可觀察 token 約 10,928–11,987，**非下限**（未被中止）。遠低於 80,000。模型調用 8 次。
6. 停止：通過。Coordinator 自行結束，stopReason=completed，無停止後請求。
7. 秘密：通過。對 run 目錄全文 grep `.env` 中 ARK_API_KEY 的值：0 個檔案；無 `ark-…`／`Bearer …` 形態字串；超過 48 位的 hex 僅為 assets.json／run.json 的 sha256。RPC 憑據與 server password 在 run 結束後不可取回，因此是以 launcher 的 scrub 機制與形態 grep 間接核對，不是逐一字面比對。
8. 代碼未改：`git status` 僅 `config/` 兩份新配置與 `scratch/`。

## 角色行為（如實，不評價能力）
- Coordinator 先自己 `read` run 目錄被拒（`denied: read path`），再用 `task` 分派 intake。
- intake 嘗試讀 14 個路徑（run 目錄、challenge.json、README、/tmp 等）全部被拒（控制服務只允許技能路徑，符合預期），回報「無任何題目材料」並建議宿主提供。
- Coordinator 再獨立讀 `/`、run 目錄、`/tmp` 均被拒，最終決定 STOP（blocked: no readable challenge material），未再分派其他角色。無題目來源下，結果符合預期。
- 觀察：模型把「read 全被拒」當成缺權限而請求宿主開放讀取；這是目前無 Intake 工具下的預期現象，非控制服務缺陷。

## 錯誤原文
無 provider／adapter 錯誤。僅有工具層 `denied: read path`（見上）。

## git status
```
?? config/opencode.volcano-coding.example.json
?? config/release-profile.volcano-coding.example.json
?? scratch/
```
