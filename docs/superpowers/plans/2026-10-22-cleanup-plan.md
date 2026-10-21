# 倉庫精簡（清理）計劃

記錄日期：2026-10-22（Asia/Tokyo）。

依據：[CTF Agent 核心設計 v1](../specs/2026-10-22-ctf-agent-design-v1.md)（下稱 design v1）第 4 節，以及[現狀、教訓與遷移記錄](../specs/2026-10-22-ctf-agent-current-state-and-migration.md)（下稱遷移記錄）第 1、5 節。清理是 design v1 的第一個交付：以 design v1 判斷刪除與保留，不以保持舊 CLI、gate、調試入口可運行為前提，也不為維持它們新增相容層。

本文是交給實作模型的 §0 交接物。**刪除與保留已在 §0.4／§0.5 定稿，實作時不另行判斷去留，只照清單執行**；清單沒列到的檔案一律不動。

---

## §0 當前卡點與這一步要做的事

卡點：倉庫同時存在 design v1 的目標架構依據，和一整套為已否定架構（單 Solver、M0–M6／M1B 軌跡、里程碑 gate、歷史驗收證據）服務的程式、測試、配置與文檔。這批內容讓「現狀」無法被可靠閱讀，也讓後續按目標架構重建時每一步都要先繞過舊包袱。這一步只做精簡與同一變更內的連帶文檔收斂，不重建任何能力。

### §0.1 前置條件：未提交改動須先由使用者決定（開始清理前的硬性阻塞）

主工作區目前有一批**不是本任務產生**的未提交改動與未追蹤檔案。它們與清理範圍交錯（例如 `apps/cli/src/commands/openCodeTask.ts` 已 import 未追蹤的 `runPostmortem.ts`；`AGENTS.md`、`docs/superpowers/README.md` 本身待修改；`docs/gates/` 下三個未追蹤證據目錄正是清理對象），**在使用者決定前不得開始任何刪除或修改**。

實作模型開工第一件事：執行 `git status --porcelain`，與下表核對。若與下表不一致（其他會話仍在改動），停下並報告差異，不自行推進。

**已追蹤、已修改（`M`）：**

| 路徑 | 與清理的關係 |
| --- | --- |
| `AGENTS.md` | §0.5 要在同一變更內收斂此檔 |
| `apps/cli/src/commands/localHttpCandidateResolver.ts` | 控制層相鄰，本輪保留（§0.4） |
| `apps/cli/src/commands/openCodeTask.ts` | 控制層，本輪保留 |
| `apps/cli/src/commands/solveM1.ts` | 舊產品入口，本輪保留（§0.4 理由） |
| `apps/cli/src/main.ts` | §0.5 需移除 `doctor` 指令註冊 |
| `apps/opencode-plugin/src/index.ts` | 控制層，本輪保留 |
| `docs/superpowers/README.md` | §0.5 要改寫 |
| `docs/superpowers/plans/2026-10-16-ctf-agent-mvp-roadmap.md` | §0.4 刪除清單內 |
| `docs/superpowers/plans/2026-10-17-m0-host-foundation-plan.md` | §0.4 刪除清單內 |
| `docs/superpowers/plans/2026-10-18-m1-solver-loop-plan.md` | §0.4 刪除清單內 |
| `docs/superpowers/plans/2026-10-19-m1b-trajectory-2-plan.md` | §0.4 刪除清單內 |
| `docs/superpowers/plans/2026-10-20-m1b-trajectories-3-6-plan.md` | §0.4 刪除清單內 |
| `docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md` | §0.4 刪除清單內 |
| `packages/runtime/src/index.ts` | 控制層，本輪保留 |
| `packages/state/src/index.ts` | 控制層依賴，本輪保留 |
| `tests/integration/opencode-fixture.ts` | 保留 |
| `tests/integration/opencode-solve.test.ts` | 保留 |
| `tests/integration/opencode-web-control.test.ts` | 保留 |

**未追蹤（`??`）：**

