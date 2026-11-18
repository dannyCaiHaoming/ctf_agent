# 本地 CSV 解析產物與判定

這個目錄把 `tests/manual/fixed-point-cases/csv-quoted-newline.json` 的資料解析部分抽成本地、離線、可重複的操作。不連題目服務、不執行題目腳本、不啟動產品 Agent、不呼叫模型。

## 邊界

| 角色 | 路徑 | 說明 |
| --- | --- | --- |
| 做題輸入 | `input/orders.csv` | 與案例的 `materials.orders.csv` 逐位元組相同，保留引號內換行 |
| 題目說明 | `input/task.md` | 只說輸出格式，不含筆數、欄位值或答案 |
| 評分預期 | `expected/records.json` | 固定保存，不在 `input/` 下 |
| 判定器 | `judge.py` | 只讀 expected 與 artifact 兩份 JSON；不讀 CSV，不 import `parse_records.py` |
| 參考產出 | `parse_records.py` | 一條可照做的路徑；不是判定的一部分 |

`input/orders.csv` 的 sha256 是 `4f86c5234e006e4cf9da29dd2d984e064f18e4eb301324d613cc9bac2a170c6a`。預期值由人工核對 CSV 後固定寫入，判定時不重算。

## 直接操作

```bash
cd tests/manual/csv-parsed-artifact
./run-local.sh /tmp/csv-parsed-artifact/records.json
```

`run-local.sh` 依序做兩件事：

1. `parse_records.py` 讀 `input/orders.csv`，把資料列寫成 JSON。
2. `judge.py` 拿 `expected/records.json` 比對該 JSON。

也可以換成任何工具產生同一個 JSON，再單獨判定：

```bash
python3 -I judge.py expected/records.json /tmp/csv-parsed-artifact/records.json
```

## 產物格式

裸陣列或 `{"records": [...]}` 都接受；每筆只比較 `id`、`item`、`note`，值必須是字串，紀錄順序要與 CSV 相同。

```json
[
  {"id": "<string>", "item": "<string>", "note": "<string>"}
]
```

## 判定語意

- 通過：紀錄數相同，且每筆的三個欄位逐字相同，包含欄位內的換行。
- 失敗：紀錄數不同、欄位值不同、缺少欄位、型別不是字串，或原本在欄位內的換行不見了。
- 判定器不解析 CSV，也不從 artifact 反推預期值；它只做 expected 與 artifact 的資料比較。
- 若 expected 完全沒有欄位內換行，判定器以 exit `2` 拒絕，避免把原始條件弄丟。
- 退出碼：`0` 通過、`1` 失敗、`2` 用法或預期檔錯誤。

## 三份固定 fixture

| 產物 | 來源 | 判定 | 差異 |
| --- | --- | --- | --- |
| `artifacts/correct.json` | `parse_records.py`（`csv` 模組） | PASS | 3 筆；`record[1].note` 保留 `\n` |
| `artifacts/split-newline.json` | 按換行切分，把欄位內換行當成新紀錄 | FAIL | 4 筆；`record[1].note` 少了 `\n`，多出一筆續行紀錄 |
| `artifacts/lost-newline.json` | 紀錄數正確，但把欄位內換行換成空格 | FAIL | 3 筆；`record[1].note` 的 `\n` 不見了 |

重跑三份 fixture：

```bash
for f in correct split-newline lost-newline; do
  python3 -I judge.py expected/records.json "artifacts/$f.json"
  echo "exit=$?"
done
```

`split-newline.json` 與 `lost-newline.json` 是固定的錯誤產物，不是由 `parse_records.py` 產生，也不隨預期值變動。
