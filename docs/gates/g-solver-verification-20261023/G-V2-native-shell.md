# G-V2 原生 bash 能否受限（只讀檢查）

記錄日期：2026-10-23（Asia/Tokyo）。執行模型：Haiku 5.5（主 session 直接執行，未照 plan 交給 Sonnet 5.5；判斷依據已逐項列出，可由 Sonnet 5.5 或 Opus 5.5 覆核）。token 預算：0；無代碼改動，無運行時探針。

## 1. 環境

| 項 | 值 |
| --- | --- |
| 檢查的類型定義 | `node_modules/@opencode-ai/plugin/dist/index.d.ts`，包版本 1.19.0 |
| 目標運行時 | OpenCode 1.19.3（見 C 探針報告 `docs/gates/c-binding-probe-20261023/REPORT.md` 第 1 節） |
| 差異 | 類型包版本與運行時版本不同；結論只依據類型定義，未經運行時驗證 |

## 2. 查看的接口

| 問題 | 公開接口 | 類型定義位置 | 結論 |
| --- | --- | --- | --- |
| 1a. 能否改寫環境變數 | hook `shell.env`，input `{cwd, sessionID?, callID?}`，output `{env: Record<string,string>}` | `index.d.ts` 第 242–247 行 | 存在，可寫入 `output.env`。類型未說明它是合併到繼承的環境上，還是替換整個環境，也未說明能否刪除繼承的變數 |
| 1b. 能否改寫 `cwd` | 同上 | `index.d.ts` 第 243 行 | **不能**。`cwd` 只在 input 中，output 沒有對應欄位 |
| 2. 權限層能否限定程序與路徑 | hook `permission.ask` 只有 `status: ask｜deny｜allow` | `index.d.ts` 第 225–227 行 | 插件層只能對整個權限請求放行或拒絕，類型中沒有按命令內容或路徑篩選的欄位。設定層的模式匹配未在本次檢查範圍內 |
| 3. uid／用戶切換 | 類型定義中無對應欄位或 hook | 全文搜尋 `uid`、`user`、`gid` 未見對應接口 | **不能** 由插件控制 |

`shell.env` 的 hook 只在 `shell.d.ts` 之外的 `index.d.ts` 出現一次；`shell.d.ts` 只提供 brace 展開等工具函數，與環境控制無關。

## 3. 判據結論

判據（plan G-V2）：三項皆能由公開接口達成，寫為「可替換，但須另行驗證」；任一項不能達成，維持 `job.run`。

- 1b（cwd）不能達成；
- 3（uid）不能達成；
- 2 未能達成（插件層只有整體允許或拒絕）。

**結論：維持受管 `job.run` 入口，原生 `bash` 保持拒絕。** 與 G design 第 5.1 節的現行判斷一致，該節無需修改方向，只需補上本檢查的依據。

## 4. 限制與未驗證部分

- 本結論只依據 1.19.0 類型定義。實際運行時的 `shell.env` 行為（是否合併、能否刪除繼承變數）未驗證；但因 cwd 與 uid 已不能達成，這不影響結論。
- 權限設定層（`opencode.json` 的 permission 模式）是否能按命令模式限制 `bash`，未在本次檢查範圍內；若日後要重新評估原生 shell，需先補查該項。
- 未運行任何命令，未調用模型。
