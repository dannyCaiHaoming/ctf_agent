# design v1 A／B 詳細 design：產品角色與 Web Skill 契約對齊

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：已實作、獨立復核並完成主區無模型驗證。** 本文是 [核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 A／B 的詳細子文件，只處理模型可見產品指令與當前已接入接口的一致性。初次實作僅授權文檔清理及無模型驗證；後續使用者授權按原流程完成剩餘提交收口，見 §6。真實模型 run 與 push 仍未授權。

## 1. 問題與範圍

當前工作區基於 `c8b13bf566297812aa5113ce0ec5feaf159acab0`，包含尚未提交的 D 完成接口、progress 帳本及產品指令變更；本切片以這份工作區實作為核對對象，不能只取 HEAD 舊版。

已確認的矛盾：Recon／Domain Solver／Engineer 仍稱 Verifier、結果或 oracle 接線未接入；Coordinator／Verifier 混有歷史原型階段敘述；Web Skill 仍要求 `candidate.register`、專用 archive 工具、獨立 HTTP session、`set_cookie_names`／`cookie_names_sent`／`redirect_location` 舊字段，並把已不存在的 `no_route` 稱為宿主 run 分類。這些說明不能由當前公開工具契約支持。

只修改相關角色 Markdown、現有 `web-session-diagnosis/SKILL.md` 與本設計的核心引用。共同產品指令只在發現同類矛盾時局部修正。保留 Skill 名稱、觸發範圍、既有 Reference 與通用解題方法。不改 runtime、工具 schema、權限、角色數量、配置、隔離或驗收要求；不拆新 Skill、不新增工具、fixture、gate 或知識材料。

## 2. 核對依據與已定契約

以 `apps/opencode-plugin/src/index.ts` 的模型可見 schema／說明、`apps/launcher/src/control-service.ts` 的角色准入、`candidate-package-tools.ts` 及 `http-tools.ts` 的實際行為、`product/opencode/opencode.json` 的權限為準，並與 D／G 子設計核對。設計目標不冒充已實作能力。

| 主題 | 本次產品說明必須對齊的現況 |
| --- | --- |
| 候選交接 | Recon／Solver 以 `ctf_artifact_publish` 固定自身來源並交回 ref；Engineer 以 `ctf_package_publish` 固定候選 byte 區間、依賴與提取說明，交回 version；不指示任何角色呼叫 `candidate.register`。 |
| 驗證與完成 | Coordinator 以 `ctf_challenge_assign` 綁定 Verifier 的 challenge／version，再分派原生背景 task。Verifier 用 `ctf_package_prepare`、綁定 preparation 的 job 及 `ctf_verification_report`；Coordinator 完整讀取指定 `ctf_verification_read` 報告，核對有效性後呼叫 `ctf_completion_request`。無 oracle 是 candidate_only，未知提交不重送。接口已接入不等於生產秘密隔離或普遍解題能力已驗證。 |
| 狀態與完整性 | 保留獨立上下文、固定版本、必要證據、來源及完整性、unknown／inconclusive、半開 byte 區間、分頁與實際讀回、角色權限、傳輸未知和停止規則。刪掉的是過時階段敘述，不能刪掉現存限制。 |
| workspace／解包 | 使用 `materials/`、`work/`、`published/`；歸檔由已授權角色透過 `ctf_job_run` 在自身 work 中用可用 Python／tar 列舉或解包，不假設專用 archive 工具。不執行附件程式；不在 run 中安裝依賴。 |
| HTTP／會話 | `ctf_http_request` 返回 `status`、`headers`、`headersTruncated`、`redirectChain`、`bodyPath`、`bodyBytes`、`bodyTruncated`、`preview`，控制服務另綁定 resource。`follow_redirects` 默認 false，可顯式在 scope 內跟隨；不虛構舊字段。Recon／Solver 共用同題宿主 jar，沒有獨立 session 選擇或重置接口；不能把另一個 Agent／session 當成匿名對照。 |
| 觀察限制 | 同題 jar 的自動保存／攜帶不等於登入成功；用受保護內容及可觀察狀態判斷。已有登入前證據可作對照，沒有可靠匿名基線則記缺口，不為完成方法清單而假裝具有該能力。回傳 headers 可能含 Set-Cookie，不宣稱工具只回 cookie 名稱；摘要不複製值。 |
| 輸出續讀 | `preview` 只是預覽；需要時以 workspace 工具讀 bodyPath 的已保存 bytes。`bodyTruncated` 表示原響應保存不全，讀完 bodyPath 不會恢復未保存尾部。不以續讀或重新發送請求冒充原觀察完整。 |

## 3. 文檔責任與實作選擇

採用局部契約修正及必要的角色段落合併。角色說明保留其任務、可用操作、交付、判斷和邊界；把「第 N 接口原型」「主核對修正」等歷史章名改為當前操作語義，重複且矛盾的階段句刪除。為避免清理變成架構改寫，本次不強制搬移全部參數說明，也不調整角色協作策略。

Web Skill 保留觀察—假設—最小實驗—負向反饋的原方法，只替換依賴舊實作的部分。精確候選可來自受管 HTTP、job 或附件的可信提取證據，不再限於 HTTP response，也不能靠外觀或模型自述生成。方法說明不得授予使用者未授予的目標、網路、工具或預算權限。

未採用「為舊 Skill 補相容工具／額外 session 能力」：使用者只授權對齊當前實作；也不因為單題成功就刪除生產隔離、機械核對與語義判斷的區別。

## 4. 工作流與驗證

先保存本設計，再更新核心 A／B 引用，再從本文生成單一切片 plan。實作由乾淨的 Codex 子會話在獨立 worktree 執行：複製當前必要未提交基線，記錄來源，不把 HEAD 舊版當成現況；只回傳本次允許檔案的增量。主會話核對及整合時檢查原檔未被並行改寫。Claude Code 專屬模型名稱不在此環境冒用；使用可用 Codex 執行／復核會話，不啟動產品模型。

驗證：逐項核對上述契約與角色權限；執行現有產品資產載入、plugin／config、HTTP、候選／Verifier／completion 相關確定性測試，檢查 Skill metadata 及本地鏈接。不為文案增加逐字匹配測試，不削弱既有斷言；若既有斷言確實固定已廢棄契約，先報告具體矛盾。文檔修改不要求反覆全套；可在同一最終快照執行一次既有全套、typecheck、build 作整合核對。

獨立復核須確認：沒有遺漏舊接口、沒有暗增能力、沒有弱化驗證與隔離邊界。結果及版本條件回寫本文；全部結論轉入後刪除一次性 plan，不另建 gate。沒有真實模型 run，usage 記 unavailable；只能聲稱契約一致與無模型檢查結果，不能聲稱模型遵循、效率或成功率提升。

## 5. 初次實作結果與核對紀錄（歷史 v3 快照）

2026-10-24 依序完成設計子文件、核心 A／B 引用、單切片實作 plan、獨立 worktree 實作、獨立只讀復核與主區整合；結論已轉入本文，一次性 plan 已刪除。實作工作區為 `/Users/caihaoming/.codex/worktrees/product-instruction-contract/pentest-agent`，使用第 1 節所列 commit 加主區必要未提交基線，未把舊 HEAD 當成當前能力。沒有 commit／push。

實際改動只有五份角色文檔（Recon、Domain Solver、Engineer、Coordinator、Verifier）及既有 Web Skill，另新增本文並更新核心引用：

- 去除「Verifier／oracle 尚未接入」矛盾，將歷史原型章名改成目前操作名稱，保留版本、分頁、完整性、unknown、停止與結果分層要求。
- Web Skill 升為文檔版本 3，對齊現有解包、HTTP 字段、共享 jar、響應續讀及 artifact → package → verification → completion 交接；不再引用 `candidate.register` 或 `no_route`。
- 主核對發現首輪清理仍殘留 `no_route`。核對 launcher 現有終態及 apps／packages 無該枚舉後移除，保留「單次無候選不代表所有路線已耗盡」的方法含義；最後獨立復核確認修正。
- 共同產品指令、其他四角色、Reference、runtime、工具 schema、權限配置與 tests 未產生本次增量。整合前逐 byte 核對主區產品基線，整合後核對其他 tracked 檔案仍與任務開始時相同，保留既有未提交工作。

六份產品文檔的最終快照 SHA-256：`d3aae4bbd37dd0b2db6d2f6af664d52968f0bcc0f5a2ecbcae6a5fde4fdb5ab8`。計算方式：按倉庫相對路徑排序，依次拼接 UTF-8 路徑、NUL、原檔 bytes、NUL；不包含設計文件自身。

驗證結果（本機已安裝 Vitest 2.1.9）：

| 核對 | 結果與界限 |
| --- | --- |
| worktree 改前／首輪改後定向測試 | `vitest run tests/contract/{opencode,opencode-config,http-tools,d-candidate-package,d-verifier-handoff,d-verification-result,d-trusted-completion,launch-evidence}.test.ts`，兩次均 exit 0，8 檔／89 項。後續 no_route 文字修正由主區最終全套覆蓋。 |
| 主區最終整合 | `npm test` exit 0，49 檔／409 項全通過；`npm run typecheck`、`npm run build` 均 exit 0。SDK stand-in 及本地測試不構成真實模型行為證據。 |
| Skill metadata | 官方 `quick_validate.py` exit 1，原因為本機缺少 PyYAML；未安裝依賴。以既有 Ruby `YAML.safe_load` 解析 YAML，再核對允許鍵、名稱、描述類型／長度／命名及 TODO 通過。官方 validator 本身未成功執行，不將替代核對冒稱其成功。 |
| 主區產品文檔 | 六份 frontmatter 解析、角色 mode／Skill 名稱、相對 Reference 鏈接、舊契約掃描與 `git diff --check` 均通過。 |
| 獨立復核 | 對照保存基線與當前實作，未發現需修正的接口、權限、狀態或邊界問題；design、核心引用與切片範圍一致。 |

本次沒有新增功能、測試或 gate，沒有啟動 Docker／題目 run 或調用產品真實模型，usage 為 `unavailable`。尚未驗證模型是否採用修正後指令，亦不宣稱效率、成功率或生產秘密隔離改善。

## 6. 2026-10-24 剩餘提交收口

本 design 並非尚未實作：§5 的六份產品文檔早已完成主區整合。`31b10b58` 已提交 Coordinator／Verifier／Web Skill 的必要接口清理；`77e40a5d` 已提交後續交接優化、Skill v4 及各自 design。因此本輪只核對並收口尚未入庫的 Recon、Domain Solver、Engineer、本文及核心 A／B 兩處引用，不回退 v4，不重做已完成切片，也不帶入進度帳本、其他角色、runtime、tests 或 G／D 的未提交工作。

以 `77e40a5dc066b1e7574fde6e22508f7262f79105` 加當時主區 dirty 工作檔為基線，GPT 6.1 Sol 獨立子會話在專用工作樹逐項核對實際 schema、角色准入、artifact／package／verification／completion／HTTP。三角色與原實作工作樹逐 byte 相同；本輪無新增產品修正。剩餘差量僅為 Recon／Domain Solver 各 1 行替換及 Engineer 4 行替換，移除過時「尚未接入」說明並保留交接邊界。

當前六份產品文檔快照 SHA-256：`a33cf357367bff4573ce2879ce654b697536bde5719808d946a9ba799a0f4252`，沿用 §5 的路徑排序及 NUL 分隔算法。此快照含 Skill v4／交接優化及工作區原有 Coordinator 進度說明；它是本輪核對對象，不是這次提交的完整內容。§5 的 v3 hash 與 409 項全套結果保留作歷史，不冒充本輪重跑或混為同一版本。

本輪先核實測試只使用本地 HTTP/HTTPS、受管 files/jobs、SDK stub、stub judge 或 mocked OpenCode，不連產品 provider；清除所有測試 `*EVIDENCE_DIR`，以既有依賴執行 `npx --no-install vitest run tests/contract/{opencode,opencode-config,http-tools,d-candidate-package,d-verifier-handoff,d-verification-result,d-trusted-completion,launch-evidence}.test.ts --cache=false`。Vitest 2.1.9，8 檔／89 項通過、exit 0。六份 frontmatter 以 Ruby YAML 解析、Reference 鏈接、舊契約上下文掃描及 `git diff --check` 通過；未重跑全套、typecheck 或 build。

獨立只讀復核確認六份指令與當前實作契約一致，無遺漏、擴權或弱化 unknown／獨立驗證邊界。主會話核對測試日誌、剩餘三角色 bytes 及精確提交範圍。執行中初次讀 Skill 使用了錯誤的 `product/opencode/skills/` 路徑，按檔案清單更正為 `product/skills/` 後完成核對；未造成產品修改或測試失敗。未新增 fixture／gate／功能，未安裝依賴；未跑真實產品模型、Docker 或題目，usage 為 unavailable。結果不證明模型遵循、效率、成功率或生產秘密隔離。

收口子會話 `01a16dcc-844a-7a12-ab34-0a39bb2a2f5a` 已歸檔，專用 `6ff2` 工作樹在結果核對及差異副本保存後移除；原有其他工作樹不動。一次性 plan 結論已轉入本文並刪除，不使用會額外生成快照 commit 的工作樹歸檔操作。
