# OS 隔離驗證工作記錄

依据：2026-10-23-g-os-isolation-verification.md；獨立 4fcd worktree。

- 主區文檔／g-c 最新原型分開複製與固定來源 hash；20 個已變文件對上 final-hashes，99 個原型文件最終無漂移。
- 先寫 a／b1／b2 候選再驗；沒有修改總設計或默認增加產品權限。
- 使用 executing-plans 與 verification-before-completion 的證據原則；依使用者範圍不 commit、刪 plan 或額外派 reviewer，由主 session 複核。
- run-1 fixture 目錄所有權失敗（1），原始 runner hash 未及凍結如實保留；run-2 修正後通過（0）；run-3 補齊 mode／版本／hash 通過（0）。快取重建改變 provenance manifest digest 後，固定 verified-4fcd 標籤，再以相同源跑完整 run-4（0），只認該批。
- a 缺非 root 切換 uid／回收權；b1 本部署 EPERM；b2 機制成立但缺產品外生命週期責任。建議主 session 評估 b2，不代為批准架構變動，產品 OS 隔離仍受阻。
- 未呼叫真實產品模型、provider 或外部靶場，未改產品代碼，未跑 npm 全套。各輪容器／volume 已清理，最終 fixture image 標籤保留。
