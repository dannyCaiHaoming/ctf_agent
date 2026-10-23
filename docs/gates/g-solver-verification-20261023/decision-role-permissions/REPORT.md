# G 角色權限無模型驗證

日期：2026-10-23（Asia/Tokyo）。工作區：`/Users/caihaoming/.codex/worktrees/b30f/pentest-agent`。

## 決定與限制

**維持 Intake 唯讀及 Verifier 普通 HTTP 拒絕；不增加產品權限。受管接口與工作流可維持，完整角色隔離不通過。**

E 的 `prepareRun` 由宿主固定題面、附件、來源與 hash。Intake 能列題、讀取後經原生 task 返回，沒有一般寫入的具體需求。H 與 C 的廣義表格已在本工作區對齊 E 最小範圍。Verifier 的私有 work 足以承載本地重算；D 未有可信驗證模式發放與完整證據綁定，不能據此開放普通 HTTP。

但角色名稱／受管工具拒絕不足以強制此邊界。現 `job.run` 同 uid 原型讓 Verifier 能讀取 Solver 私有文件及其他題材料，改寫本題材料／published／Solver 文件，並直接 HTTP 到配置外 loopback。獨立邊界探針的退出碼 **1** 與 `securityAcceptance: FAIL` 保留，不以其他測試全綠抵銷。隔離修補依 G §5.4／5.5，由其專屬項處理，本項沒有擴展或實作它。

D 的安全 HTTP 重放仍未定稿。測試側可信按次候選演示：固定候選與依賴 hash／會話／題目，僅執行 fixture 作者認定可重放的操作；新 jar 重建登入狀態，scope 攔住跨 origin 導向；一次性與未知 GET 拒絕；傳輸結果未知亦保留已嘗試、不重送。沒有把此 closure 註冊為產品工具，沒有宣稱 fixture 能分類一般端點、驗證所有狀態依賴或證明真實解題能力。

## 判據與實測

| 範圍 | 證據與結果 |
| --- | --- |
| E Intake 流程 | 真實 `prepareRun` 固定兩題材料；C 列題／讀材料不返回宿主路徑；未建立 Intake work。產品 runtime 通過 task 返回交接 |
| 兩層角色權限 | 真實 `product/opencode/opencode.json` 唯讀 Intake、Verifier 無 HTTP；C 在 before／execute 均拒絕越權（含 args 自稱 Recon）；產品 runtime 原生 OpenCode 將不可見工具轉為 invalid，未呼叫 C |
| Verifier 受管文件 | 可讀 materials／published，可寫本會話 work；材料、published、其他會話、跨題路徑、symlink 拒絕；固定文件原 bytes 不變 |
| 本地重算 | 產品入口建立 Verifier 獨立會話，讀固定 `21\n`、在私有 work 計算 `42\n`；保存精確輸出與 hash，並非 D 的 verified／solved 判定 |
| HTTP 候選 | fixture 新 jar 登入→proof 精確 body sha256 符合候選；拒絕版本／會話／題目變更、重複、限次／未知 GET；out-of-scope 零請求；未知結果一請求後拒絕重試 |
| 真實 job 邊界 | **FAIL**：managed HTTP 被拒，但 script exit 0；讀 sibling／其他題哨兵，materialsIntact／publishedIntact／siblingIntact／noDirectHttp 皆 false；配置無 HTTP target，配置外 loopback 收到一次 `/outside` |

以上是不同運行，不拼為同一次全鏈路通過。產品 runtime/first 是同一次 `launch()`→OpenCode→產品插件→C/RPC→工具流程：14 次替身請求／14 次模型准入（Coordinator 4、Intake 4、Verifier 6），配置靶場 HTTP 請求 0，所有登記資源結算；Verifier 材料寫入由 C 拒絕。工具可見性拒絕的原始錯誤保存在 messages 文件。

## 命令與退出碼

在本工作區執行；完整命令表為 [commands.json](commands.json)。

```sh
G_ROLE_EVIDENCE=docs/gates/g-solver-verification-20261023/decision-role-permissions/replay-fixture npx vitest run tests/contract/g-role-permissions.test.ts --reporter=verbose
npx tsx tests/manual/g-role-permissions-runtime.ts review
npx tsx tests/manual/g-role-permissions-boundary-probe.ts
npm run typecheck
npm run build
npm test
```