| 路徑 | 說明 |
| --- | --- |
| `apps/cli/src/commands/localHttpFindingResolver.ts` | 新增的確定性 finding 解析，已被其他改動引用 |
| `apps/cli/src/commands/runPostmortem.ts` | 新增 run 復盤，被已修改的 `openCodeTask.ts` import |
| `packages/runtime/src/tarGzip.ts` | 新增歸檔解包能力 |
| `tests/integration/local-http-candidate-resolver.test.ts` | 上述新增程式的測試 |
| `tests/integration/run-postmortem.test.ts` | 同上 |
| `tests/integration/runtime-http-session.test.ts` | 同上 |
| `tests/integration/runtime-tar-gzip.test.ts` | 同上 |
| `skills/web-session-diagnosis/` | 已審核 Web Skill 與附屬 Reference（design v1 B 的保留對象） |
| `docs/gates/m1-autonomous-first-challenge/` | 內含 `task-a-20261021-mfw/result.md`，是遷移記錄第 4 節 MFW 結論的唯一本地記述 |
| `docs/gates/m1-web-validation/` | 約 3.1 MB，五次 Throwback run 的輸出與復盤 |
| `docs/gates/m1b-dvga-private-paste-20261020/` | 約 2.7 MB，DVGA 軌跡資料 |
| `docs/superpowers/plans/2026-10-20-autonomous-first-challenge-plan.md` | 舊主線計劃草稿 |
| `docs/superpowers/plans/2026-10-20-m1-autonomous-first-challenge-plan.md` | 舊主線計劃，被 `AGENTS.md`、遷移記錄第 5 節引用 |

**需使用者先決定：把上述改動 commit 成一個快照，還是丟棄**，兩者都可以，但必須由使用者選，清理才能開始。實作模型不替使用者決定、不 commit、不 `stash`、不 `reset`、不 `checkout --`、不刪除任何未追蹤檔案。

決定落地後對清理的影響，照以下規則（不需再請示）：

- 選 **commit 成快照**：上表未追蹤的 `docs/gates/` 三個目錄與兩份舊 plan 隨即成為已追蹤檔案，一併按 §0.4 的 `docs/gates/`、`plans/` 規則刪除，但 `docs/gates/m1-autonomous-first-challenge/task-a-20261021-mfw/result.md` 保留（遷移記錄第 4 節 MFW 結論的最小證據）。`skills/`、`runPostmortem.ts`、`localHttpFindingResolver.ts`、`tarGzip.ts` 及其四個測試保留。
- 選 **丟棄**：由使用者自己執行丟棄；實作模型只在工作區乾淨後開始，清理範圍只包含 §0.4 列出的已追蹤內容，`docs/gates/` 的三個未追蹤目錄與兩份未追蹤 plan 屆時已不存在，不需處理。此時遷移記錄第 4 節的 MFW 記述按 §0.5 標成歷史摘要。

### §0.2 本步授權範圍

- **允許刪除**：僅限 §0.4 刪除清單逐項列出的路徑。
- **不授權真實模型調用**：本步不啟動 OpenCode 模型會話、不碰 provider、不接靶場、不跑任何需要 token 的 run。可跑的只有 `npm run typecheck`、`npm run build`、`vitest`。
- **不授權 commit／push**：改完就停，由使用者審閱。
- **不碰倉庫外資料與他人進行中的工作**：`runs/`、`dist/` 已被 `.gitignore` 忽略，屬使用者本地 run 資料，不在本輪刪除範圍；`node_modules/` 不動。

### §0.3 要改哪幾個檔（總覽）

刪除：`archive/`、`packages/{reference,reporting,browser}`、`packages/supervisor/src/domain-*.ts` 與 `src/skills/`、`fixtures/{challenges,reference-snapshot,broker,local-oracle}`、`tests/gates/`、九個測試檔、`docs/superpowers/` 下的舊 spec／roadmap／里程碑 plan／reviews、`docs/gates/` 絕大部分、`config/` 九份歷史配置。
修改：`package.json`、`tsconfig.json`、`vitest.config.ts`、`apps/cli/src/main.ts`、`tests/bootstrap/test-harness.test.ts`、`AGENTS.md`、`CLAUDE.md`、`docs/superpowers/README.md`、`config/README.md`、遷移記錄。

