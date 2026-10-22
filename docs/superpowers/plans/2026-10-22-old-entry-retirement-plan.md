# 舊入口與死代碼退役：實現計劃

記錄日期：2026-10-22（Asia/Tokyo）。

依據：[入口與本地調試詳細 design](../specs/2026-10-22-design-v1-entry-local-debug.md)（下稱入口 design）第 1 節「退場」段與第 3 節控制服務職責；[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）1.2、1.6、第 4 節實施原則。

本文是 §0 交接物：執行模型照 §0 做完、記錄結果後停下。

---

## 這份 plan 要達成的能力

刪除已被新入口取代、或已無任何消費者的程式與測試，使倉庫只剩服務 design v1 目標架構的部分：

- 宿主經 SDK 編排 OpenCode 的舊入口（單一 Solver、硬編碼 prompt、工具回調轉發）；
- `--trajectory` 測試專用路徑及其寫死的 fixture flag（違反 design v1 1.6「不維護測試專用 Solver」）；
- 沒有消費者的死代碼與只被自身測試引用的模組。

**保留控制服務以後要接線的能力模組**（design v1 D、入口 design 第 3 節）：`packages/runtime`、`state`、`artifacts`、`contracts`、`policy`、`platform`、`local-oracle`，以及 `packages/supervisor` 的 `responsibilities.ts`、`candidate-control.ts`、`candidate-verification.ts`、`long-job-watch.ts`、`compaction.ts`、`local-resume.ts`、`hypotheses.ts`、`multiflag.ts`，以及 `packages/state/src/hypothesis-snapshot.ts`；`fixtures/trajectories/` 與覆蓋這些模組的測試一併保留。保留理由是它們對應 design v1 D 的獨立驗證與可信提交能力，不是為了讓舊入口可運行。

**保留 `ctf-agent resume`**（使用者 2026-10-22 決定）：恢復能力的去留等恢復相關 design 定稿，本步不動 `resume.ts`、`local-resume.ts`、`compaction.ts`。

完成後的預期狀態：`npm test` 回到乾淨基線（現有 4 個已知失敗隨其測試對象一併消失）；**在 design v1 C 實作完成前沒有可用的解題路徑**——新入口 `apps/launcher` 能啟動產品角色，但受管工具、候選登記與驗證尚未接通。這是本步的已知代價，報告中須如實陳述。

---

## §0 當前這一步：刪除舊入口、軌跡路徑與死代碼

本 plan 的唯一一步。三類刪除互相牽連（舊入口持有軌跡分支，軌跡模組只被舊入口使用），合為一次可驗收的修改。

### §0.1 執行模型與理由

**Sonnet 5.5。** 理由：刪除清單已在 §0.3 寫定，但刪除後需判斷連帶影響——哪些測試隨對象消失、哪個保留模組因失去唯一消費者而需要調整導出、`main.ts` 與 `package.json` 的殘留引用如何收口。這屬 CLAUDE.md 模型分工表第二類（需在 §0 範圍內做局部判斷），不是純清單執行。

### §0.2 授權範圍

| 項目 | 本步授權 |
| --- | --- |
| 工作區 | 自己的 git worktree（基於當前 `main`）；不在主工作區寫任何檔 |
| 刪除 | **只限 §0.3 列出的路徑**，以及其中模組的專屬測試（§0.3 D） |
| 修改 | 只限 §0.3 E 列出的檔案 |
| 真實模型調用 | 不允許，token 0 |
| 運行 | `npm run typecheck`、`npm run build`、`npm run test:deterministic`、`npm test` |
| 依賴安裝 | 不允許 |
| commit／push | 不允許 |

### §0.3 刪除與修改清單

**A. 舊入口（宿主 SDK 編排）**

| 路徑 | 理由 |
| --- | --- |
| `apps/cli/src/commands/solve.ts` | 舊入口轉發層，只呼叫 `solveM1` |
| `apps/cli/src/commands/solveM1.ts` | 宿主建立會話、硬編碼 Solver prompt、預載 Skill 全文、組裝工具配置；入口 design 第 1 節退場對象 |
| `apps/cli/src/commands/openCodeTask.ts` | 單一 Solver 的會話檢查與工具回調轉發；同上 |
| `apps/cli/src/commands/localHttpCandidateResolver.ts` | 舊 Web 入口專用的候選解析與重放編排；其覆蓋的能力由控制服務按 design v1 D 重新接線，保留的 `candidate-verification.ts` 即該能力所在 |
| `apps/cli/src/commands/runPostmortem.ts` | 舊入口專用的 run 復盤輸出，只被 `solveM1`／`openCodeTask` 使用 |

**B. 測試專用軌跡路徑**

| 路徑 | 理由 |
| --- | --- |
| `apps/cli/src/commands/localJobCandidateResolver.ts` | 只被 `solveM1.ts` 的 `--trajectory t1/t2` 分支使用；寫死的 fixture flag 本身在 `solveM1.ts` 內，隨 A 組一併消失 |

> **修正（2026-10-22，實作中發現）**：原列的 `packages/supervisor/src/hypotheses.ts`、`packages/state/src/hypothesis-snapshot.ts`、`packages/supervisor/src/multiflag.ts` **改為保留**。核實後它們的消費者不只舊入口：`hypothesis-snapshot` 是 `packages/state/src/snapshot.ts` 快照 schema 的必含欄位（`hypothesis_manager`）且有校驗邏輯；`hypotheses.ts` 被保留的 `supervisor/compaction.ts`、`candidate-control.ts` 使用，而 `compaction.ts` 服務保留的 `local-resume.ts` 與 `resume` 指令；`multiflag.ts` 被保留的 `candidate-verification.ts`（`VerifiedMultiFlagCandidateResolver`）使用，多 flag 的部分接受是 design v1 1.3 的要求。刪除它們須重寫快照 schema 與 compaction／resume，屬 §0.5 禁止的重構，也與「保留 `resume`」的決定衝突。

**C. 死代碼與只被自身測試引用的模組**

| 路徑 | 理由 |
| --- | --- |
| `apps/cli/src/commands/localHttpFindingResolver.ts` | 倉庫內無任何引用，無測試 |
| `packages/opencode-bridge/src/compaction.ts` | 經 `index.ts` 導出但無消費者 |
| `packages/supervisor/src/revisions.ts` | 只被其自身的兩個測試引用 |
| `packages/supervisor/src/http-progress-adjudicator.ts` | 只被其自身的測試引用 |

**D. 隨上述對象消失的測試**（逐一確認其唯一對象已刪除後才刪）

`tests/integration/cli-m1-solve.test.ts`、`cli-m1-http-solve.test.ts`、`local-http-candidate-resolver.test.ts`、`opencode-web-control.test.ts`、`opencode-solve.test.ts`、`smoke-solve.test.ts`、`run-postmortem.test.ts`、`opencode-fixture.ts`（舊 CLI 的 fixture harness，只被上述測試使用）、`http-progress-adjudicator.test.ts`、`responsibility-revisions.test.ts`。

`tests/integration/candidate-verification.test.ts`、`long-job-continuation.test.ts`、`compaction-*.test.ts`（除 `compaction-hypotheses`）、`responsibility-artifacts.test.ts`、`responsibility-handoff.test.ts`、`responsibility-sessions.test.ts`、`multiflag-continuation.test.ts`、`verified-multiflag-candidate.test.ts`、`compaction-hypotheses.test.ts`、`hypothesis-lifecycle.test.ts`、`hypothesis-progress.test.ts`、`hypothesis-routes.test.ts`、`hypothesis-fixtures.ts` 與 `tests/contract/`、`tests/bootstrap/` 其餘測試**保留**；若其中有檔案同時引用已刪模組（例如 `responsibility-artifacts.test.ts` 引用 `revisions.ts`），只移除與已刪模組相關的用例與 import，保留其餘斷言，不整檔刪除。

**E. 連帶修改**

| 檔案 | 改動 |
| --- | --- |
| `apps/cli/src/main.ts` | 移除 `solve` 指令註冊、其參數解析與 `--help` 中的 `solve` 一行；保留 `resume` 指令與 `loadLocalEnv`。若移除後 `main.ts` 只剩 `resume`，保持其可運行，不另加指令 |
| `packages/supervisor/src/index.ts` | 移除已刪模組的 `export`；保留其餘導出 |
| `packages/opencode-bridge/src/index.ts` | 移除 `./compaction.js` 的 `export` |
| `packages/supervisor/src/candidate-control.ts`、`candidate-verification.ts` 等保留模組 | 僅在其 import 的模組被本步刪除時，移除該 import 與因此失效的分支；按修正後的清單 `hypotheses`、`multiflag`、`hypothesis-snapshot` 均保留，預期無需改動。不為維持舊行為新增替代實作 |
| `package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts` | 移除指向已刪路徑的腳本、別名或 include 條目（若有）；保留 `typecheck`、`build`、`test`、`test:deterministic`、`cli`、`target:start` |
| `docs/superpowers/README.md` | 「当前状态」一節：移除「`npm test` 有 4 个已知失败」與入口 design 行的「現行 `solveM1` 單一 Solver 入口退場」未實作項，改為已完成；新增一行記錄本步後沒有可用解題路徑 |
| `docs/superpowers/specs/2026-10-22-design-v1-entry-local-debug.md` | 第 1 節「退場」段改為已執行的陳述（保留其內容依據），不改其他章節 |

**不動**：`apps/launcher/`、`product/`、`apps/opencode-plugin/`、`packages/opencode-bridge/src/server.ts`、`fixtures/`（含 `trajectories/`、`local-target/`）、`docs/gates/`、`AGENTS.md`、`CLAUDE.md`。

### §0.4 行為判據

1. `npm run typecheck`、`npm run build`、`npm run test:deterministic` 退出碼 0。
2. `npm test` 退出碼 0，且**無任何失敗或跳過的未說明項**：原有 4 個已知失敗與 `smoke-solve` 的 budget 失敗均隨其測試對象刪除而消失。若仍有失敗，逐項說明原因，不得以「原本就失敗」帶過。
3. 倉庫內（排除 `node_modules/`、`runs/`、`dist/`、`.git/`）搜尋每一個已刪檔名與符號（`solveM1`、`openCodeTask`、`localHttpCandidateResolver`、`localJobCandidateResolver`、`localHttpFindingResolver`、`runPostmortem`、`revisions`／`PublishedRevisionService`、`http-progress-adjudicator`），結果不得出現在 `import`、`export`、腳本、配置或 Markdown 鏈接中；僅允許出現在 `docs/gates/` 的歷史報告與遷移記錄的歷史敘述裡。
4. `ctf-agent resume` 仍可運行：`npm run cli -- --help` 列出 `resume`、不再列出 `solve`，退出碼與現行一致。
5. `apps/launcher` 不受影響：以 loopback 替身 provider 跑一輪，退出碼 0，角色與 Skill 仍正確載入（沿用框架步驟的驗證方式，驗證腳本放 `scratch/`，不提交）。
6. 保留清單中的模組與測試仍存在且通過；`fixtures/trajectories/` 未被刪除。
7. `git status` 的改動只涉及 §0.3 列出的路徑。

### §0.5 禁做清單

- 刪除只限 §0.3 所列路徑及其專屬測試。不刪保留清單中的能力模組、`fixtures/`、`apps/launcher/`、`product/`、`apps/opencode-plugin/`、`docs/gates/`。
- 不為保持舊入口或舊測試可運行新增相容層、替代實作或 stub；也不把被刪測試的斷言搬到別處。
- 不重構保留模組：只移除對已刪模組的引用與因此失效的分支，不改名、不搬移、不調整其介面。
- 不實作控制服務、產品插件、受管工具、身份綁定、預算准入、候選登記或平台提交（依賴 design v1 C 的詳細 design）。
- 不新增 fixture／gate／軌跡／里程碑／通用框架或抽象；不新增測試，除非某保留模組的既有覆蓋因本步刪除而完全消失，此時只補最小定向測試並在報告中說明。
- 不恢復舊 M0–M6／M1B 軌跡；不接入 TSecBench；不做 Docker 構建。
- 不調用真實模型、不接真實 provider、靶場或平台；不安裝依賴。
- 驗收按 design v1 1.6 分層陳述：測試全綠只代表裝配，且本步**降低**了產品能力（解題路徑暫時消失），報告不得暗示產品更接近可用。
- 不改任何 design 的其他章節、`AGENTS.md`、`CLAUDE.md`；不 commit、不 push；跑完就停。

### §0.6 收尾報告

報告需含：實際刪除的路徑清單（與 §0.3 的差異逐項說明原因）；§0.3 E 各項連帶修改的落地情況；§0.4 逐條實測結果（含 `npm test` 改動前後對照、`--help` 輸出、launcher 一輪運行結果）；因失去唯一消費者而變成未接線的保留模組清單（供 C 實作時接線）；worktree 路徑與 `git status`。

---

## 後續步驟（只列標題，按本步結果重寫）

- **design v1 C 詳細 design**：多 Agent 身份綁定、控制服務接線、逐次預算准入，連同 H 角色權限落地。
- **控制服務實作**：把保留的能力模組接到控制服務，恢復候選登記與獨立驗證，之後才能跑真實模型。
