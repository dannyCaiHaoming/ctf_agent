#!/bin/sh
set -eu
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
exec python3 -I - "$repo" "$@" <<'PY'
import json
import shutil
import sys
import tempfile
from pathlib import Path


TASK = """請核對 11 月 18 日倉庫日結盤點的期末實際在庫量。操作台快照用於疊加日結後的處理狀態，日結報表只應納入截止時已入帳的異動。請自行選擇記錄和核對方式。

交 report.json（格式為 {"items":[{"sku":"商品代碼","on_hand":整數}]}，每個商品恰好一筆）
以及 judgment.md，簡述依據及剩餘不確定項。"""
RECORDS = """opening.csv
sku,on_hand
BOX-A,28
TAPE-B,20

warehouse-desk.csv
sku,displayed_on_hand
BOX-A,31
TAPE-B,15

ledger.csv
sku,quantity_change,committed,ledger_date
BOX-A,3,true,2026-11-18
TAPE-B,-4,true,2026-11-18
TAPE-B,-1,false,2026-11-18
"""
HINT = """差異集中在操作台快照與異動帳的入帳狀態。請用 ledger.csv 的 committed 欄檢查哪筆異動只出現在操作台，重新核對整份盤點。"""
EXPECTED = {"BOX-A": 31, "TAPE-B": 16}
FILES = ("report.json", "judgment.md")


def unique_keys(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("duplicate JSON key")
    return obj


def report_matches(report_path):
    try:
        report = json.loads(report_path.read_text(), object_pairs_hook=unique_keys)
        items = report["items"]
        if set(report) != {"items"} or type(items) is not list or len(items) != len(EXPECTED):
            return False
        quantities = {}
        for row in items:
            if type(row) is not dict or set(row) != {"sku", "on_hand"} or type(row["on_hand"]) is not int:
                return False
            quantities[row["sku"]] = row["on_hand"]
        return quantities == EXPECTED
    except (KeyError, TypeError, ValueError):
        return False


def seal(case, round_number):
    submission = case / "participant" / f"round{round_number}"
    sealed = case / "operator" / submission.name
    if any(not (submission / name).is_file() for name in FILES):
        raise ValueError("請交齊 report.json 與 judgment.md；收到的檔案已保留。")
    if not (submission / "judgment.md").read_bytes().strip():
        raise ValueError("judgment.md 需要保留當輪判斷。")
    sealed.mkdir()
    for name in FILES:
        shutil.copyfile(submission / name, sealed / name)
    return report_matches(sealed / "report.json")


def save_result(case, outcome, first_matches, second_matches=None):
    with (case / "result.json").open("x") as result:
        json.dump({"outcome": outcome, "first_matches_expected": first_matches,
                   "second_matches_expected": second_matches}, result)
        result.write("\n")
    print(f"{outcome}\n已保存：{case / 'result.json'}")


def main(repo, args):
    if args == ["start"]:
        base = repo.parent / "pentest-agent-run-data" / "inventory-reconciliation-sessions"
        base.mkdir(parents=True, exist_ok=True)
        case = Path(tempfile.mkdtemp(prefix="session.", dir=base)) / "case"
        participant = case / "participant"
        participant.mkdir(parents=True)
        (case / "operator").mkdir()
        (participant / "task.md").write_text(TASK + "\n")
        (participant / "records.txt").write_text(RECORDS)
        print(f"INSTANCE={case}\n\n{TASK}\n\n{RECORDS}")
        print("將兩個檔案寫入 INSTANCE/participant/round1，再執行 first INSTANCE。")
        return

    if len(args) != 2 or args[0] not in ("first", "finish"):
        raise ValueError("usage: session.sh start | first INSTANCE | finish INSTANCE")
    phase, instance = args
    case = Path(instance)
    if not (case / "participant" / "task.md").is_file() or (case / "result.json").exists():
        raise ValueError("請使用啟動時的 INSTANCE；已結束的案例不得重交。")
    if phase == "first":
        if seal(case, 1):
            save_result(case, "unprompted_correct", True)
            return
        with (case / "participant" / "hint.md").open("x") as hint:
            hint.write(HINT + "\n")
        print(f"hint.md\n{HINT}\n將兩個檔案另寫入 INSTANCE/participant/round2，再執行 finish INSTANCE。")
        return
    if not (case / "operator" / "round1" / "report.json").is_file() or not (case / "participant" / "hint.md").is_file():
        raise ValueError("須先封存首輪並發放提示。")
    matches = seal(case, 2)
    save_result(case, "hinted_correct" if matches else "still_incorrect", False, matches)


try:
    main(Path(sys.argv[1]), sys.argv[2:])
except (OSError, ValueError) as error:
    sys.exit(str(error))
PY