### §0.4 刪除清單（逐項執行，不自行增刪）

#### A. 退役程式與其專屬測試

| 刪除路徑 | 理由（依據） |
| --- | --- |
| `archive/pre-opencode-20261019/`（整個 `archive/`） | 退役的 `ProviderSolverDriver`／`solver-loop` 及其測試；design v1 1.2 不再有直連 provider 的求解循環，遷移記錄第 1 節明確不靠 archive 假裝精簡 |
| `packages/reference/`（含 `src/index.ts`） | design v1 B 改用原生 `skill`／`references` 載入知識；此實作在現行入口無任何消費者（僅自身兩個測試），遷移記錄 3.8 要求按新架構判斷去留 |
| `tests/contract/reference-service.test.ts`、`tests/contract/reference-boundaries.test.ts` | 隨 `packages/reference` 一起刪除 |
| `fixtures/reference-snapshot/` | 僅服務上述兩個測試與已刪除的 gate manifest |
| `packages/reporting/` | M1 run metrics 聚合層；遷移記錄第 4 節明確不保留舊報告生成層，design v1 1.3 只要求分開記錄結果，不要求這套聚合 |
| `tests/contract/metrics.test.ts` | `packages/reporting` 的唯一消費者 |
| `packages/browser/` | 只是 Playwright 啟動探測包裝；design v1 G 把瀏覽器接口與 ARM64 依賴列為待決項，且 1.5 不以工具清單代替可用性驗證，保留此包裝沒有新架構用途 |
| `apps/cli/src/commands/doctor.ts` | `packages/browser` 的唯一消費者，是 M0 的 capability 探測入口；design v1 1.2 要求 CLI 只做啟動、配置與狀態呈現 |
| `tests/contract/browser.test.ts` | 隨 `packages/browser` 一起刪除 |
| `packages/supervisor/src/domain-web.ts`、`domain-misc.ts`、`domain-crypto.ts`、`domain-candidates.ts` | 宿主側領域方法庫與候選登記；design v1 G 明確「不是新增三套 CLI 或三個硬編碼求解循環」，領域方法歸 Agent 文檔與 Skills。這四個檔未被 `packages/supervisor/src/index.ts` 導出，僅由下列測試引用 |
| `packages/supervisor/src/skills/`（`index.ts`、`web.ts`、`misc.ts`、`crypto.ts`） | 宿主讀取並預載 Skill 正文的接法；design v1 B 要求移除全文預載、改原生按需載入（遷移記錄 2 的 Skill 行） |
| `tests/integration/domain-web.test.ts`、`domain-misc.test.ts`、`domain-crypto.test.ts`、`domain-fix1.test.ts`、`domain-methods.test.ts` | 上述領域模組與 `skills/` 的唯一消費者 |
| `fixtures/challenges/`（`web/`、`misc/`、`crypto/`） | 僅服務上述三個 domain 測試 |
| `fixtures/broker/` | 只被已刪除的 gate manifest 引用，沒有程式消費者 |
| `fixtures/local-oracle/` | 無任何程式或測試消費者（`packages/local-oracle` 另有消費者，見 §0.5 保留） |

#### B. 里程碑 gate 與軌跡專用測試

| 刪除路徑 | 理由 |
| --- | --- |
| `tests/gates/m0.gate.ts`、`m1.gate.ts`、`m1b-t2.gate.ts`（整個 `tests/gates/`） | 里程碑驗收儀式；design v1 1.6 與遷移記錄第 1、4 節要求移除失去用途的 gate，不為歷史全綠維持已否定架構 |
| `tests/integration/opencode-t2.test.ts` | M1B 軌跡②專用 |
| `tests/contract/m1-td-stop.test.ts`、`tests/contract/m1b-t2-stop.test.ts` | 兩個已凍結批次的停止條件斷言 |

