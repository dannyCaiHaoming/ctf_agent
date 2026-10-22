# A0 產品資產載入探針報告（無模型）

執行：Sonnet 5.5，2026-10-22。層級：只陳述「文檔／配置可載入」。證據路徑均相對 `scratch/a0-assets-probe/evidence/`。token 消耗 0（只用 loopback stub）。

## 1. 環境與前置檢查

- worktree：`/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/nifty-clarke-f414ed`，HEAD `77ca739694591a0fed55042df287142a3e8b117f`
- `opencode --version` = `1.19.3`；node `v26.3.0`；`@opencode-ai/sdk` 1.19.0、`@opencode-ai/plugin` 1.19.0
- 偏差：worktree 裡**已有**真實 `node_modules` 目錄（git 忽略，日期 Oct 17），未建符號連結，直接使用。
- §0.6 第 4 點：每個場景 `data/opencode/auth.json` 不存在；配置只含 `stub`（見各場景 `j8.json`）。HTTP(S)/ALL_PROXY 設為 `127.0.0.1:9`。
- 每個場景 run 目錄在 `os.tmpdir()`（`/var/folders/...`，不在 git 倉庫內），路徑記於各 `env.json`、`run-tree.txt`。
- 場景：`CD`、`EX`、`H`、`SK1`、`SK2`（均按 §0.4）；額外觀察：`EXREF`（references）、`EXNOFM`（無 frontmatter Skill）、`BOTH`（兩種產品指令方式同存）；補充：`SK1R`、`SK2R`（見 §5）。全部完成，無超時。
- 啟動器：`startManagedOpenCode` 未修改，只 import 調用，`binaryPath` 指向 `~/.opencode/bin/opencode`。

## 2. J1–J8 結論

| # | 結論 | 證據 |
| --- | --- | --- |
| J1 | **通過** | 版本 1.19.3：各 `env.json`（`version`）。實際進程 env 旗標名（`ps` 取名不取值）：`OPENCODE_CONFIG_DIR`、`OPENCODE_CONFIG_CONTENT`、`OPENCODE_DISABLE_PROJECT_CONFIG`、`_DEFAULT_PLUGINS`、`_CLAUDE_CODE`、`_EXTERNAL_SKILLS`、`_LSP_DOWNLOAD`、`_MODELS_FETCH`、`_AUTOUPDATE`、`_AUTOCOMPACT`、`OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER`、`XDG_*`×4、`HOME`、`npm_config_*`，與 server.ts 一致：`CD/env.json:7`（`spawnedEnvNames`） |
| J2 | **通過**（CD、EX） | `GET /agent` 含 coord(primary)/solver/verifier(subagent)，description 與 frontmatter 一致：`CD/agents.json:3-5,611-612,878-879`、`EX/agents.json` 同行；首個 coord 請求只含 `A0_ROLE_MARKER:coord`：`CD/stub-requests.jsonl:1`、`EX/stub-requests.jsonl:1`。（agent 列表另有內建 build/plan/explore/general 等） |
| J3 | **通過**（CD、EX） | `CD/skills.json:9-11`、`EX/skills.json:9-11`：description 來自 frontmatter；location：CD 為 `<run>/config/opencode/skills/web-session-diagnosis/SKILL.md`，EX 為 `<abs>/assets/skills/web-session-diagnosis/SKILL.md`（run 目錄之外）。另有內建 `customize-opencode`（`<built-in>`） |
| J4 | **通過**（CD、EX 分別） | 首個 coord 請求含 `A0_PRODUCT_AGENTS_MARKER`（count 1）：`CD/stub-requests.jsonl:1`、`EX/stub-requests.jsonl:1`；系統提示出現 `Instructions from: <path>/AGENTS.md`（`CD/stub-first-coord-request.json`、`EX/…` 第 7 行）。CD 來自配置目錄 `AGENTS.md`；EX 來自 `instructions` 的 run 目錄外絕對路徑 |
| J5 | **通過**（CD、EX、SK） | 首個 coord 請求不含 `A0_SKILL_BODY_MARKER`；系統提示含 `<available_skills>`，僅名稱／描述／location（`EX/stub-first-coord-request.json:7`）；`skill` 工具描述同樣列出：`:175` 附近。SK 場景 `SK1R/stub-requests.jsonl:1` 同樣不含 |
| J6 | **不通過** | 見下 |
| J7 | **按 §0.4 原條件不通過；補充（rg shim）通過** | 見 §5 |
| J8 | **通過**（全部場景） | 各場景 `j8.json`：`authJsonPresent:false`、config 只有 `stub`、assistant `providerID` 全為 `stub`、無非 loopback 請求；stub 記錄 usage 固定、無真實模型 |

