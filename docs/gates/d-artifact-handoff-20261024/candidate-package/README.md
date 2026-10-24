# D 接口二隔離區無模型驗證

本 worktree 原型，主區未接入。未 commit/push/合併，未新增 Codex session。D 後三接口未修改。主 session 必須獨立核對再選擇性同步 design；本區 plan/worktree 保留。

起點 HEAD `c652e95fc050e1c795dd55c80e6b7d95b3c6dd5b`。`source-baseline.json` 保存 19 個明確依賴與主區 baseline 的 SHA-256 比對、起點 dirty 狀態；完全一致且沒有額外複製。`final-source-hashes.json` 保存最終 source hashes/主區仍等於基線的檢查及本次增量清單。最終 runtime 的 `source/` 還保存該次執行的精確來源 bytes，與 `source-hashes.json` 互相核對。

最終結果：P1–P4 在本次原型邊界內成立。定向 35/35、全套 358/358（45 files）、typecheck/build 均退出 0。四個 runtime-final 場景同一次命令全部通過，不拼接其他 run 的結果。OpenCode 1.19.3、SDK/plugin 1.19.0、Node v26.3.0。真實模型調用 0；真實 usage=unavailable，替身回報 zero 只表示預定替身。沒有 verified/solved 判定。

## 原始執行與退出碼

本次工作目錄：`/Users/caihaoming/.codex/worktrees/ae52/pentest-agent`。

| 原始命令 | 退出碼文件 | 輸出 |
| --- | --- | --- |
| `npm ci`（run 外） | npm-ci.exit | npm-ci.log |
| `npx vitest run tests/contract/d-candidate-package.test.ts`（缺口 RED） | red-contract.exit = 1 | red-contract.log |
| 同上，第一版原型 | green-contract-1.exit = 1 | green-contract-1.log，P3 目錄 sibling 誤拒 |
| `npx tsx tests/manual/d-candidate-package.ts runtime-1 control` | runtime-1.exit = 1 | runtime-1.log，探針誤計 publication；完整失敗保留 |
| `npx tsx tests/manual/d-candidate-package.ts runtime-2` | runtime-2.exit = 0 | runtime-2.log，四情形整批通過，非最終來源聲明 |
| `npx tsx tests/manual/d-candidate-package.ts runtime-final` | runtime-final.exit = 0 | runtime-final.log，最終四情形整批通過 |
| `npx vitest run tests/contract/d-candidate-package.test.ts tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts` | targeted-final.exit = 0 | targeted-final.log，35 tests |
| `npm run typecheck` | typecheck-final.exit = 0 | typecheck-final.log |
| `npm run build` | build-final.exit = 0 | build-final.log |
| `npm test` | full-final.exit = 0 | full-final.log，358 tests |

`targeted-1/2`、`typecheck-early/2`、`build-1`、`full-1` 是保留的中間檢查；最終結論只使用 final 記錄。Node 的 module.register deprecation warning 不影響退出碼。npm ci 的依賴警告原樣保留，未擴展修復或升級依賴。

## 復跑

已有 node_modules 時不需重新安裝。下列第一條是完整四情形命令；label 必須全新，已存在目錄會拒絕覆蓋。探針自行建立僅允許 stub 的 loopback provider 配置並將 HTTP(S)/ALL_PROXY 指向不可用 loopback，NO_PROXY 只含 localhost。沒有真 provider 接線。每個情形啟動新原生 runtime，正常情形在同一 runtime 串完整 E/Solver/Coordinator/Engineer 鏈路。

```bash
npx tsx tests/manual/d-candidate-package.ts runtime-recheck-20261024-01
npx vitest run tests/contract/d-candidate-package.test.ts tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts
npm run typecheck
npm run build
npm test
```

局部復跑只加第三參數 `control`、`R1`、`R2` 或 `R3`，仍用新 label。局部結果不可拼接成同一次整批通過。所有命令從上述 worktree 根目錄執行。

## 證據閱讀

