# D 真實模型本地 Docker 整鏈調試（2026-10-24）

結論層級：真實模型與本地 Docker 靶場鏈路已走到獨立 Verifier 的真實重放，但未完成驗證報告登記，故本次 run **不是 verified，也不是 solved**；狀態為 `budget_exceeded`，保留為 candidate-only 調試證據。

## 範圍與環境

- 模型：`volcano-coding/deepseek-v4-1-flash-261017`
- 產品版本：`73e4121fc5669c3d15512af52ed26a6a258c418b`
- 靶場：本地 Docker `llmctf/2016q-web-mfw:latest`，只綁定 `127.0.0.1:8010`
- 鏡像 ID：`sha256:15394bdd3844d6d002893455797f229986e40f09d3980053def061553736fdb2`
- 題目附件：`src.tar.gz`，sha256 `a5bbbaac446ff08e8d80c1d259cedcc9bac952804ec386e451893186576f0b00`
- 批次上限：180 次准入、250,000 observable tokens、20 分鐘；只跑一次，無自動重試
- 預期 flag 只在宿主判官進程內比對，未寫入題面或模型可見檔案

## 實際結果

- `d-e2e-mfw-20261024-1` 在 295 秒後停止：98 次准入，input 188,351、output 36,552、reasoning 27,050，合計 251,953，因此由 token 預算停止；無 provider／adapter 錯誤。
- 已執行 E 取題、Recon／Domain Solver 工具操作、17 次 artifact 發布、Engineer 固定候選與解法包、Coordinator 指定 version 分派獨立 Verifier。
- Verifier 使用 `package.prepare` 的固定輸入執行包內腳本，並另寫 live probe 重現目標資料流與版本條件；未發出 `verification.report`。
- `verification-results` 與 `completion-results` 均為空，因此沒有可信完成或 solved。

## 具體接口摩擦

- `package.prepare` 原本只返回 work 相對路徑；Verifier 先按該值直接交給 workspace 工具，收到 3 次 `denied: workspace path`，再列目錄自行恢復。本次已用失敗測試先行的方式補上 `workspaceDirectory`／`workspaceManifestPath`／`workspaceCandidatePath`，並更新工具與角色說明。
- Intake 的 3 次原生 `read path` 拒絕沒有繞過材料工具；不是本輪阻斷原因。
- 預算耗盡發生在 Verifier 已取得 live 證據後、報告登記前。要完成整鏈需另行授權新批次與更高預算，不能用人工補登或降級報告冒充原 run 完成。

## 證據邊界

本目錄只保留不含 flag 的運行摘要。完整原始 run 位於 `~/Documents/pentest-agent-run-data/d-e2e-mfw-20261024/runs/d-e2e-mfw-20261024-1/`，其中模型消息含候選與推理，不作公開轉錄。同 UID 隔離缺口不因本地精確判官而消失。
