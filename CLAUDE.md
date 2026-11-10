# CLAUDE.md

本檔只放 Claude Code 專屬的協作約定。工作模式、授權、預算、design／plan 規則與驗收見 [`AGENTS.md`](AGENTS.md)，按任務需要閱讀，這裡不複述。

## 文檔入口

- **倉庫開發規矩**：[`AGENTS.md`](AGENTS.md)。
- **架構與產品依據**：[核心設計 v1](docs/superpowers/specs/2026-10-22-ctf-agent-design-v1.md)。
- **現狀與教訓**：[現狀、教訓與遷移記錄](docs/superpowers/specs/2026-10-22-ctf-agent-current-state-and-migration.md)。

按任務讀相關章節，不預載整套 design 或歷史 run。`product/AGENTS.md`、角色與 Skill 是產品資產，不是給開發助手的角色指令。

## 工程會話的約定

Claude Code 會話開發 harness（host、控制層、OpenCode 接入、測試與文檔），解題由運行時的 Solver 完成。

- **說清操作對象。** 用工程對象本身的名字描述工作，例如「核對 launcher 的結果狀態」「修改 `packages/...` 的 trace 寫出」。
- **證據只給定位。** run 證據只引用路徑、結構化摘要和所需字段；需要原文時用 `jq`／`grep`／`sed -n` 取具體行，不整份讀入。
- **效率分析先取投影。** 延遲、token、tool call 次數與重複、交接輪數從 `progress.jsonl`、`control-audit.json`、`metadata.json` 計算；不為此整段讀入 transcript。
- **用詞按工程對象。** 寫 launcher、trace、tool call、預算、metadata 這類名字，不寫交戰語彙或行動代號；描述失準就改準確，不改事實。

### 回覆被中止時

- 保留已落盤結果，核對在途操作與副作用。
- 看中止前讀進了什麼：若是原始 run 輸出或題目材料，改用結構化摘要或具體字段繼續；屬於題目層面的部分拆到實驗模式的 session。
- 重試保持請求的對象、範圍與表述不變；確需改變時先向用戶說明。純工程任務仍反覆被中止時，向用戶說明位置與已完成部分，由用戶決定如何拆分。

## Plan 的 §0

- 簡單修改直接完成；需要 plan 時，§0 寫當前可交付目標、範圍、設計依據、完成條件與授權來源。
- 已授權範圍內連續完成必要修改與驗證；只在目標、設計或成本邊界改變、遇到阻塞或用戶指定暫停點時交回。
- 某步結果讓後續步驟失去意義時，停止無效步驟，改走 design 中的備案；沒有備案就說明待決差異。
- 結論回寫對應 design 章節，不另造交接文件。

## 模型分工與交接

- 分工是可選的。已明確的機械修改可交給較便宜的模型；運行時除錯、跨組件設計與證據判斷用能力合適的模型。
- 失敗先判斷是規格、環境、接口還是能力原因；升級模型不代替診斷。
- 獨立並行或會與已有修改衝突的任務才開新 worktree。新 worktree 不含未提交修改，交接時明確傳遞所需差異；不為交接擅自 commit、stash 或 reset。
- 交接 brief 帶：目標與操作對象、設計依據與完成條件、工作區基線與修改歸屬、授權來源（涉及模型運行時帶目標、模型／provider、批次與剩餘預算）、證據定位、已知失敗與待驗證項。未經明確授權不 commit／push；跑完就停。

<!-- handoff:learnings:begin -->
## Session Learnings (auto-updated by handoff)

### Implicit Rules
- Replies to user in Traditional Chinese
- Design docs mixed: ~10 simplified, ~12 traditional; core design-v1 mixes both
- Design = current decision snapshot, not run log (AGENTS.md); evidence detail belongs in docs/gates or docs/superpowers/analysis
- Commit/push only on explicit user request; stash@{0} entangled-0.2+C-quarantine-20261020 left untouched

### Key Decisions
- Decision: bounded read of existing run evidence = engineering mode; experiment mode only for contacting challenge services, running challenge scripts, real solves — Reason: old wording made models refuse offline review, looked like safety block
- Decision: closed small sub-slices merge into parent design then delete, originals in git history — Reason: doc count only grew; AGENTS.md now states this
- Decision: design-b §8 headings date-free (8 收敛子片 / 8.1 显式线索帐本 / 8.2 路线优先级的 Skill 内容增量) — Reason: stable GitHub anchors for inbound links
- Decision: fix status lines only where contradicting facts, no mass reformat — Reason: most designs already state status in date line
- Decision: no bulk simplified/traditional conversion; unify per rewritten paragraph — Reason: avoid huge diffs

<!-- handoff:learnings:end -->