- `runtime-final/{control,R1,R2,R3}/summary.json` 是該場景的斷言結果；`result.json` 保留 runtime path、狀態、失敗與真模型調用數。
- `provider.json` 保存實際原生 provider requests、預定工具請求、讀取結果及原生完成消息。`failedRequests.json` 保留失敗 provider request（最終各場景皆空）。沒有用 SDK 注入 Engineer 成果；SDK 只沿既有 launcher 接口啟動 root 與訂閱 events。
- `wire.json` 是真實 plugin→C 的 package.publish request 與 C 已準備的 reply；`observations.json` 保存 awaited barrier、提交、停止及 RPC close 順序。R2/R3 的 stop handle 取自 Coordinator 實際收到的第二個 background task 回覆，再與宿主 Engineer execution.childID 核對。
- `evidence/{control-audit,tool-resources,publications,task-executions,bindings}.json` 與 `messages-*.json` 是宿主及原生 runtime 記錄；`workspace/`、`state/jobs/` 保存原始材料、source work、job stdout/stderr 和固定 published bytes。
- `fixed-manifest.json`、`candidate.bin` 是已提交整包的原始 manifest/candidate bytes（R2 無提交，所以不應存在）；`expected-raw.bin`、`expected-candidate.bin` 是獨立 fixture bytes。`offline-audit.json` 核對最終 source hashes、整包/候選 bytes、每項依賴及時序。
- P1 原始 20 bytes 的 `[5,14)` 由 Engineer 真實本地 job 提取為 9 bytes `e697977bc3a97d00ff`，整包再選候選發布 ref `[0,9)`；候選 hash 為 `4527432703d179e8d8f48f8ec1b39f5688c37d5e374dc13f6e72aba2224f59b0`。契約覆蓋 CRLF 原樣、UTF-8 中間 byte、空/逆序/非整數/越界；沒有 trim 或 UTF-8 值副本權威。

| 場景 | package commits | package client state | C resource | 後續行為 |
| --- | ---: | --- | --- | --- |
| control | 1 | completed | completed/settled | Engineer 三次明確版本讀回後原生完成交回 Coordinator |
| R1 | 1 | error: control unavailable | completed/settled | UNKNOWN，0 次 version 讀取，0 重發/重跑 |
| R2 | 0 | error/aborted | cancelled/settled | revoke 在 rename 提交前，無包 ref/半包文件；execution stop_reply |
| R3 | 1 | error: Tool execution aborted | completed/settled | 提交後暫扣回复，stop/revoke/close 後晚回复嘗試；execution stop_reply，無晚交付 |

每一場景都是 2 個實際 job、5 次產物發布、1 次整包請求。R2 沒有包不代表來源 job 未執行；R1/R3 客戶端失敗不抹除宿主提交。

## 失敗與限定

`runtime-1` 第一個錯誤為探針將 artifact.read 回复也算作 publication（5 != 3）；後續模型替身 provider 請求的斷言錯誤及 deadline 保留。當時沒有發出 package.publish。該版 `manual-source.ts.txt` 原文 SHA-256 與其 source-hashes.json 一致。`runtime-2` 修正只統計無 data 的發布回覆後完整通過；最終 batch 再完整跑一遍。

P3 的第一次失敗是現有 snapshotFile 將目錄新增 sibling 的 metadata 改變當作快照變更；改成只比目錄 dev/ino/type，仍核對 leaf 完整身份，原有 H5 父目錄替換/symlink/混合讀取拒絕回歸通過。

原型採現有 ArtifactPublisher 的單次提交存一份 manifest envelope，候選與 E bytes 內嵌、其餘必要產物使用已核對引用。1 MiB envelope/最多 32 files；沒有全目錄版本、依賴推斷、環境封裝或恢復。包內建議 argv 是 proposed；候選/來源完整性與 source execution 的未知保持未知。未驗實際包重放、模型選材/解題、Verifier/提交/oracle、強制 unknown 鎖或同 uid 強隔離。

本 session 最終評審為作者自審；按使用者禁止新 session 的要求，獨立核對留給主 session。Plan 不刪除，worktree 不清理/歸檔。
