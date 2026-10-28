# G 最小版 design：歷史原始證據摘存

整理日期：2026-10-28（Asia/Tokyo）。來源：[G 詳細 design](../../superpowers/specs/2026-10-23-design-v1-g-solver-minimal.md)。以下僅逐字遷移指紋資料；各區塊標明遷移前位置。設計決定、接口契約、限制與驗證結論仍在來源文檔；本次沒有重新驗證或變更其歷史狀態。

## §9 C／RPC 源碼基線與工具版本（原第 409 行首句）

C／RPC 代碼基線為 d83a0c3024271dbf212db319e900fcf527e68b0f 加獨立工作區未提交修改，Node v26.3.0、Vitest 2.1.8；來源、配置及最終 hash 見該報告目錄。

## §9.1 候選工作區與基線 HEAD（原第 417 行第二句）

候選位於 `/Users/caihaoming/.codex/worktrees/c323/pentest-agent`，基線 HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f` 加未提交修改。
