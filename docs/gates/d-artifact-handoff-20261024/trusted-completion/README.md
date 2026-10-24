# D5 可信完成：最小保留證據

2026-10-24（Asia/Tokyo）。本目錄依使用者要求由完整調試轉儲精簡，精簡時未commit/push；其後使用者已授權將程式、探針與精簡證據分批提交並推送。歷史記錄保留當時狀態。工程結論與限制以 [D 詳細 design §7–7.1](../../../superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md) 為準。

## 驗收與來源

- [主區接入驗收](integration-main/README.md)：43/43定向、403/403全套、typecheck/build及同批十案的歷史命令、日誌與核對結果。這些是整理前的驗收記錄，不是本次重跑。
- `integration-main-native/<scenario>/records.jsonl`：主區同批十案的最小完整交接證據，保留原生messages、sessions/bindings/task-executions、job輸出、publication、固定包、Verifier結果、Coordinator讀回、completion與run狀態、RPC/wire、探針observations、裁判收件原bytes及終態。每案身份獨立；不以其他批次補足本批。
- `integration-main-native/<scenario>/audit-selected.json`：保留綁定、派工、發布、驗證、提交、停止及拒絕事件；移除重複模型/工具生命週期事件，只保留completion.request的tool.execute。內含原文件hash、原始陣列索引及未改寫的事件物件；它是選段，不是完整audit。
- `integration-main-native/control/loadedContext.json`：一案完整載入上下文；其餘重複上下文改留 `integration-main-native/context-checks.json` 的整理時衍生核對（角色正文包含關係、正文/系統/tools hash），不冒稱其他完整上下文仍存在。
- `verified-source-hashes.json` 與 `verified-source.patch`：以記錄的基線 `2d9fc4e1439449ea30bad4471994a247805c34e0` 還原32項已驗來源，涵蓋31項非文檔實作/測試/角色/包文件及runtime來源AGENTS。整理時已在臨時基線樹實際套用patch，逐檔hash全部一致；不需保留多份完整source目錄。
- `integration-main-native/source-hashes.json`：主區該批原始30項來源hash；`integration-main/source-transfer.json` 及其final-source-hashes記錄接入時來源核對。根目錄final-source-hashes保留原型交接時的歷史hash（其中舊design/plan已不是現行檔案），不表示final-source目錄仍在。
- `contract-evidence/`、`parent-review/contract-evidence/`、`integration-main/contract-evidence/`：各次裁判接受後保存失敗的原始memory/disk/收件bytes，分開保留，不跨run拼接。

## JSONL 的無損核對

`records.jsonl` 與各歷史批次的 `results.jsonl` 每行是一個原始文件記錄：`path` 為整理前本證據目錄內的路徑，`sha256` 為原文件hash。這些path是原始位置標識，不是要求目前仍存在的連結。

- `encoding=json-indent-2`：data是完整JSON值，以 `json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')` 還原原始bytes（不加尾端換行）。
- `encoding=base64`：data解碼後即原始bytes。

整理時已逐條還原並與原文件及hash比較一致。主區會話未裁剪訊息內容；只移除了Provider每次請求反覆附帶的上下文、事件副本與workspace重複檔。候選bytes在原manifest中，腳本與輸入原bytes另外保留在records中的published/materials記錄，可沿publication引用核對；不依賴已刪workspace副本。`evidence-hashes.json` 是整理後實際保留檔案的hash清單，排除自身；舊全量hash清單已移除，不能靠hash聲稱原轉儲仍保存。

## 歷史失敗與批次

各批的 `results.jsonl` 保留其原始result/summary文件，`source-hashes.json` 保留各自版本；不再保存這些批次的完整Provider、events、workspace與source副本。

- `t1-red.log`：原入口不存在；`pre-send-race-red.log` / `pre-send-race-green.log`：落盤窗口來源變更曾錯送，補最終核對後零派送。
- `full-tests-initial.log`：舊權限白名單401/402；`contracts-final.log`：同步/非同步拒絕斷言錯誤；後續13/13見 `contracts-final-2.log`。失敗命令仍在 `verification-commands.json`，最終命令見 `verification-final-commands.json`。
- `batch-01/` 與 `batch-01.log`：停止觀察選錯revoke，以及執行中角色正文變更。`batch-02/` 與其log：before-stop已回not_sent，測試卻要求native aborted。
- `batch-03/`：舊範圍通過，未包含實際拒絕回傳；`feedback-debug/` 是補充單案，不拼接進最終批。
- `batch-final/`、`batch-final-summary.json` 及其log：原型最後同源十案；`parent-review-native/` 與 `parent-review/commands.json`：主session獨立複核，身份與主區批次分開。
- `first-control/`：首個control的原始終態。`runtime-commands.json` 保存各批命令與退出碼。

`retention.json` 記錄整理範圍、原規模與保留原則。一次性plan、入口design/plan副本、重複D4/D5 patch及完整歷史轉儲已移除；精確已驗來源改由單一verified-source.patch保留。完整原始轉儲不再作為可查閱證據。

## 後續重現與限制

仍可執行 `npx tsx tests/manual/d-trusted-completion.ts <fresh-label>`（label不可重用）；原始輸出現在位於Git已忽略的 `runs/d-trusted-completion/<fresh-label>/`，保留必要證據時再明確挑選，不把整批轉儲複製回本目錄。這項輸出位置變更發生在上述驗收之後；已驗來源與原hash保持原樣，不冒稱修改後已重跑十案。

內層deadline_exceeded/budget_exceeded exit1為預期停止。裁判與Provider皆為loopback非秘密scripted探針；真實產品模型調用0、模型usage unavailable，scripted零usage另記。只支持機械接線及本run邊界；不證明真模型能力、Verifier語義、真裁判部署/認證/scope/秘密隔離、任意同uid並發、fsync/跨重啟或真實題目solved。Q2完整虛假echo、Q3/V3動態完整性unknown及拒絕後模型實際修正能力均未因此通過。
