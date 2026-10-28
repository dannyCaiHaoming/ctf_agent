# design v1 本地三題練習批次與人工進度帳本

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 第 1.6 節與第 2 節 H 的詳細 design 子文件；本地三題練習批次及進度記錄的細節以本文為準。本文已按使用者決定收斂：本批只做記錄與人工復盤，不建立正式成功率門檻；不新增獨立 judge，只使用既有 Recovery Critic 判斷是否停滯、重複無效路線或應換路。本文只定義設計，不構成真實模型調用、Docker 啟動、commit 或 push 授權。

## 1. 目的與非目標

要回答的問題是：

- 同一產品入口在三個本地 CTF 靶場上，能否留下足夠事實供人快速查看目前做到哪裡、卡在哪裡；
- 卡點是正常負向反饋、方法不足、Reference／Skill 不足、工具能力不足，還是 Agent 交接與協同不足；
- Recovery Critic 在持續停滯時是否指出了可執行的新方向，Coordinator 最後如何決定；
- 後續應新增哪個 Skill／Reference 或修正哪個協作接口。

不是一次正式能力評量：本批不先指定成功率門檻、不把三題結果外推為全產品能力、不建立 judge agent，也不以人工提示、題目專屬提示、預存解法或固定工具序列補足 Agent 自主性。

「固定基線」只固定可重現的輸入與記錄邊界，不固定解題流程。Recon 範圍、假設順序、工具、腳本、換路與重試均由 Agent 在題目 scope 內自行決定。

## 2. 本地三題練習批次 v1

### 2.1 題目輸入

本批使用以下本機 Docker images。Digest 是 2026-10-24 唯讀檢查所得；真跑前仍須由執行者重新核對，若 digest 改變，批次不得默默沿用舊名稱。

历史原始证据见 [docs/gates/distilled-local-practice-suite-and-progress-ledger-20261029/evidence.md](../../gates/distilled-local-practice-suite-and-progress-ledger-20261029/evidence.md)。

