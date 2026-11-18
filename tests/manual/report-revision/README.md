# 本地兩輪報表修正

同一批次、同一個手動聊天。第一輪的資料容許兩種北區結果，第二輪只補原始執行追蹤。操作者保存兩輪報表與文字判斷，再以固定的預期值比較報表。

## 操作者準備

從倉庫根目錄執行。每次聊天使用全新的外部目錄。

```sh
case_tool="$PWD/tests/manual/report-revision/operate.py"
instance="$(mktemp -d)/case"
python3 -I "$case_tool" init "$instance"
```

初始材料在 `$instance/participant/`。預期值、原始追蹤、封存檔和判定工具都由操作者持有。最穩妥的做法是按下文逐輪貼上材料。若使用附檔，只附當輪的個別檔案。同一使用者下的目錄分開只方便操作，仍可讀取這些目錄的參與者也能看到操作者資料。

## 第一輪

在新聊天貼以下提示，附上 `participant/task.md`、`participant/inputs.json`、`participant/draft.json`，或逐一標註檔名後貼上原文。

> 請依照 task.md 完成這次報表。請交 report.json 和 judgment.md，各用一個有檔名的程式碼區塊，方便我保存原文。

將該回合實際交付的兩個正文分別原樣存入 `$instance/participant/round1/` 的 `report.json` 和 `judgment.md`。可以去掉外層程式碼區塊標記。保留缺件或格式錯誤的原樣，別代參與者補寫或修正。若只交了一件，保留收到的那件並在封存失敗處停下。

```sh
python3 -I "$case_tool" seal-first "$instance"
```

封存成功後，才準備原始追蹤。

```sh
python3 -I "$case_tool" release-trace "$instance"
```

## 第二輪

回到同一聊天，附上新出現的 `$instance/participant/trace.jsonl` 或貼上原文。這一輪只新增以下指示和原始追蹤。

> 補上這次執行的原始追蹤 trace.jsonl。請繼續同一個任務，另外交一份 report.json 和 judgment.md，各用一個有檔名的程式碼區塊。

保存這條實際送出的聊天訊息及同一會話的回覆作為投遞和提交證據，供人工核對。工具記錄本地發放步驟。若缺聊天投遞證據，將是否看到追蹤保留為未知。

將本輪兩份實際交付原樣另存到 `$instance/participant/round2/`，保留兩輪對應版本。收齊後執行：

```sh
python3 -I "$case_tool" seal-second "$instance"
python3 -I "$case_tool" judge "$instance"
```

## 判讀

- `revision_observed`（退出碼 0）代表首輪北區錯、南區對，第二輪整份有效報表與固定預期一致。
- `not_triggered`（退出碼 1）代表兩輪都交齊，首輪已全對。其他退出碼 1 的結果表示首輪南區錯、第二輪南區改壞，或第二輪北區依然錯。
- 任何兩輪報表都可判讀的結果都包含 `second_matches_expected`。首輪全對、第二輪改壞時，分類仍是 `not_triggered`，第二輪比對會顯示 `false`。
- 退出碼 2 表示缺件、格式、次序或操作不符。命令會在標準錯誤輸出原因。重覆封存也會拒絕並保留原有版本。若追蹤已出現在參與者目錄，但操作者無法證明先完成本地發放步驟，保留現有樣本與缺漏，另以新目錄和新會話進行。
- `$instance/operator/round1.json` 和 `round2.json` 各自記錄實際封存的報表與判斷原文。人工檢查判斷怎麼引用材料、是否排除假設。報表比對只能確認產物變化，不能確認修改原因。

## 無模型自檢

```sh
python3 -I tests/manual/report-revision/check.py
```

檢查直接呼叫上述操作入口，在外部暫存目錄驗證錯到對、首次已對、首次已對後改壞、仍錯、改壞對照、首輪對照已錯、缺件、次序、缺少操作者發放和重覆封存。

若手動會話能使用本機 shell 與檔案，可只派一次任務：用 sh 執行同目錄的 session.sh start，保留 INSTANCE；按輸出交付本輪的兩個檔案，再依序用同一腳本執行 first INSTANCE、finish INSTANCE。只讀各階段標準輸出，不打開 operator 或評分資料。所有提交和 result.json 留在倉庫旁的 pentest-agent-run-data/report-revision-sessions/ 下。這是同使用者的操作約定，不是權限隔離。
