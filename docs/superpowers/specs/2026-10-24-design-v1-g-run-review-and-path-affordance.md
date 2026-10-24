# design v1 G 詳細 design：完整 run 日誌復盤與 workspace 路徑可發現性

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：** [CTF Agent 核心設計 v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 G 的詳細 design 子文件。本切片已就單題本地 Docker run 的工具使用證據完成決策與實作：保留既有嚴格虛擬路徑及授權邊界，只改善模型可見的 workspace 路徑說明與示例；定向及全套無模型回歸通過。此結果不代表 G 整體定稿，也不證明模型在後續 run 必然遵循。

本文只定義設計，不構成真實模型調用、commit 或 push 授權。原始 run 日誌含推理、候選與預期答案，只留在 run 資料目錄；可長期引用的是去敏統計、錯誤類別及既有 gate。

## 1. 目的與範圍

回答一個直接依賴：同一產品入口已完成一次真實單題流程後，run 中反覆出現的 workspace 工具錯誤，是否表示路徑能力或權限設計需要改變，或只是模型可見的用法說明不足。

本切片只處理已觀察到的可發現性缺口。不重做題目接入、不改 D 的候選／驗證／完成接口、不增加工具、不改 workspace 授權、不以提示詞代替宿主核實，也不啟動下一次真實模型 run。

## 2. 已完成 run 與日誌證據

`d-e2e-mfw-20261024-b2-1` 在本地 Docker `mfw` 上完成單題流程：`completed`、獨立 Verifier `verified`、本地精確判官 `accepted`、宿主 `solved: true`。297 次模型准入、1,065,186 observable tokens、12 個會話、401 個 settled tool resources；無 provider／adapter、job 卡死或工具生命週期錯誤。最小去敏證據見 [`d-e2e-mfw-20261024-b2`](../../gates/d-e2e-mfw-20261024-b2/REPORT.md)。

逐會話訊息共記錄 442 次工具呼叫：423 次完成、19 次錯誤，成功率約 95.7%。19 次錯誤分類如下：

| 類別 | 次數 | 判斷 |
| --- | ---: | --- |
| workspace 虛擬路徑用法錯誤 | 11 | 可修的可發現性缺口；包含 6 次 `workspace.list({path:"."})`、2 次 `materials/mfw`、1 次 `work/src-mfw`、1 次 `materials/mfw/statement.md` 及 1 次缺少 `work/` 前綴的 Verifier 寫入 |
| 呼叫不存在的 `invalid` 工具 | 3 | 模型工具選擇錯誤；現有可用工具清單已明確回報，不因此新增相容工具 |
| 原生 `read` 嘗試控制／配置目錄 | 3 | 宿主正確拒絕；屬隔離邊界生效，不是產品缺陷 |
| 錯誤 artifact source 引用 | 1 | 宿主正確拒絕；沒有可信引用不應放行 |
| conflicting verification report | 1 | 宿主正確拒絕同一 execution 的衝突報告；驗證修正需另立結果，不能覆寫 |

兩次候選 bytes mismatch 是正常驗證修正，不計入工程錯誤。日誌沒有顯示 provider、adapter、job 收束或 RPC 生命週期故障。

## 3. 問題與候選做法

**問題：** 現行 G §3.2 的虛擬根和寫入限制正確，但四個 workspace 工具沒有各自完整、模型可見的首次使用說明。模型需要先犯一次拒絕錯誤，才從結果推得正確語義。

候選做法：

| 方案 | 內容 | 判斷 |
| --- | --- | --- |
| A. 補模型可見說明與示例 | 在工具描述及共同產品指令中明確區分「省略 path 才列出三個根」、`read`／`write` 必須以虛擬根開頭，以及 `materials/` 已按題目隔離 | **採用。** 不改變既有權限與 guard，直接回應 11 次實際誤用；可保留安全語義並以現有 guard 回歸 |
| B. 把 `.`、`materials/<challenge>` 正規化為有效路徑 | 放寬工具輸入，自動映射多種寫法 | **不採用。** 會引入歧義並削弱「虛擬根唯一且無宿主路徑」的既有契約；沒有證據顯示需要接受多套路徑語法 |
| C. 拒絕時返回動態根摘要 | 在錯誤結果動態解釋可用根與示例 | **延後。** 可作未來人因改善，但目前錯誤固定、安全且已有共同指令位置；先做 A 可避免擴大錯誤接口與暴露面 |

## 4. 已定決策

採用方案 A，並維持下列契約不變：

- `workspace.list`／`workspace.search`：只有省略 `path` 才表示三個虛擬根；指定子目錄時使用 `materials`、`work`、`published` 或其根內相對路徑。
- `workspace.read`：必填 `path` 必須以 `materials/`、`work/` 或 `published/` 開頭，例如 `materials/statement.md`。
- `workspace.write`：只能寫 `work/...`，例如 `work/out.txt`；不得寫 `materials/` 或 `published/`。
- `materials/` 已在題目綁定時隔離，因此使用 `materials/statement.md`，不是 `materials/<challenge-id>/statement.md`。
- `.`、裸檔名、`..`、絕對路徑、反斜線與其他根名繼續拒絕；不新增自動正規化或別名。
- `package.prepare` 的 `workspaceDirectory`／`workspaceManifestPath`／`workspaceCandidatePath` 已是 workspace 根相對值，可直接交給 workspace 工具；`directory` 只作 preparation 綁定 job 的 cwd。

模型可見說明要同時覆蓋工具清單與共同產品指令。只改其中一處，仍可能在角色未載入該提示或只看工具 metadata 時失去用法。

## 5. 結果去向與驗收

2026-10-24 已按本 design 實作：workspace 工具清單帶有精確用法與正確／錯誤路徑示例；共同產品指令同步列出三根規則、寫入限制及 `materials/` 題目隔離。新增的模型可見說明回歸先以 RED 確認舊版落入泛用 fallback，修正後定向 2 檔／17 項、全套 48 檔／404 項測試通過；既有 path guard 測試證明拒絕行為未放寬；typecheck 與 build 均 exit 0。

驗收只支持「模型可見說明已修正且確定性邊界未變」，不支持「模型下一次必然遵循」。若後續有新的真實 run 仍重複同類錯誤，才依新證據重新評估方案 C；不得直接把 `workspace path` 錯誤當成要放寬授權的理由。若出現成功讀寫之外的越界、路徑穿越或控制目錄訪問，屬安全失敗，停止並重新檢查 guard，不以提示詞修正冒充通過。

本次沒有新的真實模型調用，usage 記為 `unavailable`；不因此宣稱多題成功率、OS／網路隔離或生產祕密隔離已驗證。