| Challenge | Image | 固定 digest | 已知 oracle |
| --- | --- | --- | --- |
| `mfw` | `llmctf/2016q-web-mfw:latest` | [固定 digest 原值](../../gates/distilled-local-practice-suite-and-progress-ledger-20261029/evidence.md#mfw) | `local-mfw-exact-v1` 已核對 |
| `throwback` | `llmctf/2015q-web-throwback:latest` | [固定 digest 原值](../../gates/distilled-local-practice-suite-and-progress-ledger-20261029/evidence.md#throwback) | 尚無已核對的 controller-side oracle |
| `seizurecipher` | `llmctf/2016f-web-seizurecipher:latest` | [固定 digest 原值](../../gates/distilled-local-practice-suite-and-progress-ledger-20261029/evidence.md#seizurecipher) | 尚無已核對的 controller-side oracle |

沒有已核對 oracle 的題目仍可完成觀察、候選、Engineer 固定包與獨立 Verifier 流程，但宿主最多記到 `candidate_only`／verification result；不得用模型自述、猜測 flag 或人工補登冒充 `verified` 或 `solved`。

### 2.2 每個 challenge 的獨立 run

三題各用一次獨立 `launch()` run。每次 run 開始前：

- 以固定 digest 重建或重置對應本地靶場容器，確認舊 flag、舊檔案、舊連線與舊工作區不跨 run 殘留；
- 建立全新的 workspace、evidence、state 與 OpenCode 工作目錄，不沿用前次 run 的成功結果；
- 記錄 challenge image name／digest、容器啟動方式、入口 URL、材料 hash、產品 commit、OpenCode／SDK／plugin 版本；
- 記錄本次實際 model／provider、token 上限、model-call 准入上限及 wall-clock 上限。這些值必須在該批開始前取得使用者明確授權；本文不替三題批次指定數值，也不把上一個 `mfw` 批次的 10,000,000-token 授權自動延伸。
- 三題都保留在批次結果中，失敗、超時、預算停止與未解出不得從分母刪除；但本批仍不計算正式成功率。

三題可以依穩定順序執行以便操作，但「順序固定」不代表共用解題模板。不得加入 challenge-specific prompt、程式分支、候選值、flag、Writeup 或預存解法。題目材料仍經既有 Intake／prepareRun 路徑進入，Agent 自行決定後續做法。

### 2.3 比較邊界

批次報告可並列展示每題的工具錯誤、重複路線、Critic 判斷、token／時間與最終結果分層，但只作練習與改進線索。只有未来另行定義、授權並在 run 前固定的正式題集與門檻，才可稱正式成功率。

## 3. 進度帳本

### 3.1 檔案與責任

每個 run 的根目錄提供兩個人工入口：

- `progress.jsonl`：run 進行中即時追加的機器時間線，一行一個事件。它是安全投影，不是原始訊息替代品。
- `progress.md`：run 結束時由同一批 `progress.jsonl`／宿主快照生成的人工摘要，固定列出階段、卡點訊號、Critic 判斷、Coordinator 決策、能力缺口與事件時間線。

既有 `evidence/control-audit.json`、`tool-resources.json`、`messages-*.json`、`verification-results.json` 等仍是取證來源。進度帳本只是索引與摘要，不因生成失敗改寫原始結果，也不能以摘要替代精確重放。

### 3.2 事件模型

每個事件至少包含：

| 欄位 | 意義 |
| --- | --- |
| `v` | schema 版本，初始為 `1` |
| `seq` | 單調遞增序號 |
| `at` | 宿主產生的 ISO 時間 |
| `elapsedMs` | 相對 run 開始時間 |
| `runId` | 宿主綁定的 run |
| `sessionId`／`role`／`challenge` | 已知時由宿主填入，不採模型自報身份 |
| `kind` | `run`、`session`、`model`、`tool`、`dispatch`、`critic`、`decision`、`evidence`、`budget`、`error` 等 |
| `op` | 原始可信操作名 |
| `status` | `started`、`succeeded`、`failed`、`denied`、`admitted`、`completed`、`unknown` 等 |
| `summary` | 固定模板的短句，不含原始候選／flag／prompt／輸出 |
| `facts` | 經白名單投影的必要結構化事實，例如 tool、callID、簡化參數、耗時、結果碼、版本／ref |

`tool.registered` 另存 `argFingerprint`，用來辨識相同工具與相同完整參數的重複嘗試；`tool.settled` 保存對應 callID、結果碼與耗時。Fingerprint 是 SHA-256，不保存原文。相同 fingerprint 出現只表示重複動作，不自動等於死循環；是否無效由 Recovery Critic 結合結果與進展判斷。

### 3.3 工具參數安全投影

原始工具參數與完整輸出留在既有受控證據中。進度帳本只保留足以人工定位問題的安全摘要：

- workspace：虛擬路徑、操作、內容 byte 數、cursor 是否存在；不記 `workspace.write` content、`workspace.search` needle。
- HTTP：method、移除 userinfo／query／fragment 後的 origin＋path、body byte 數、header 名稱集合；不記 header values／body。
- job：可執行檔 basename、argv 數量、timeout、preparation／job／stream；不記完整 argv 或 stdout／stderr。
- artifact／package：宿主生成的 ref／version、來源類型、範圍、size／hash；不記候選 bytes 或 rationale 原文。
- verification／completion：judgment／mode／state／solved 與宿主 ref；不記完整報告、evidence 原文或 flag。
- 題目已知秘密與 provider／control 憑據在寫入前以已知值替換為 `<redacted>`。

Recovery Critic 只用本帳本的白名單投影、必要的 ref 與目前用量判斷，不讀 chain-of-thought、原始候選或 flag。

### 3.4 人工摘要

`progress.md` 至少包含：

1. **Run 摘要**：status、model／provider、授權上限、實際 observable tokens、准入數、耗時與 usage 是否完整。
2. **Challenge 進度**：目前階段、最後一個可定位的進展、最近失敗與待回答問題。
3. **停滯／重複訊號（宿主事實）**：相同 `tool + argFingerprint` 次數、重複結果碼、距上次 artifact／package／verification／完成事件的時間。此節只列訊號，不自行判定 Agent 陷入死循環。
4. **Recovery Critic 判斷**：route、卡點、重複路線、下一步與能力缺口，標明是模型語義判斷。
5. **Coordinator 決策**：continue／redirect／stop_and_report 及理由，與 Critic 建議分開。
6. **能力缺口候選**：`skill`、`reference`、`tool`、`coordination`、`environment`、`unknown`；人工可據此決定是否新增材料或修接口。
7. **事件時間線**：按 seq 排列的短行，可回查 callID／ref。
8. **證據索引**：列出既有原始證據檔名與 run 路徑，不複製敏感內容。

### 3.5 人工檢查對照

| 人工問題 | 應查看 |
| --- | --- |
| 現在做到哪裡？ | Challenge 進度、最近 `dispatch`／`tool`／`evidence` 事件 |
| 哪一步卡住？ | 最近 failed／denied 工具、Critic blocker、Coordinator 決策 |
| 是否重複做同一件事？ | 重複 fingerprint 群組與 Critic `repeatedRoute` |
| 是否還有新證據？ | artifact／package／verification／completion 事件與 Critic 說明 |
| 是能力不足還是正常負向反饋？ | 先看工具結果碼，再看 Critic `capabilityGap`；不把 404／語法錯誤自動當工程缺陷 |
| 要補 Skill／Reference 還是修協作？ | 能力缺口候選、Critic 下一步、Coordinator 是否有效交接 |

## 4. Recovery Critic 與 Coordinator

不新增 judge agent。既有 `recovery-critic` 保持只讀狀態、Skill 與進度摘要；它不執行實驗、不寫候選、不分派、不提交。

### 4.1 觸發

不在每一步調用 Critic。以下情況才觸發：

- 一個子任務階段完成並交回 Coordinator，且需要決定是否換路；
- 宿主偵測到相同工具／fingerprint 重複至少 3 次且沒有新的實質進展；
- 連續兩次交接都沒有新的 artifact／package／verification／完成事件；
- 預算或時間接近授權上限，需要明確 continue／redirect／stop_and_report；
- 出現錯誤前提被反證、工具能力明顯不足或角色交接缺口，原 Solver 不宜只做局部修補。

宿主只提供停滯訊號，不代替 Critic 下語義結論。

### 4.2 結構化進度接口

Coordinator 與 Recovery Critic 可用受管的 `progress.read` 取得有界、去敏的目前摘要；兩者可寫 `progress.note`：

- `route`：`continue`、`redirect`、`stop_and_report`；
- `stage`：intake／recon／strategy／solve／engineering／verification／recovery／finalize；
- `summary`：目前進展與卡點的短摘要；
- `blocker`、`repeatedRoute`、`nextAction`：可選短文字；
- `capabilityGap`：`skill`／`reference`／`tool`／`coordination`／`environment`／`unknown` 及短說明。

宿主填入來源角色、時間、session 與 run，不接受自填身份。Recovery Critic 寫入的是判斷；Coordinator 寫入的是最終決策，兩者在報告中不得混成同一層事實。

## 5. 結果分層與記錄邊界

單題結果至少分開記錄：

- 環境／工具失敗：容器、入口、provider、adapter、job 或 RPC 未正常成立；
- 正常負向反饋：404、登入失敗、腳本錯誤、被否定的假設；
- 候選未驗證：有固定候選但沒有足夠獨立證據或 oracle；
- `verified`：獨立 Verifier 對固定候選的判斷；
- trusted accepted／`solved`：宿主以綁定 oracle 接受且明確完成；
- `candidate_only`／`unsolved`／`inconclusive`：不可與成功混算。

本批只提供記錄，不設定正式成功率門檻。`progress.md` 的停滯與能力缺口是人工改進輸入，不是額外 judge，也不直接改變 solved 狀態。

## 6. 實作結果與驗收

**當前狀態（2026-10-26）：** 進度帳本實作已存在，工具接入、角色權限、使用說明與配套測試已隨 `b1afa29a` 收口提交；該組合的 typecheck、build、49 檔／486 項測試通過。下文 409 項是 2026-10-24 的歷史結果，不改寫為此次數量。r4 中 Critic 確實完成 `ctf_progress_read`，但隨後 length／空正文，未寫 `progress.note`；工具鏈可用不代表有效復盤已驗收，原始消息及邊界見[否定證據與路線復核 §3.5](2026-10-25-design-v1-negative-evidence-and-route-review.md)。本地三題完整批次並未完成。

2026-10-24 已按本 design 接入最小進度帳本切片：

- `apps/launcher/src/progress-ledger.ts` 將宿主 audit 投影為 append-only `progress.jsonl`，run 結束時生成 `progress.md`；部分顯示最後 500 筆，完整事件流仍在 JSONL。
- 工具參數用白名單摘要及完整參數 SHA-256 fingerprint；HTTP query／userinfo／body、job argv、workspace content／needle、verification rationale 與候選 bytes 不進 progress。已知 run 憑據和常見 flag 形式在寫入前替換。
- `ctf_progress_read` 只回有界、去敏 digest；`ctf_progress_note` 只允許 Coordinator／Recovery Critic。Host 綁定來源角色、時間、session 與 run，route／stage／capability gap 均有固定詞彙。
- `progress.md` 將宿主重複訊號、Recovery Critic 判斷、Coordinator 決策、能力缺口與事件時間線分開呈現，並指向原始 evidence。
- launcher 的最終摘要寫入失敗會把 run 記為 `failed`，但仍繼續保存既有 sessions、audit、resources、verification 與 completion 證據。

無模型驗收：新增 progress 安全投影與重複分組、權限與結構化 note、正常／失敗 run、摘要寫入失敗測試；`npm test` 為 49 檔／409 項全通過，`npm run typecheck` 與 `npm run build` 均 exit 0。此次沒有真實模型調用，模型 usage 為 `unavailable`，不得由此宣稱三題練習或模型遵循 critic 流程。

## 7. 後續真跑邊界

本文定義的完整三題批次尚未授權／完成；個別題目的歷史運行不構成三題同批驗收，也不沿用其預算。後續批次真跑前須另行確認 model／provider、三題目標 digest、每個 run 的 token／准入／時間上限及容器重置方式；`throwback`／`seizurecipher` 若仍未有已核對的 controller-side oracle，只能記 `candidate_only`／verification result。

真跑後才可觀察 Agent 是否依階段邊界觸發 Critic、其判斷是否減少無效重複，以及 progress 摘要是否足以指出應新增 Skill／Reference 或修正協作接口。本切片不設正式成功率門檻，也不自動啟動下一次 run。
