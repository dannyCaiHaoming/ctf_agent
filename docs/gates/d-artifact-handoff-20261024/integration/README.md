# D 接口一子區接入驗收

狀態：子區已實現並驗證，待主 session 核對，未合併主區。工作區 `/Users/caihaoming/.codex/worktrees/1488/pentest-agent`；HEAD `c652e95fc050e1c795dd55c80e6b7d95b3c6dd5b`（detached）。主區只讀；未 commit/push/merge、未新開 Codex session/子 agent、未歸檔或清理。執行使用既有無模型 OpenCode 探針的原生 runtime 會話。

## 來源與本輪差異

`document-sync.json` 記錄主區 plan／最新 D design 的來源 hash 與子區舊 hash；before 文件、starting.patch/status 保留原貌。`baseline-hash-check.json`：H7 manifest 中 16 個現存來源全吻合，僅已刪歷史 plan 不存在。`main-readonly-comparison.json` 保存主區逐文件比較與 prototype.patch 指紋；兩份 `.diff` 確認核心 v1／README 只有 D 狀態漂移後才取最新。

宿主功能、白名單及原有測試沿用已驗原型。本輪修改 plugin publish/read 描述，Recon／Solver／Engineer／Coordinator 指導及 Verifier 只讀說明；artifact-tools 首行註釋由 prototype 改為固定發布／讀取。兩個 manual 探針去除已刪 plan 依賴、加入角色來源 hash；integration label 存入本既有 gate integration 子目錄，D 配置保存代理狀態。沒有新增宿主語義、角色或權限。核心 v1／README／D 只回填子區結果，plan 保留。

## 命令與驗收

所有命令工作目錄均為上述子區，完整 log 和單獨 exit-code 保存於本目錄（H7 log 在其 integration 目錄）：

| 命令 | 結果 |
| --- | --- |
| `npx --no-install vitest run tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts tests/contract/workspace-tools.test.ts tests/contract/job-tools.test.ts tests/contract/http-tools.test.ts tests/contract/control-service.test.ts tests/contract/opencode-config.test.ts` | exit 0，7 文件 86/86；`targeted.log` |
| `npm run typecheck` | 最終 exit 0；`typecheck-final.log` |
| `npm run build` | 最終 exit 0；`build-final.log` |
| `npm test` | 最終 exit 0，44 文件 348/348；`test-final.log`，包含上述定向回歸 |
| `npx --no-install tsx tests/manual/d-artifact-handoff.ts integration-20261024-0955` | exit 0；保留成功先行批，後續僅修 plugin 行尾空白，未當作最終來源驗收 |
| `npx --no-install tsx tests/manual/d-artifact-handoff.ts integration-20261024-1000` | 最終 exit 0；同次 E 讀題 → Solver 四產物 → 原生 task → 獨立 Engineer 逐 byte/hash 讀回，sibling work 拒絕 |
| `npx --no-install tsx tests/manual/d-h7-rpc-stop.ts integration-20261024-0958` | 最終 exit 0，對照與 R1–R3 同一批全部通過 |

`commands.json` 保留兩次檢查的退出碼；`crosscheck.json` 對最終兩批的來源指紋、原始 bytes、來源 session/execution、資源及模型可見用法做獨立交叉核對。文件／腳本／job／HTTP 為 4/41/16/14 bytes，同次 27 個 loopback 預定請求及一次目標 HTTP，所有資源 settled。Coordinator/Solver/Engineer system 包含完整新版正文，兩工具描述逐字吻合 plugin；Recon/Verifier 僅驗證副本 hash 和原生 inventory 載入，未調用。

H7 四案發布 1/1/0/1，每案來源 job 和 publish 各一次；原始 stdout.bin、published bytes、來源身份／resource/callID 及真實 socket/barrier 事件保留在另一 gate 的 `integration/integration-20261024-0958/`。R1 提交後斷線，plugin 錯誤，宿主保留 bytes；R2 revoke 先於 rename 完成，零引用且無殘檔；R3 commit 先勝，native abort 丟棄遲到回复，記錄保留。沒有把後者說成插件收到遲到回复後拒絕。

Node 26.3.0、OpenCode 1.19.3、SDK/plugin 1.19.0。provider 僅 stub，baseURL 與 target 均 loopback；代理指向 loopback 拒絕端口，NO_PROXY 僅 localhost。啟動前斷言 provider/baseURL；配置與版本隨每批保存。realModelCalls=0；替身零 usage 不是實測模型消耗，真實 usage=unavailable。沒有使用真實模型/provider。

## 留存與限制

本輪無失敗驗收批；預期傳輸錯誤／取消及 Node `module.register()` deprecation 原樣留存，全部歷史失敗未改寫。先行 diff-check 發現並修正行尾空白，之後重跑最終 typecheck/build/full suite 和四產物批，不拼接版本。文檔回填晚於探針：執行時 source-hashes 不改寫，final-manifest 區分唯一的 D 文檔 hash 變更與未變的產品／探針 hash。

依使用者明確禁止子 agent，另做作者全差異自審，未發現本範圍內待修問題；不是新鮮上下文獨立評審，主核對待完成。H1 native cwd 暴露未通過；H5 可信穩定根與寫完再發布條件、unknown file producer=null、背景發布限定不變。H7 無恢復/冪等/unknown 強制鎖；真實模型遵守及選材能力未驗。候選/解法包、Verifier 綁定與結果、oracle/solved 後四接口未接入。