> `fixtures/trajectories/` **保留**（§0.4 不刪），理由見 §0.5。

#### C. 設計與計劃文檔

| 刪除路徑 | 理由 |
| --- | --- |
| `docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md` | 舊權威設計，已被 design v1 取代；承接與不繼承的內容見遷移記錄第 5 節 |
| `docs/superpowers/specs/archive/2026-10-13-ctf-solving-agent-design.md`（整個 `specs/archive/`） | 舊設計的 brainstorm 前身 |
| `docs/superpowers/plans/2026-10-16-ctf-agent-mvp-roadmap.md` | M0–M6 路線圖，有效結論已入遷移記錄第 5 節；design v1 不排階段 roadmap |
| `docs/superpowers/plans/2026-10-17-m0-host-foundation-plan.md` | M0 里程碑計劃 |
| `docs/superpowers/plans/2026-10-18-m1-solver-loop-plan.md` | 已凍結 M1 軌跡①計劃 |
| `docs/superpowers/plans/2026-10-19-m1b-trajectory-2-plan.md` | 已凍結 M1B 軌跡②計劃 |
| `docs/superpowers/plans/2026-10-20-m1b-trajectories-3-6-plan.md` | 已凍結 M1B 軌跡③–⑥計劃 |
| `docs/superpowers/plans/archive/2026-10-15-general-ctf-agent-system-implementation.md`（整個 `plans/archive/`） | 已廢棄的單體實作計劃 |
| `docs/superpowers/plans/history/2026-10-19-m1-retrospectives.md`（整個 `plans/history/`） | 歷史復盤，教訓已摘入遷移記錄第 4 節 |
| `docs/superpowers/reviews/`（整個目錄，含 `archive/` 兩份評審） | 對已刪除 spec 與單體計劃的歷史評審，無進行中評審 |
| `docs/superpowers/plans/2026-10-20-m1-autonomous-first-challenge-plan.md`、`docs/superpowers/plans/2026-10-20-autonomous-first-challenge-plan.md` | 舊主線計劃；**僅在 §0.1 選「commit 成快照」時刪除**，選「丟棄」時這兩份已不存在 |

保留 `docs/superpowers/specs/2026-10-22-ctf-agent-design-v1.md`、`docs/superpowers/specs/2026-10-22-ctf-agent-current-state-and-migration.md` 與本計劃。

#### D. `docs/gates/` 驗收資料

規則：**刪除 `docs/gates/` 下全部內容，只保留以下兩項**，然後讓 `docs/gates/` 只剩這兩項。

保留：

- `docs/gates/t0c-arm64-results.md` — 原生 ARM64 實測結論，直接支撐 design v1 F 與第 3 節「工具套件、版本與 ARM64 可用性」待決項。
- `docs/gates/m1-autonomous-first-challenge/task-a-20261021-mfw/result.md` — 遷移記錄第 4 節 MFW 單題結論的最小記述（僅在 §0.1 選「commit 成快照」時存在；選「丟棄」時此檔已不存在，照 §0.5 把該記述標成歷史摘要）。

刪除（已追蹤部分逐項）：`m0-inputs.md`、`m1-inputs.md`、`m1-results.md`、`m1-task1-results.md`、`m1-task2-results.md`、`m1-task3-results.md`、`m1-task3b-results.md`、`m1-task4-results.md`、`m1-task5-results.md`、`m1-opencode-integration-results.md`、`m1-opencode-evidence-20261019.json`、`m1-m0-retirement-20261019.json`、`m1-path-retirement-20261019.md`、`m1-t1-acceptance.py`、`m1-t1-dispatch-20261019.json`、`m1-t1-formal-20261019.json`、`m1-t1-preflight-20261019.json`、`m1-td-runner.ts`、`m1b-cursor-context-local-20261020.md`、`m1b-observation-pagination-20261020.md`、`m1b-t2-acceptance.py`、`m1b-t2-deterministic-20261019.md`、`m1b-t2-runner.ts`、`t0a-model-probes.md`、`t0a-probe-summary.json`、`t0a-probes/`、`t0b-billing-automation.md`、`t0c-arm64-verify.sh`、`t0c-arm64-verify.log`、`t0c-arm64-verify-continue.sh`、`t0c-arm64-verify-continue.log`、`t0c-arm64-verify-final.sh`、`t0c-arm64-verify-final.log`、`m1-opencode-t1-bailian-20261019-b2/`、`m1b-opencode-t2-bailian-20261020-b1/`、`m1b-real-web-scout-20261020/`、`m1b-real-web-pagination-20261020/`。