- 定向：8/8，退出 0，`contract-final.log`。
- 真實產品入口（loopback 確定性替身）：退出 0，`runtime-first.log`、`runtime/first/`。重跑 label 用不同名字避免覆蓋原始證據。
- 實際 job 隔離驗收：退出 **1**（實際邊界失敗），`boundary-probe.log`、`boundary-probe/`；退出 2 表示探針本身錯誤，不可視為同一結論。
- typecheck／build：退出 0；全套 40 files、299/299，退出 0。
- 初次定向 6/7、退出 1：測試未開 `follow_redirects`，而產品默認不跟隨，導致未走到原判據。核對 adapter 後明確開啟導向，保留 `contract-first.log`，未改產品或降低 scope 判據。

## 來源、版本與改動歸屬

源工作區 `/Users/caihaoming/.codex/worktrees/g-c-rpc-slow-tools/pentest-agent` 的 git diff/untracked 清單先保存，再複製必要 apps／packages／product／tests／config／fixtures 及編譯配置。20 個相關產品／測試文件與原 `final-hashes.json` 全一致（`prototype-hash-check.json`）；沒有以主區舊接線替代原型。

AGENTS／CLAUDE 及 docs/superpowers 取自主工作區 `/Users/caihaoming/Documents/pentest-agent`。148 個導入文件有完整來源與 sha256（`sources.json`），結束時來源 148/148 未變（`source-integrity-after.json`）。沒有編輯來源工作區。源 HEAD 均為 `d83a0c3024271dbf212db319e900fcf527e68b0f` 加已保存的未提交改動。

關鍵來源 hash：
- `apps/launcher/src/control-service.ts`：`952b67eb38c2b09e90cf81f933fc166da5c6ea1549912248c730eee46e8b3af3`。
- `apps/launcher/src/job-tools.ts`：`095b5cb41c1db5b0ff81f1d5d64377edabae47c59d9ecea085a6630b98e99ff0`。
- `apps/launcher/src/http-tools.ts`：`2e7de4d8e36c6c9191971147f68cc6065dbb0c3085206448835007fdd7934b72`。
- `product/opencode/opencode.json`：`2abc1b7c9d5009bf4c014c5fa3707614a401db83d74a029a2b9816d52b5913ad`。
- `docs/superpowers/specs/2026-10-23-design-v1-g-solver-minimal.md`：`91a71b2a4b03e305588f4a33cd9537602e134e4b93a81436b4e44ba496ed0417`。

版本實測：Node 26.3.0、npm 11.16.0、OpenCode 1.19.3、SDK/plugin 1.19.0、TypeScript 5.6.3、Vitest 2.1.8，見 `versions.txt`。開發宿主 macOS；本項未用 Docker，未以此推定 ARM64 發布隔離成立。

本項相對導入基線**沒有產品代碼／權限配置改動**。實際新增：`tests/contract/g-role-permissions.test.ts`、兩個 `tests/manual/g-role-permissions-*.ts` 探針。實際回寫：G 詳細 design §4.3、§5.2/5.4、§6、§9、§10；總 design H 的 Intake 行；C §5 工作區行。`changes.patch` 只含本項差異，避免把導入原型的 HEAD diff 當作本項新修改。`final-hashes.json` 固定最終測試來源與證據。

## 主會話核對事項

1. 核對後可選擇性同步上述三份 design 的本項差異及本證據目錄；其他專屬 session 的 design 不能整檔互相覆蓋。
2. Intake 唯讀最小版可定；Verifier 普通 HTTP 保持拒絕。D 可信模式發放、候選／依賴與請求序列狀態綁定仍未定稿，不能把 fixture 候選當成已批准的外部契約。
3. job 隔離失敗是已知前提未滿足的實測，會阻止完整角色權限／發布隔離的完成陳述；本項沒有自行取消 job 能力或改產品目標，需與隔離專屬結果合併判斷。
4. 沒有真實模型/provider/外部靶場調用；替身 usage 為 0 只是替身回報，真實模型 usage 不適用，不能外推模型工具使用效果。沒有候選登記、獨立 D 判定、oracle 或 solved。
5. 按 brief 保留 plan 和 worktree，無 commit/push/merge/歸檔；待主會話核對處理。