### J6 詳情（H 場景，**不通過**）

在 `OPENCODE_DISABLE_PROJECT_CONFIG=true`、`OPENCODE_DISABLE_EXTERNAL_SKILLS=true`、`OPENCODE_DISABLE_CLAUDE_CODE=true` 下：

- **被載入（直接觀察）**：run 目錄下 `.opencode/agents/hostile.md` → `H/agents.json:527-528`、`H/config.json:55-56`（agent `hostile`，description/prompt 含 `A0_HOSTILE_DOT_OPENCODE_AGENT`）；`.opencode/skills/hostile/SKILL.md` → `H/skills.json:9-12`（location 為 `<run>/.opencode/skills/hostile/SKILL.md`）。二者進入 stub 請求：skill 描述在系統提示（`H/stub-first-coord-request.json:7`），hostile agent 描述在 `task` 工具描述（`:188`）。hostile 的 prompt 正文與 skill 正文沒有進首個請求，但 agent 可被 `task` 調用、skill 可被 `skill` 工具載入（推斷，未驗）。
- **未被載入（直接觀察）**：根目錄 `AGENTS.md`、`CLAUDE.md`、`opencode.json`（其 agent `hostile` 與 `instructions` 均未生效；instructions 仍只有產品那一條：`H/config.json`）、`hostile-instructions.md`、`.claude/skills/`、`.agents/skills/`、根 `skills/hostile/`、子目錄 `materials/AGENTS.md`、`materials/.opencode/agents/hostile2.md`（`hostile2` 不在列表）。
- 結論：旗標 `OPENCODE_DISABLE_PROJECT_CONFIG` **不阻止** run 目錄 `.opencode/{agents,skills}` 被掃描。啟動器 `directory` 即 run 目錄，若題目工作區位於 run 目錄之內且攜帶 `.opencode/`，會被提升為角色／Skill。`materials/` 子目錄未被掃描。

## 3. 觀察項

- **配置目錄 `AGENTS.md` vs `instructions`**：各自單獨都生效（`CD`、`EX`）。`BOTH` 場景同存時系統提示列出兩次 `Instructions from:`（不同路徑）、`A0_PRODUCT_AGENTS_MARKER` 計數 2：**會重複載入**（`BOTH/stub-requests.jsonl:1`、`BOTH/stub-first-coord-request.json:7`）。
- **本地 `references`**：配置被接受並原樣回顯（`EXREF/config.json:8-12`）；`A0_SHARED_REF_MARKER` 未出現在任何請求；工具清單與系統提示長度與 `EX` 基本相同（只差數個字元，`probe-ref` 不在請求中）。直接觀察到的結論：在 1.19.3 + 此隔離下，`references` 配置不產生新工具或提示片段，僅作為配置存在。其用途（例如作為 `read` 可達路徑）未驗證。
- **1.19.3 回應 vs SDK 1.19.0 類型**：`/skill` 回傳 `name/description/location/content`（相符）；`/agent` 欄位 `name/description/mode/native/hidden/topP/temperature/color/permission/variant/prompt/options/steps`，未做逐欄型別比對，未發現缺失欄位。
- **`skill` 工具描述**：列出全部可用 Skill（含內建 `customize-opencode`），見 `EX/stub-first-coord-request.json`。
- **無 frontmatter 的 Skill**（`EXNOFM`，`skills.paths` 追加 `assets/skills-nofm`）：**靜默忽略**，不在 `/skill`、系統提示中出現，也無錯誤（`EXNOFM/skills.json`；stderr 被啟動器丟棄，未見報錯）。
- 附帶：`CD` 場景下 `GET /skill` 的 location 在 run 目錄的配置目錄內，說明配置目錄 `skills/` 被原生發現（未配置 `skills.paths`）。

## 4. 資產類型載入表