另刪 `docs/gates/__pycache__/`（已被 `.gitignore` 忽略的生成物，是上面兩個 `.py` 驗收腳本的產物，隨之無用）。

理由：遷移記錄第 1 節要求優先清除無決策價值的重複輸出、中間產物、日誌與失效驗收記錄，只留仍支撐重要結論的最少證據；第 4 節已把可保留的結論與教訓收進表格。

#### E. 歷史配置

刪除 `config/` 下九份批次／provider 專屬歷史配置：`opencode.m1-td-bailian-20261019.json`、`opencode.m1b-t2-bailian-20261020.json`、`release-profile.m1-td-bailian-20261019.json`、`release-profile.m1b-t2-bailian-20261020.json`、`release-profile.m1-t1-formal-20261019.json`、`release-profile.m1.example.json`、`release-profile.volcano.example.json`、`release-profile.volcano-anthropic.json`、`release-profile.volcano-payg.example.json`。

理由：它們只為已刪除的 gate manifest 與凍結批次存在（遷移記錄第 1 節「同步移除無用途依賴與配置」）。`config/README.md` 原本以「被歷史結果／冻结 manifest 引用」為保留理由，該引用方已隨 §0.4 D 刪除。

保留：`config/release-profile.schema.json`、`config/release-profile.example.json`、`config/release-profile.m1-opencode.example.json`、`config/opencode.m1.example.json`、`config/release-profile.m1-bailian-deepseek-v4-flash.example.json`（後三者分別是 CLI 預設 profile、其引用的模型配置，以及 `tests/bootstrap/test-harness.test.ts` 的拒絕用例，刪了會斷）。

### §0.5 保留清單（本輪不動，附理由）

#### 控制層：**暫不刪除，等 design v1 C.1 無模型驗證結果**

C.1 要驗證原生 `task` 子會話能否在首次模型／工具操作前完成綁定；該結果決定控制層是走原生 `task`、有界 SDK 接線還是列為架構阻塞（design v1 C.1 表格）。在結果出來前刪除控制層會同時毀掉做這個驗證的場地。本輪一律保留、不重構、不「順手」清理：

`apps/opencode-plugin/src/index.ts`、`packages/opencode-bridge/`、`apps/cli/src/commands/openCodeTask.ts`、`packages/runtime/`、`packages/policy/`、`packages/contracts/`、`packages/state/`、`packages/artifacts/`、`packages/platform/`、`packages/local-oracle/`、`packages/supervisor/` 的其餘模組（`responsibilities.ts`、`revisions.ts`、`hypotheses.ts`、`candidate-control.ts`、`candidate-verification.ts`、`compaction.ts`、`local-resume.ts`、`long-job-watch.ts`、`multiflag.ts`、`http-progress-adjudicator.ts`、`index.ts`）、`apps/cli/src/commands/{solve,solveM1,resume,localHttpCandidateResolver,localJobCandidateResolver}.ts`、`apps/cli/src/composition/`、`apps/cli/src/main.ts`。

`solveM1.ts` 雖是遷移記錄 3.1／3.2 列出的偏離（單 Solver 入口、硬編碼 prompt、Skill 全文預載），仍保留：它是目前唯一能把 bridge 與 plugin 接起來的啟動路徑，C.1 驗證需要它；其偏離在入口按 design v1 A／C 重建時處理，不在本輪。

#### 其他保留

