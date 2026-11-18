# 本地 CSV 解析

讀 `input/orders.csv`，把資料列（不含表頭）解析成 JSON，寫到 `out/records.json`。

- 每筆紀錄保留 `id`、`item`、`note` 三個欄位，值一律用字串。
- 不要修改 `input/orders.csv`；評分只看 `out/records.json`。
- 工具與步驟不限；只要輸出的欄位內容與 CSV 一致即可。

輸出格式（兩種都接受）：

```json
[
  {"id": "<string>", "item": "<string>", "note": "<string>"}
]
```

```json
{"records": [{"id": "<string>", "item": "<string>", "note": "<string>"}]}
```
