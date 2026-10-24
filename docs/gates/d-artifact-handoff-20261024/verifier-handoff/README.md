# D 第三接口：專屬隔離無模型驗證

> 下文為子session交付時記錄。主session後續已獨立核對、回寫design並保存源碼/失敗證據；plan已清理，session已歸檔，388a工作樹已移除。當前結論見 [主核對](parent-review/README.md)，清理記錄見 parent-review/cleanup.json。

日期：2026-10-24，Asia/Tokyo。工作樹：`/Users/caihaoming/.codex/worktrees/388a/pentest-agent`，detached HEAD `abe7d6e82cd6ebf96641acd9403a848e6d02c04d`。未 commit/push、合併、寫主區、刪 plan 或清理工作樹。主 session 獨立核對 pending。

## 讀取入口與結論

- 最終判定：[子區 D design §5](../../../superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md#5-接口三固定材料交給獨立-verifier)。V1 成立，V2 有條件成立，V3 部分成立，V4 最小鏈路成立。完整固定輸入執行證明未成立；模型能力、verified、solved 及主區接入均未證明。
- 最終同源六案：`runtime-final-2/`。`verification-final.json` 是作者重新核對原 bytes、來源 hash、真實身份與准入順序後的摘要；可只讀復跑 `python3 docs/gates/d-artifact-handoff-20261024/verifier-handoff/audit-evidence.py`。
- `delivery-manifest.json` 列產品／測試改動、最小必要證據及來源指紋；`evidence-hashes.json` 是全部保留文件的 hash（不包含該 hash 清單自身與 delivery manifest）。不是用 hash 證明執行期間內容未變。

## 最終原生批次

Node 26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0。公開 plugin/SDK/server；實驗性原生 background 沿用既有配置。只允許 loopback 預定替身，真實模型調用 0；真實 usage `unavailable`，替身回傳的零 usage 不是實測模型成本。六案共 244 個替身請求。

| 場景 | 原始觀察 | 限定結論 |
| --- | --- | --- |
| control | 同一 E→Solver 發布→Engineer 讀／整理／固定→Coordinator 指定版本→獨立 Verifier 讀／準備／job→原生交回；真實 stdout 9 bytes 與候選相同，stderr 空 | 接線與本地重算輸出一致；語義未驗 |
| lost | C 已 ready，真實 RPC socket 中斷；plugin `denied: control unavailable`；一次準備、無 Verifier job | 已準備與調用方未知可同時成立；替身暫停，不盲目重發 |
| prep-stop | staging rename 前 barrier；Recon 原生完成喚醒父；Coordinator `task.stop`，先撤銷後放行 IO | 無 ready，無半準備／殘目錄，resource settled/cancelled |
| job-stop | 真實 job 讀準備的 `raw.bin` 並輸出相同 20 bytes，仍 running 時 Recon 原生完成喚醒父，再 native `task.stop` | 真正在途讀取後取消，stdout 保留、stderr 空、程序組及 resource settled；不是 SDK resume |
| late | C 已 ready 後延遲真實 RPC reply；native stop 取消 socket；釋放時 destroyed，工具 `Tool execution aborted` | 保留準備事實；遲到 reply 未送達，不能說 plugin 收到後再次拒絕 |
| budget | 固定 `maxSteps=37`，準備完成後下一 Verifier 模型准入被 plugin/C 拒絕，無 Verifier job | 預期 `budget_exceeded`（run code 1）；驗證 harness code 0，非正常 run 成功 |

每案均從空 published 開始，無 SDK 注入產物／resume child，沒有拼接各批成功。停止觸發由測試 IO barrier 安排時序及替身作決定，不代表模型自發辨認或遵守 unknown。unknown 新調用強制鎖、冪等重試、跨重啟恢復沒有新增。

## 最小必要原始證據

- `runtime-final-2/source/`、`source-hashes.json`：27 個實際來源／角色／測試文件完整副本；作者核對當前來源與副本逐一相符。`source-hashes` 與交付清單保存最終指紋。
- 每案 `provider-config.json`、`versions.json`、`provider.json`、`loadedContext.json`：實際請求、角色全文／body hash、工具 schema／描述／白名單的真實載入核對。角色全文與最終文件比較，不只依 inventory 推斷已載入。
- 每案 `evidence/messages-*.json`、`task-executions.json`、`control-audit.json`、`admissions.json`、`bindings.json`、`tool-resources.json`、`sessions.json`：真實 task callID→child→execution、version、assign→execution→bind→首准入、原生完成通知／交付／停止與資源終態。
- 每案 `wire.json`、`observations.json`、`events.json`：真實傳輸與 IO 順序；每案 `fixed-manifest.json`、`candidate.bin`、`expected-raw.bin`、`workspace/`、`state/jobs/.../{stdout,stderr}.bin` 保留原 bytes，不以 JSON 文本相等代替二進位校驗。
- `boundary-final/multipage/`：75004 bytes 原件與分頁重組件、頁長。多頁在 contract 層驗證，未冒稱原生多頁能力已同批驗證。
- `boundary-final/mid-job-restore/`：真實腳本、原 stdout/stderr、宿主 receipt／audit／execution、恢復後 bytes、原 job 文件來源。前後 matched 仍實際輸出 `CHANGEDUNDECLARED`，持續完整性及全部依賴 unknown。
- `checks-final/commands.json` 及 `1..4.log`：125/125 定向、typecheck、build、372/372 全套；手動場景收緊只修改手動 probe，另有 `typecheck-final-command.json`／log。自動測試／產品源碼自這批全套後未改。
- `runtime-final-2-command.json`／log：完整六案命令與退出碼，harness exit 0。

## 失敗與早批保留

`initial/red-missing-interface.log`：原缺口為 Verifier `package.read` 拒絕。工作樹初始無 node_modules；第一次 npx 嘗試拉取不相干的最新版，被終止；隨後 run 外 `npm ci` 依固定 lock 安裝，日誌保留，未用自動下載的新版 vitest 驗收。

`initial/typecheck-1.log`／`typecheck-2.log` 保留原型類型錯誤；`checks-1/3.log` 保留 4 個舊 fixture 未聲明版本而失敗。保留原角色、原拒絕斷言與原失敗欄位，fixture 改經真實發布工具建立版本後再分派，不以換角色／繞過版本檢查求綠。

`initial/red-metadata.log` 保留準備副本缺少 candidate/manifest 前校驗的反例；`initial/red-execution-audit.log` 保留 execution 重綁競態及審計開始記錄被後續 mutation 改寫的失敗。已以同例修正並重跑，GREEN 日誌均保留。

`runtime-1/`、`runtime-2/`、`runtime-final/`、`budget-1/` 是早批；其來源指紋不能當最終源碼。早批 job-stop 只在 spawn/register 釋放 barrier，可能無輸出，不能證明準備文件已讀取；最終 `runtime-final-2/job-stop` 明確觀察 20 bytes 且 running 才釋放原生通知。`verification.json` 是早批摘要，權威交付入口為 `verification-final.json`。

## 原型改動與作者核對

產品改動只在 launcher 的 CandidatePackages／ControlService、現有 plugin 工具 schema／描述、OpenCode Verifier 權限及 Coordinator／Verifier 角色正文。JobManager、ArtifactPublisher、launcher 和原生背景生命週期均復用；沒有另一個 registry／solver／消息循環，沒有接口四／五、HTTP replay、強隔離或通用依賴捕獲。

新增 10 項第三接口 contract 與一份公開 runtime probe；5 份既有 C/G/D／配置測試保留原安全檢查並適配新版本契約。作者按完整 plan／spec 對照閱讀最終 diff、原 bytes、版本／身份／實際載入內容；此為作者自審，弱於主 session 獨立核對，後者仍 pending。

執行判斷：沿用指定的已存在隔離工作樹；不依技能模板額外創建 session／reviewer，不 commit、刪 plan 或清理，因明確交接要求優先。V3 不增加強隔離，將無法證明的部分記 unknown；代價是本原型不能給出完整固定輸入執行證明。沒有把此限制降格為完整通過，也沒有把接口四登記或模型語義驗收納入本次。

`initial/main-baseline-check.json` 對提供的 `/tmp/d-verifier-handoff-main-baseline.json` 做只讀核對：4487 個已登記主區文件無變動／缺失；未核查新增文件，不將該核對解釋為對並發作者行為的歸因。交接時的文件與 plan 均保留。