| 保留 | 理由 |
| --- | --- |
| `fixtures/trajectories/t1`–`t6` | 仍被保留的 `tests/integration/{candidate-verification,verified-multiflag-candidate,multiflag-continuation,compaction-*}.test.ts` 與 `opencode-fixture.ts` 使用，而這些測試覆蓋的是保留中的 `supervisor`／`state` 程式。design v1 1.4／D 的恢復與驗證能力去留一併等控制層定案 |
| `fixtures/local-target/` | `package.json` 的 `target:start` 與保留的 CLI 測試使用的本地 HTTP 靶標 |
| `tests/bootstrap/`、`tests/contract/` 其餘測試、`tests/integration/` 其餘測試 | 覆蓋保留中的程式；本輪不為精簡而刪掉仍有對象的測試 |
| `skills/web-session-diagnosis/` | design v1 B 要求保留已審核 Web 方法並補原生 metadata（補 metadata 不在本輪） |
| `runs/`、`dist/` | `.gitignore` 忽略的本地 run 資料與建置產物，遷移記錄第 1 節不把倉庫外 run-data 自動納入刪除 |

### §0.6 同一變更內的連帶修改

刪除與下列修改必須在同一變更內完成，不允許留下失效鏈接或失效腳本。

**1. `package.json`**

- 刪除 `scripts` 的 `gate:m0`、`gate:m1`（兩個 gate 檔已刪）。
- 其餘腳本（`typecheck`、`test`、`test:deterministic`、`cli`、`build`、`target:start`）保留不變。

**2. `tests/bootstrap/test-harness.test.ts`**

- 第一個用例斷言 `pkg.scripts` 含 `'gate:m0'`，刪腳本後會失敗：從該 `toMatchObject` 移除 `'gate:m0'` 一項，保留其餘斷言。
- 不改這個檔的其他斷言（它引用的三份 `config/` profile 都在保留清單內）。

**3. `tsconfig.json` 與 `vitest.config.ts`**

- 兩處都刪除 `@ctf/reference`、`@ctf/reporting`、`@ctf/browser` 三個別名。
- `tsconfig.json` 的 `include` 仍含 `fixtures/**/*.ts`、`tests/**/*.ts`，不需改動；`archive/` 本來就不在 `include` 內。

**4. `apps/cli/src/main.ts`**

- 刪除 `import { doctor } from './commands/doctor.js';`、`doctor` 指令分支，以及 `--help` 文字中的 `doctor` 一行。
- 預設 profile 路徑 `config/release-profile.m1-opencode.example.json` 不變（該檔保留）。

**5. `config/README.md`**

- 改寫為只描述保留的五份檔案：CLI 預設 `release-profile.m1-opencode.example.json` 與其引用的 `opencode.m1.example.json`；`release-profile.schema.json`；兩份已被 loader 拒絕的歷史格式樣例（`release-profile.example.json`、`release-profile.m1-bailian-deepseek-v4-flash.example.json`，說明它們現為 loader 拒絕用例）。
- 刪除對已刪除配置的整段敘述與「被歷史結果／冻结 manifest 引用，因此原位保留」的保留理由。

**6. `AGENTS.md`（按遷移記錄第 5 節收斂）**

逐節處理，產出後 `AGENTS.md` 只剩倉庫開發規矩，不複述 design v1 正文：