| 資產類型 | CD（配置目錄） | EX（明確路徑，run 目錄之外） | 備註 |
| --- | --- | --- | --- |
| 產品指令 | 載入：`<cfg>/AGENTS.md` | 載入：`instructions: [<abs>/AGENTS.md]` | 兩者同存會重複載入 |
| 角色 | 載入：`<cfg>/agents/*.md`（frontmatter `description`、`mode`） | 同左（角色無路徑配置，仍放配置目錄，本步未探索其他路徑） | `coord` 的 prompt 即正文 |
| Skill | 發現：`<cfg>/skills/<name>/SKILL.md`，需 `name`、`description` frontmatter | 發現：`skills.paths: [<abs>/skills]` | 只有名稱／描述／location 進提示；無 frontmatter 被靜默忽略 |
| Skill 附屬 Reference | 經 `skill` 結果的 `<skill_files>` 給絕對路徑，`read` 可讀（見 §5，需 rg） | 同左，路徑在 run 目錄之外也可讀 | `skill` 呼叫會自動放行該 Skill 目錄的外部目錄權限，無須額外 `external_directory` 規則 |
| 共用 Reference（`references`） | 未測 | 配置被接受；不出現在提示或工具；效果未知 | 不構成可靠載入路徑 |

最小權限（SK1R 實測）：`coord` 只需 `permission: { skill: allow, read: allow }`；SK2R 另加的 `external_directory` 規則非必需（SK1R 已通過）。

## 5. 失敗、偏差與補充

1. **SK1／SK2（按 §0.4 原樣）J7 不通過**：stub 腳本第 1 次請求回 `skill` 呼叫，工具狀態 `error: "ripgrep execution failed"`（`SK1/messages.json:66`、`SK2/messages.json:66`）。原因（推斷）：宿主 PATH 上沒有 `rg` 可執行檔（`rg` 只是 shell 函數），OpenCode 在隔離的 `XDG_DATA_HOME` 下須下載 ripgrep，離線／隔離下失敗；`data/opencode/bin` 不存在。**在隔離 + 無 rg 的現行啟動條件下，原生 `skill` 工具不可用。** 第 2 次請求為 `Finished.`（附屬 Reference 步驟未達）。
2. **SK1R／SK2R（補充，偏離 §0.4）**：新增 `rg-shim/rg`（呼叫 Claude Code 二進制以 `argv0=rg` 作 ripgrep），harness 在呼叫 `startManagedOpenCode` 前把 shim 目錄加到宿主 `PATH`（啟動器本就從 `process.env.PATH` 取值，未改隔離旗標或 env 組裝）。結果：`skill` 工具成功，輸出含 `A0_SKILL_BODY_MARKER`、`Base directory for this skill: <abs>/assets/skills/web-session-diagnosis` 與 `<skill_files>` 列出附屬 Reference 絕對路徑（`SK1R/messages.json:62` 起）；第 2 次請求（`SK1R/stub-requests.jsonl:2`）含 body marker；`read` 該路徑成功（`SK1R/messages.json:123`），第 3 次請求含 `A0_SKILL_REF_MARKER`（`SK1R/stub-requests.jsonl:3`）。SK2R 結果相同。判定：J7 在「宿主提供 `rg`」的前提下通過。
3. 探針自身失誤與重跑（證據保留，不掩蓋）：`evidence/SK*R-attempt0-shim-bad-home`（shim 用 `$HOME`，run 的 HOME 被覆蓋）、`SK*R-attempt1-harness-path-regex-bug`、`SK*R-attempt2-regex-edit-not-applied`（harness 從工具結果解析 Reference 路徑時 regex 抓到相對連結 `references/...` 的片段 → `read` 觸發 `external_directory` 詢問並卡住至 25 秒 stub，記錄於 `permissions-seen.json`：`pattern "/*"`）。最終解析改為 `<skill_files><file>…</file>`，是 harness 修正，不是改判據。
4. 無場景超時；J8 無失敗，未觸發停止條件。
5. 未能驗證項：hostile agent/skill 被模型實際調用的後果（只驗到被列出）；`task` 子 agent 載入 solver/verifier 的運行時行為；`references` 的實際用途。

## 6. git status

```
?? scratch/
```

（`node_modules` 為 git 忽略的既有真實目錄，未建連結。）未改 design v1、plan、AGENTS.md、CLAUDE.md，未 commit／push，未動主工作區。
