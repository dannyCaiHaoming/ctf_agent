# 運行時歸因範例草稿

**狀態（2026-11-20）：已併入。** 用戶審閱後，範例以繁體中文譯文寫入 `product/skills/python-runtime-diagnosis/references/runtime-boundaries.md` §6（放在來源之前）；下方英文原稿與審閱要點保留作審閱紀錄，產品以 Reference 為準。

## 與現有內容的核對

- Reference §1–3 已區分宿主授權、Python 審計、作業系統與程式本身，並交代各層判斷的成立條件及作用範圍。§4 的「不能外推」表已說明何時應保留未知。 [Runtime boundaries](../../../product/skills/python-runtime-diagnosis/references/runtime-boundaries.md)
- Reference §5 與 Skill 的「交回」已涵蓋事實、替代假設、未決問題，以及授權內的下一步。草稿只補交接中的轉折：新證據縮小原判斷的適用範圍，同一角色以新條目取代舊假設，下一輪據此選擇下一步。 [Runtime boundaries §5](../../../product/skills/python-runtime-diagnosis/references/runtime-boundaries.md#5-寫入工作簿) · [Python runtime diagnosis](../../../product/skills/python-runtime-diagnosis/SKILL.md) · [B §7 第 5 項](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)

## Demonstration

The reporting account tried to read a synthetic weekly inventory report, and the importer initially showed only a generic read failure. The workbook carried an open hypothesis: “The source file may be corrupt, which could explain this failure.” At that point, the team had no result from a check of the file contents.

Before handing off, the same role reviewed the existing records for that attempt and found that the importer had stopped while opening the file, before the parser received any data. The operating system record for that same file-open attempt confirmed that the reporting account had been denied access. The role superseded the open hypothesis with a narrower explanation in the same workbook section: “The read was blocked at file open under the reporting account’s current permissions. The report contents and file integrity remain unknown.”

The next round used the replacement entry to choose a narrower question: was there already a validation record for this exact export among the metadata the team was authorized to review?

## 審閱要點

以下三則均為合成紀錄，只供逐句核對。

| 紀錄 | 可供核對的觀察 |
| --- | --- |
| A · 未執行 | 初始紀錄顯示報表帳號嘗試讀取週報，匯入介面只顯示讀取失敗。工作簿暫記來源檔可能損壞，內容檢查標為未執行。 |
| B · 已有反證 | 同一次匯入的執行紀錄顯示，流程在開啟檔案時停止，剖析器未收到資料。這排除了「這次失敗發生在解析報表內容時」。 |
| C · 權限拒絕 | 作業系統紀錄確認，同一次、同一份報表、同一報表帳號的開檔操作被拒絕。紀錄的來源及關聯已確認。 |

| 英文句子 | 成立條件與判讀 |
| --- | --- |
| “The reporting account tried to read…” | A 支持曾嘗試讀取及初始畫面所見。通用失敗訊息只交代當時的觀察。 |
| “The workbook carried an open hypothesis…” | A 記載當時的工作簿內容。來源檔損壞仍是有待確認的解釋。 |
| “At that point…” | A 將內容檢查標為未執行，內容與完整性均待確認。 |
| “Before handing off…” | B 須對應同一次讀取。它把失敗定位在剖析之前，檔案本身的狀況仍未知。 |
| “The operating system record…” | C 須確認紀錄來自作業系統，並對應同一次開檔、同一帳號與同一份報表。結論限本次操作。 |
| “The role superseded the open hypothesis…” | B 與 C 支持把本次失敗縮小為開檔遭拒。原假設仍是同一角色名下的有效條目，才可由同欄新條目明確取代。 |
| “The read was blocked…” | C 支持開檔階段的拒絕及當前帳號的權限範圍。 |
| “The report contents…” | A、B、C 都沒有檢查內容的結果，因而保留兩項未知。 |
| “The next round used…” | 下一輪須能看到取代後的有效條目，且只在現有授權內查閱既有中繼資料。要採信驗證結果，還須能對應同一次匯出。 |

**內容核對。** 英文正文只描述已發生的合成讀取、既有紀錄、工作簿取代，以及授權內的中繼資料查閱。三則紀錄沒有命令、操作載荷、權限變更、繞過或提權步驟。

**建議插入位置。** 經審閱同意後，在 Reference 末尾、現有「來源」節之後新增獨立的 `## Demonstration` 節。 [Runtime boundaries](../../../product/skills/python-runtime-diagnosis/references/runtime-boundaries.md)
