# 第一步 b 報告：`.opencode/` 能否載入插件／工具／命令（無模型）

2026-10-22，Sonnet 5.5。OpenCode 1.19.3，經未修改的 `startManagedOpenCode`，只用 loopback stub，token 0，未使用 rg shim，無超時，無重跑。腳本：`harness1b.ts`（新增，沿用 `stub-provider.ts`）。證據：`evidence/1b-{P,D,L}/`（`markers/` 為探針寫出的標記，只含時間、自身路徑、env 變數**名稱**）。層級：只陳述載入邊界觀察。

## 結論先行

**K1、K2、K3、K4 不通過；K5、K6 通過。** run 目錄根部 `.opencode/{plugin,plugins,tool,tools,command,commands}` 全部被載入，插件與自訂工具在持有 server password 與 provider key 的 OpenCode 進程內執行了模組代碼。`directory: W` 的請求級目錄也使 `W/.opencode/plugin/probe.ts` 被執行。

## K1–K6

| # | 結論 | 證據（直接觀察） |
| --- | --- | --- |
| K1 插件未載入 | **不通過** | `1b-P/markers/PLUGIN_SING-load.json`、`PLUGIN_SING-init.json`、`PLUGIN_PLUR-load.json`、`PLUGIN_PLUR-init.json`：`.opencode/plugin/` 與 `.opencode/plugins/` 兩種目錄名都被載入且 init 函數被調用（08:41:49.9Z，啟動即載入，不需模型請求）。`materials/.opencode/plugin/probe-sub.ts` **無**標記（對照未載入） |
| K2 自訂工具未註冊 | **不通過** | `1b-P/stub-requests.jsonl:1` 的 `toolNames` 含 `probe_tool`、`probe_tool2`；工具描述（含 `A0_1B_TOOL_SING/PLUR`）進了請求：`1b-P/stub-first-coord-request.json:136,148`；`markers/TOOL_SING-load.json`、`TOOL_PLUR-load.json`（模組載入時執行）。單複數目錄均有效。`*-exec.json` 無——stub 未呼叫這些工具，故「被模型調用時執行」未驗（探針 execute 本身寫標記，推斷可執行） |
| K3 命令未列出 | **不通過** | `1b-P/commands-base.json:22,32`：`probe-cmd`（`command/`）與 `probe-cmd2`（`commands/`）都在 `GET /command`；基線（D、L 場景）命令列表無這兩項 |
| K4 `directory: W` 不載入 W | **不通過（部分）** | `1b-D/markers/W_PLUGIN-load.json`：`W/.opencode/plugin/probe.ts` 在 `directory: W` 請求時被**執行**（08:41:52Z，自身路徑在 W）。**但** W 的 agent／skill／`AGENTS.md` 沒有進入：`agents-W.json`、`skills-W.json` 無 `hostile`，`commands-W.json` 無新命令，`stub-requests.jsonl:1` 與 `stub-first-coord-request.json:7` 無 `A0_1B_W_*`，系統提示 `Working directory` 為 W、指令仍是產品 `instructions`。`directory: W` 請求未被 server 拒絕或報錯（回應 200，`W-prompt-result.txt` completed）。W 的 agents／skills 為何與第一步 H 場景（run 目錄根部會載入）不同，**未查明**；只記為觀察 |
| K5 啟動後出現的 `.opencode/` 不被載入 | **通過** | `1b-L/agents-after.json`、`skills-after.json` 無 `late`；`1b-L/stub-requests.jsonl:1`、`stub-first-coord-request.json` 無 `A0_1B_LATE_*`；L 場景 `markers/` 為空。（僅限同一實例、同一 directory；未測啟動後新增的 `.opencode/plugin/`，也未測新 directory） |
| K6 無真實模型請求 | **通過** | `1b-{P,D,L}/j8.json`：無 `auth.json`、config 只有 `stub`、assistant `providerID` 全為 `stub`、無非 loopback 請求 |

## 觀察項

- **插件可見的環境變數名稱**（`PLUGIN_SING-load.json` 等，共 33 個，D 場景 W 插件 32 個）包含 **`OPENCODE_SERVER_PASSWORD`、`OPENCODE_CONFIG_CONTENT`、`A0_STUB_KEY`（provider key 的 env 名）**，另有 `OPENCODE_CONFIG_DIR`、全部 `OPENCODE_DISABLE_*` 旗標、`XDG_*`、`HOME`、`PATH`、`HTTP(S)_PROXY`、`OPENCODE_PID`。只記名稱，未讀值。也就是說被載入的題目側代碼能讀到 server password、注入的配置與 provider key。
- **載入時機**：插件與工具模組在實例啟動／首次 `GET`（`agents-base` 等）時載入，早於任何會話；插件 init 同時執行。
- **依賴安裝**：沒有。run 目錄 `.opencode/` 下只多出 `.gitignore`（OpenCode 自動寫入），無 `package.json`、`node_modules`、lockfile（`1b-P/run-tree-after.txt`）。探針文件不 import 外部包，所以不能說明含依賴的插件的行為。
- **`materials/` 子目錄對照**：未載入（`PLUGIN_SUB` 無標記）。
- **自訂工具格式**：以純物件 `{description, args:{}, execute}` 即可註冊，無需 import `@opencode-ai/plugin`。
- **探針自身行為**：探針只寫標記，未讀文件、未聯網、未 spawn。

## 失敗／重跑

無失敗、超時、重跑。

## git status

```
?? scratch/
```

（`node_modules` 為 git 忽略的既有目錄。未改任何已追蹤文件，未 commit／push，未動主工作區。）
