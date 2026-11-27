import json
import tempfile
import unittest
from pathlib import Path

from fetch_data import main, task_record


class TaskRecordTests(unittest.TestCase):
    def test_maps_canonical_not_enough_info_without_inventing_reasoning(self):
        row = {"claim": "A claim", "label": "not_enough_info", "evidence": ""}
        converted = task_record(row)
        self.assertEqual(converted["instruction"], "Verify this claim: A claim")
        self.assertEqual(converted["context"], "")
        self.assertEqual(
            json.loads(converted["output"]),
            {
                "verdict": "unverifiable",
                "confidence": 1.0,
                "reasoning": "Gold dataset label: not_enough_info.",
            },
        )

    def test_maps_supported_and_refuted(self):
        for label in ("supported", "refuted"):
            with self.subTest(label=label):
                row = {"claim": "A claim", "label": label, "evidence": "Source text"}
                self.assertEqual(json.loads(task_record(row)["output"])["verdict"], label)

    def test_sample_cache_is_not_reused_for_full_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "fever.jsonl"
            source.write_text(
                json.dumps({"claim": "A", "label": "SUPPORTS", "evidence": []})
                + "\n"
                + json.dumps({"claim": "B" * 80, "label": "REFUTES", "evidence": []})
                + "\n",
                encoding="utf-8",
            )
            common = [
                "--data-dir", str(root / "data"), "--only", "fever",
                "--fever-train-url", source.as_uri(), "--fever-dev-url", source.as_uri(),
            ]
            self.assertEqual(main([*common, "--limit", "1", "--max-bytes", "65"]), 0)
            sample = root / "data/fever/fever_train.jsonl"
            self.assertEqual(len(sample.read_text(encoding="utf-8").splitlines()), 1)

            self.assertEqual(main([*common, "--limit", "0"]), 0)
            full = list(map(json.loads, sample.read_text(encoding="utf-8").splitlines()))
            task = list(map(json.loads, (root / "data/fever/fever_train.task.jsonl").read_text(encoding="utf-8").splitlines()))
            self.assertEqual(len(full), 2)
            self.assertEqual(len(task), 2)
            self.assertEqual(json.loads(task[1]["output"])["verdict"], "refuted")


if __name__ == "__main__":
    unittest.main()
