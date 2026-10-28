# D 真實模型本地 Docker 完整 run（b2，2026-10-24）

結論層級：單題 `mfw` 的同一入口流程已完成 `verified`、可信完成 `accepted` 及宿主 `solved: true`。這是本地 Docker 靶場加宿主精確判官的非生產驗收，不代表生產秘密隔離已完成。

## 範圍

- Provider／模型：`volcano-coding / deepseek-v4-1-flash-261017`
- 靶場：本地 Docker `llmctf/2016q-web-mfw:latest`
- 靶場鏡像 ID：`sha256:15394bdd3844d6d002893455797f229986e40f09d3980053def061553736fdb2`
- 批次：單題、一次 run，無自動重試
- 預算：10,000,000 observable tokens；4,000 次准入；4 小時上限
- 判官：`local-mfw-exact-v1`，預期 flag 只在宿主判官進程內比對，未寫入題面或模型可見檔案

## 結果

- Run：`d-e2e-mfw-20261024-b2-1`
- Launcher 狀態：`completed`
- 時間：1,316,383 ms（約 21 分 56 秒）
- 模型准入：297 次
- Token：input 739,714、output 146,699、reasoning 178,773，合計 1,065,186；用量完整且無 provider／adapter error
- 團隊：12 個會話；Coordinator 1、Intake 1、Recon 1、Domain Solver 1、Engineer 3、Verifier 5
- 工具：401 個 settled resources；31 次 artifact publish、4 次 package publish、6 次 package prepare
- 驗證：5 次 report 工具呼叫，4 份獲宿主登記；3 份 `inconclusive`，最後一份 `verified`，另 1 次 conflicting report 被拒絕
- 可信完成：候選 hash `6da85c37a66be677c5e96591f4f06b9a253b8ee6770ae06088d8e0215ac41fb3`、33 bytes；判官回應 `accepted`，完成狀態 `confirmed`，`solved: true`

最終 verified report 使用 `recompute` 模式，包含 5 項 evidence、2 項 assumed premise、0 個未解 issue；宿主檢查 `candidateEqual: true`、無 blocker。宿主仍只證明機械綁定與候選 bytes，不把 Verifier 的語義判斷冒充成數學證明。

## 預算校準

原 run `d-e2e-mfw-20261024-1` 的 250,000 token 是整個 run 隔離帳本，由所有角色共用，不是每個角色或每次模型呼叫各自額度；它在 98 次准入後停止，沒有完成報告。此次保留同一單題範圍，另授權一次 10,000,000 token 批次，最終實際使用 1,065,186，約占上限 10.65%。因此：

- 250,000 對這次首次完整團隊流程確實不足；
- 1,000,000 以上對這道題已有足夠餘量，但不同題目與重試次數不可直接外推；
- 10,000,000 是上限而非消耗目標，本次沒有為用完預算而延長或重送。

## 工具呼叫復盤與路徑說明修正

逐會話訊息共記錄 442 次工具呼叫：423 次完成、19 次錯誤，成功率約 95.7%。錯誤分類為：11 次 workspace 虛擬路徑用法錯誤、3 次呼叫不存在的 `invalid` 工具、3 次原生 `read` 嘗試控制／配置目錄而由宿主拒絕、1 次錯誤 artifact source 引用，以及 1 次 conflicting verification report。後兩類與控制目錄拒絕均為宿主正確攔截；沒有 provider／adapter、job 收束或工具生命週期故障。兩次候選 bytes mismatch 屬正常驗證修正。

11 次 workspace 誤用集中於把 `.`、`materials/mfw`、`work/src-mfw` 當成可列舉路徑，以及一次缺少 `work/` 前綴的 Verifier 寫入。既有嚴格虛擬根與寫入權限正確，沒有放寬；修正只補齊四個 workspace 工具的模型可見描述，並在 `product/AGENTS.md` 加入三根、省略 path、讀寫前綴及 `materials/` 題目隔離示例。導向設計與取捨見 [G run 復盤 design](../../superpowers/specs/2026-10-24-design-v1-g-run-review-and-path-affordance.md)。

修正後定向 2 檔／17 項、全套 48 檔／404 項測試通過，typecheck 與 build 均 exit 0。本 gate 沒有再次調用真實模型，因此不能證明後續模型必然遵循新說明；原始訊息、推理、候選及預期答案沒有寫入本報告或 repo。

## 限制

- G 的同 UID 隔離缺口仍在；本地精確判官可用不代表可安全承載生產級私有秘密。
- `verified` 是版本綁定的 Verifier 判斷加宿主機械檢查，不是對任意錯誤論證能力的完備證明。
- 本報告不保存候選原文、預期 flag 或模型私有推理。完整原始 run 位於 `~/Documents/pentest-agent-run-data/d-e2e-mfw-20261024-b2/runs/d-e2e-mfw-20261024-b2-1/`。