- **設計與當前範圍**：三個入口（舊系統設計、舊路線圖、舊自主解題計劃）改為兩個——架構與產品依據指向 `docs/superpowers/specs/2026-10-22-ctf-agent-design-v1.md`，現狀／教訓／清理方向指向 `docs/superpowers/specs/2026-10-22-ctf-agent-current-state-and-migration.md`。刪除「旧 M1/M1B 轨迹开发与验收冻结，保留代码和证据」整段，改為一句：舊 M0–M6／M1B 軌跡與里程碑順序不繼承，按遷移記錄第 1 節精簡，不恢復凍結的開發工作。TSecBench 不在當前範圍這句保留。
- **架構與職責**：把「只增加必要的产品控制层」改述為 design v1 的分工——OpenCode 原生多 Agent 加薄控制層，控制層的具體去留等 design v1 C.1 的無模型驗證。最後一條「候选验证和权威提交复用现有控制层」改為「保留獨立驗證與可信提交的**能力與邊界**，不以保留現有實作為前提」（design v1 D）。其餘條文（不新增直連 provider 循環、不維護 fork、host 負責身份與預算等）保留。
- **開發方式**：基本保留。在「优先复用现有实现」一條補例外：精簡期可刪除不服務 design v1 的已否定架構，不為保持舊入口可運行加相容層。
- **驗證與結果**：刪除「包括受影响的 `gate:m0`、`gate:m1`」字樣，改為運行適用的既有檢查（`npm run typecheck`、`npm run build`、`npm test`）。刪除「真实运行证据沿用 `docs/gates/` 的既有位置」一句。`solved` 判定與分層驗證陳述改為引用 design v1 的 1.3、1.6，不複述細則。
- **授權與停止**：原樣保留。
- **工作區與運行邊界**：保留倉庫工作區規矩（確認分支、不覆蓋他人工作、未授權不 commit／push）。把產品運行約定（Solver scope、`control_secret`、禁用公共搜尋、運行中不裝依賴）改為一句指向 design v1 1.5，不在開發指令裡複述——產品運行約定將來歸入產品 `AGENTS.md`。
- **常用命令**：刪除 `npm run gate:m0`、`npm run gate:m1`，最終為 `npm ci`、`npm test`、`npm run typecheck`、`npm run build`（可按需保留 `npm run test:deterministic`、`npm run cli`、`npm run target:start`，但不得列出已刪除腳本）。

**7. `CLAUDE.md`**

- 刪除「文檔入口與優先順序」下以 `> ⚠️ `AGENTS.md` 尚未按 design v1 收斂` 開頭的整段臨時說明（該段自述「`AGENTS.md` 收斂後刪除本段」）。
- 其餘內容不動。

**8. `docs/superpowers/README.md`**

- 整檔改寫為指向 design v1 的精簡索引，不保留任何里程碑狀態、run 進度、token 批次敘述或「唯一當前主線」段落（那些指向的 plan 與 gate 記錄都已刪除）。
- 新內容只需包含：
  - 架構與產品依據 → design v1；現狀、教訓與清理方向 → 遷移記錄；倉庫開發規矩 → 根目錄 `AGENTS.md`。
  - 目錄約定：`specs/` 放 design v1 與遷移記錄；`plans/` 放按 `CLAUDE.md` 約定的 §0 交接計劃（如本計劃），不再放里程碑 plan；`gates/` 只留 §0.4 D 保留的最小證據。
  - 一句用途邊界：只用於 CTF 比賽與學習題，操作對象限授權題目、靶場與附件（見 design v1 開頭）。
- 不新建其他索引檔、不建 `archive/` 搬遷舊內容。

**9. 遷移記錄 `docs/superpowers/specs/2026-10-22-ctf-agent-current-state-and-migration.md`**

- 第 5 節「歷史來源」表格中指向已刪除檔案的三個 Markdown 鏈接（舊系統設計、舊路線圖、舊自主首題計劃）改為**純文字檔名**（例如 `2026-10-14-general-ctf-agent-system-design.md`（已刪除）），保留「承接內容／不再繼承」兩欄文字。
- 第 5 節開頭描述 `AGENTS.md` 仍以三份舊文件為依據的段落，改為陳述已按本表收斂完成。
- 第 1 節末段（現有規則與精簡方向的衝突集中在 `AGENTS.md`）改為已處理的陳述。
- 第 4 節：凡其結論的原始證據已被 §0.4 D 刪除者，按遷移記錄第 1 節把該記述標成**歷史摘要**，明說不再可原樣重驗。若 §0.1 選「commit 成快照」而保留了 MFW `result.md`，該行可註明剩餘證據位置。
- 第 2、3 節的程式位置敘述：凡指向已刪除檔案者（`packages/reference/src/index.ts` 等）補註「已於 2026-10-22 精簡中刪除」，不刪除該節判斷。
- 不改 design v1。design v1 第 4 節要求「清理後依真實剩餘能力修訂本文」，那次修訂由設計模型在本步結果之後進行，**不在本步範圍**。

