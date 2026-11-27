"""Small deterministic checks for Q2 generation and Q1-schema ingestion."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate_synthetic
import train


class Q2Tests(unittest.TestCase):
    def test_deterministic_balanced_q1_records(self):
        first = generate_synthetic.generate(20261127, 42)
        self.assertEqual(first, generate_synthetic.generate(20261127, 42))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in first))
            stats = generate_synthetic.verify(path)
        self.assertEqual(stats["total"], 2520)
        self.assertEqual(stats["labels"], {"true": 1008, "false": 756, "misleading": 504, "unverifiable": 252})
        self.assertEqual(set(first[0]), {"instruction", "context", "output"})

    def test_train_accepts_q1_and_legacy_normalized_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            q1 = root / "q1.jsonl"
            q1.write_text("\n".join([
                json.dumps({"instruction": "Verify this claim: a true claim", "context": "evidence", "output": json.dumps({"verdict": "supported"})}),
                json.dumps({"instruction": "Verify this claim: unknown claim", "context": "", "output": json.dumps({"verdict": "unverifiable"})}),
                json.dumps({"claim": "legacy claim", "evidence": "legacy evidence", "label": "refuted", "split": "train"}),
            ]) + "\n")
            args = SimpleNamespace(fever_dir=root / "none1", liar_dir=root / "none2",
                                   synthetic_dir=root, extra_data_dir=[], include_eval=False, max_records=0)
            records = list(train.collect_records(args))
        self.assertEqual([(r["claim"], r["label"]) for r in records], [
            ("a true claim", "supported"), ("unknown claim", "not_enough_info"), ("legacy claim", "refuted")])


if __name__ == "__main__":
    unittest.main()
