"""Exercise the manual operator CLI with synthetic submissions in a temp directory."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CASE = Path(__file__).resolve().with_name("operate.py")


class ReportRevision(unittest.TestCase):
    def command(self, action, result=0):
        process = subprocess.run(
            [sys.executable, "-I", str(CASE), action, str(self.run_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(process.returncode, result, process.stdout + process.stderr)
        return process.stdout

    def submit(self, round_number, north, south):
        target = self.run_dir / "participant" / f"round{round_number}"
        (target / "report.json").write_text(json.dumps({"north": north, "south": south}))
        (target / "judgment.md").write_text(f"Distinct judgment from round {round_number}.\n")

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="report-revision-")
        self.addCleanup(temp.cleanup)
        self.run_dir = Path(temp.name) / "case"

    def test_artifact_outcomes(self):
        cases = [
            ((18, 7), (24, 7), "revision_observed", 0),
            ((24, 7), (24, 7), "not_triggered", 1),
            ((24, 7), (24, 8), "not_triggered", 1),
            ((18, 7), (18, 7), "target_still_wrong", 1),
            ((18, 7), (24, 8), "control_regressed", 1),
            ((18, 8), (24, 7), "first_control_wrong", 1),
        ]
        parent = self.run_dir.parent
        for index, (first, second, expected, exit_code) in enumerate(cases):
            with self.subTest(expected=expected):
                self.run_dir = parent / f"case-{index}"
                self.command("init")
                self.submit(1, *first)
                self.command("seal-first")
                self.command("release-trace")
                self.submit(2, *second)
                self.command("seal-second")
                result = json.loads(self.command("judge", exit_code))
                self.assertEqual(result["outcome"], expected)
                self.assertEqual(result["second_matches_expected"], second == (24, 7))

    def test_missing_and_out_of_order_submissions(self):
        self.command("init")
        participant = self.run_dir / "participant"
        self.assertFalse((participant / "trace.jsonl").exists())
        self.assertFalse((participant / "operator").exists())
        self.command("seal-first", 2)
        self.command("release-trace", 2)
        self.command("seal-second", 2)
        self.command("judge", 2)
        self.submit(1, 18, 7)
        self.command("seal-first")
        self.submit(2, 24, 7)
        self.command("seal-second", 2)
        self.command("release-trace", 2)
        (participant / "round2" / "report.json").unlink()
        (participant / "round2" / "judgment.md").unlink()
        self.command("release-trace")
        self.submit(2, 24, 7)
        (participant / "round2" / "judgment.md").unlink()
        self.command("seal-second", 2)
        self.command("judge", 2)

    def test_trace_file_alone_cannot_substitute_for_operator_release(self):
        self.command("init")
        self.submit(1, 18, 7)
        self.command("seal-first")
        trace = (self.run_dir / "operator" / "trace.jsonl").read_bytes()
        (self.run_dir / "participant" / "trace.jsonl").write_bytes(trace)
        self.submit(2, 24, 7)
        self.command("seal-second", 2)
        self.command("judge", 2)

    def test_duplicate_seals_cannot_change_either_submission(self):
        self.command("init")
        self.submit(1, 18, 7)
        self.command("seal-first")
        self.submit(1, 24, 7)
        self.command("seal-first", 2)
        self.command("release-trace")
        self.submit(2, 24, 7)
        self.command("seal-second")
        self.submit(2, 18, 8)
        self.command("seal-second", 2)
        self.assertEqual(json.loads(self.command("judge"))["outcome"], "revision_observed")
        for round_number in (1, 2):
            archive = self.run_dir / "operator" / f"round{round_number}.json"
            snapshot = json.loads(archive.read_text())
            self.assertEqual(snapshot["judgment.md"], f"Distinct judgment from round {round_number}.\n")


if __name__ == "__main__":
    unittest.main()