### §0.7 行為判據（這一步算完成的條件）

1. `npm run typecheck` 退出碼 0。
2. `npm run build` 退出碼 0。
3. `npm run test:deterministic` 退出碼 0。
4. `npm test`：**開始刪除前先跑一次並保存輸出作為基線**（允許有本來就失敗／跳過的項，例如需要 OpenCode binary 或網路的整合測試）。清理後再跑一次，逐項對照：不得出現基線中沒有的新失敗。隨實作一起刪掉的測試不算失敗；若清理後某測試新失敗，要麼修到與基線一致，要麼說明它屬於哪個刪除項的連帶影響並一併處理。
5. 沒有斷掉的引用：在倉庫內（排除 `node_modules/`、`runs/`、`dist/`、`.git/`）搜尋每一個已刪除的路徑名與套件別名（`@ctf/reference`、`@ctf/reporting`、`@ctf/browser`、`gate:m0`、`gate:m1`、已刪 plan／spec／gate 檔名），結果只允許出現在遷移記錄按 §0.6 第 9 條改成的純文字或歷史摘要敘述中，不得出現在 `import`、腳本、配置或 Markdown 鏈接裡。
6. 沒有斷掉的 Markdown 鏈接：`AGENTS.md`、`CLAUDE.md`、`docs/superpowers/README.md`、design v1、遷移記錄、本計劃中的每個相對鏈接，目標檔案都存在。
7. `git status` 顯示的改動只包含 §0.4／§0.6 列出的路徑；沒有 commit、沒有 push、沒有分支切換。

### §0.8 禁做清單

- 不新增 fixture、gate、軌跡、里程碑、通用框架或抽象；不新建直連 provider 的求解循環；不維護 OpenCode fork。
- 不恢復舊 M0–M6／M1B 軌跡或其凍結計劃；TSecBench 不是必經平台，未經授權不接入。
- 刪除僅限 §0.4 所列路徑。不刪 §0.5 的控制層與其他保留項，不為保持舊入口（`gate:m0`／`gate:m1`、`doctor`、舊 profile）可運行加相容層，也不為它們寫替代實作。
- 不動其他會話進行中的工作：§0.1 的未提交改動與未追蹤檔案在使用者決定前一律不碰；不 `stash`、不 `reset`、不 `checkout --`、不刪除未追蹤檔案。
- 不碰倉庫外資料、`runs/`、使用者原始題目材料、私有 oracle 與憑據。
- 本步不調用真實模型，不接靶場或平台，不消耗 token；只跑 §0.7 的本地檢查。
- 驗收按 design v1 1.6 分層陳述；確定性測試全綠只代表裝配，不代表解題能力，報告中不得以此暗示產品可用。
- 不新建除本計劃外的 spec、檢查清單或審計報告；不在 `AGENTS.md`、README 中複述 design v1 正文。
- 未經明確授權不 commit／push；做完 §0.7 就停。

### §0.9 收尾報告要求

報告需包含：

1. 實際刪除的路徑清單（與 §0.4 的差異逐項說明原因）。
2. §0.6 各項連帶修改的落地情況。
3. §0.7 五到七項判據的實測結果，含 `npm test` 基線與清理後的對照。
4. **本輪暫時沒有恢復的能力**（至少涵蓋）：里程碑 gate 命令（`gate:m0`／`gate:m1`）不再存在；`ctf-agent doctor` capability 探測入口消失，瀏覽器可用性目前無任何檢查入口；離線 Reference 檢索服務與 run metrics 聚合不再存在；宿主側 Web／Misc／Crypto 領域方法與 Skill 預載移除後，`solveM1` 路徑的領域能力減少；領域 fixture 題目移除後相應確定性測試不再存在。
5. 需要設計模型接手的事項：design v1 第 4 節要求的「依真實剩餘能力修訂 design v1」，以及控制層去留仍待 C.1 驗證。
