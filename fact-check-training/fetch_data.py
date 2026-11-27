#!/usr/bin/env python3
"""Download and normalize FEVER + LIAR to one JSONL schema (stdlib only).

Output records are always:
    {"claim": str, "label": str, "evidence": str, "source": str, "split": str}

Canonical labels: supported | refuted | not_enough_info.

By default this script fetches small, HTTP-range-limited samples (safe for CI).
Use --limit 0 to fetch the full datasets. See README.md for URLs and licensing.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable, Iterator

FEVER_TRAIN_URL = "https://fever.ai/download/fever/train.jsonl"
FEVER_DEV_URL = "https://fever.ai/download/fever/shared_task_dev.jsonl"
LIAR_ZIP_URL = "https://www.cs.ucsb.edu/~william/data/liar_dataset.zip"

LABELS = ("supported", "refuted", "not_enough_info")

LABEL_ALIASES = {
    # FEVER
    "supports": "supported",
    "supported": "supported",
    "refutes": "refuted",
    "refuted": "refuted",
    "not enough info": "not_enough_info",
    "not enough information": "not_enough_info",
    "notenoughinfo": "not_enough_info",
    "not_enough_info": "not_enough_info",
    "nei": "not_enough_info",
    # LIAR (fine-grained -> 3-way, documented in README)
    "true": "supported",
    "mostly-true": "supported",
    "mostly true": "supported",
    "pants-fire": "refuted",
    "pants fire": "refuted",
    "false": "refuted",
    "barely-true": "refuted",
    "barely true": "refuted",
    "half-true": "not_enough_info",
    "half true": "not_enough_info",
}

# Shared verbatim by train.py and evaluate.py so train/eval prompts cannot drift.
PROMPT_SYSTEM = (
    "You are a careful fact-checker. Classify the claim using ONLY the supplied evidence. "
    "Reply with exactly one label and nothing else: supported, refuted, or not_enough_info."
)


def canonical_label(raw: object) -> str:
    """Map FEVER/LIAR labels to the canonical 3-way label ('' if unknown)."""
    text = " ".join(str(raw or "").strip().lower().split())
    if not text:
        return ""
    if text in LABEL_ALIASES:
        return LABEL_ALIASES[text]
    underscored = text.replace(" ", "_")
    return LABEL_ALIASES.get(underscored, "")


def user_prompt(record: dict) -> str:
    """Build the user half of the shared train/eval prompt."""
    claim = str(record.get("claim", "")).strip()
    evidence = str(record.get("evidence", "")).strip() or "(no evidence supplied)"
    return (
        f"Claim: {claim}\n"
        f"Evidence: {evidence}\n"
        "Label (supported / refuted / not_enough_info):"
    )


def iter_jsonl(path: Path) -> Iterator[dict]:
    """Yield JSON objects from a JSONL file, tolerating a truncated last line."""
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue  # HTTP range samples can end mid-line
            if isinstance(value, dict):
                yield value


def write_jsonl(path: Path, records: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            count += 1
    return count


def task_record(record: dict) -> dict:
    """Convert a normalized row to the instruction/context/output Q1 format."""
    verdict = "unverifiable" if record["label"] == "not_enough_info" else record["label"]
    output = {
        "verdict": verdict,
        "confidence": 1.0,
        "reasoning": f"Gold dataset label: {record['label']}.",
    }
    return {
        "instruction": f"Verify this claim: {record['claim']}",
        "context": record["evidence"],
        "output": json.dumps(output, ensure_ascii=False, separators=(",", ":")),
    }


def make_record(claim: object, label: str, evidence: object, source: str, split: str) -> dict | None:
    clean_claim = " ".join(str(claim or "").split())
    if not clean_claim or not label:
        return None
    return {
        "claim": clean_claim,
        "label": label,
        "evidence": " ".join(str(evidence or "").split()),
        "source": source,
        "split": split,
    }


def fever_evidence(raw_evidence: object) -> str:
    """Flatten FEVER's nested [annotation][wiki_page, sentence_id] ids."""
    if not isinstance(raw_evidence, list):
        return ""
    parts: list[str] = []
    for group in raw_evidence:
        if not isinstance(group, list):
            continue
        for item in group:
            if not isinstance(item, (list, tuple)):
                continue
            wiki = item[2] if len(item) > 2 else None
            sentence = item[3] if len(item) > 3 else None
            if isinstance(wiki, str) and wiki.strip():
                suffix = f":{sentence}" if sentence not in (None, "") else ""
                part = f"wikipedia:{wiki.strip()}{suffix}"
            elif sentence not in (None, ""):
                part = f"sentence:{sentence}"
            else:
                continue
            if part not in parts:
                parts.append(part)
    return "; ".join(parts[:5])


def normalize_fever(path: Path, split: str, limit: int) -> Iterator[dict]:
    kept = 0
    for row in iter_jsonl(path):
        label = canonical_label(row.get("label"))
        if not label:
            continue
        record = make_record(
            row.get("claim"),
            label,
            fever_evidence(row.get("evidence")),
            "fever",
            split,
        )
        if record is None:
            continue
        yield record
        kept += 1
        if limit and kept >= limit:
            return


def normalize_liar(path: Path, split: str, limit: int) -> Iterator[dict]:
    kept = 0
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        reader = csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            if len(row) < 14:
                continue
            statement_id, raw_label, statement = row[0], row[1], row[2]
            speaker, context = row[4], row[13]
            label = canonical_label(raw_label)
            if not label:
                continue
            evidence = (
                f"PolitiFact:{statement_id} | speaker: {speaker} | "
                f"original label: {raw_label} | context: {context}"
            )
            record = make_record(statement, label, evidence, "liar", split)
            if record is None:
                continue
            yield record
            kept += 1
            if limit and kept >= limit:
                return


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path, max_bytes: int, force: bool, timeout: float) -> Path:
    """Download url to dest; reuse a non-empty cache unless --force is given."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"[cache]   {dest.name} ({dest.stat().st_size} bytes)")
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "neon-fact-check/1.0 (research dataset fetch)"}
    if max_bytes > 0:
        headers["Range"] = f"bytes=0-{max_bytes - 1}"
    request = urllib.request.Request(url, headers=headers)
    part = dest.with_name(dest.name + ".part")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            remaining = max_bytes
            with part.open("wb") as output:
                while True:
                    size = min(65536, remaining) if remaining > 0 else 65536
                    chunk = response.read(size)
                    if not chunk:
                        break
                    output.write(chunk)
                    if remaining > 0:
                        remaining -= len(chunk)
                        if remaining <= 0:
                            break
        part.replace(dest)
    except Exception:
        part.unlink(missing_ok=True)
        raise
    print(f"[download] {url} -> {dest.name} ({dest.stat().st_size} bytes, sha256={sha256(dest)[:16]})")
    return dest


def extract_liar_tsvs(zip_path: Path, raw_dir: Path, force: bool) -> dict[str, Path]:
    names = ("train.tsv", "valid.tsv", "test.tsv")
    paths = {name: raw_dir / name for name in names}
    if not force and all(path.exists() and path.stat().st_size > 0 for path in paths.values()):
        print(f"[cache]   extracted LIAR TSVs in {raw_dir}")
        return paths

    raw_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for name in names:
            with archive.open(name) as source, paths[name].open("wb") as target:
                shutil.copyfileobj(source, target)
    print(f"[extract] {zip_path.name} -> {', '.join(names)}")
    return paths


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "data",
        help="Root containing fever/ and liar/ subdirectories (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Records per split; 0 means the full split (default: %(default)s)",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=2_000_000,
        help="HTTP Range cap per FEVER file in sample mode; ignored with --limit 0",
    )
    parser.add_argument(
        "--suffix",
        default="",
        help="Output filename suffix, e.g. '.sample' -> fever_dev.sample.jsonl",
    )
    parser.add_argument("--only", choices=("fever", "liar"), help="Fetch only one dataset")
    parser.add_argument("--force", action="store_true", help="Re-download even if cached")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    parser.add_argument("--fever-train-url", default=FEVER_TRAIN_URL)
    parser.add_argument("--fever-dev-url", default=FEVER_DEV_URL)
    parser.add_argument("--liar-zip-url", default=LIAR_ZIP_URL)
    args = parser.parse_args(argv)
    if args.limit < 0:
        parser.error("--limit must be >= 0")
    if args.max_bytes < 0:
        parser.error("--max-bytes must be >= 0")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    data_dir = args.data_dir.expanduser().resolve()
    limit = args.limit
    max_bytes = args.max_bytes if limit > 0 else 0
    failures = 0

    if args.only in (None, "fever"):
        fever_dir = data_dir / "fever"
        raw_dir = fever_dir / ".raw" / ("full" if limit == 0 else "sample")
        try:
            specs = [
                (args.fever_train_url, "train.jsonl", "train", "fever_train.jsonl"),
                (args.fever_dev_url, "shared_task_dev.jsonl", "dev", "fever_dev.jsonl"),
            ]
            for url, raw_name, split, out_name in specs:
                raw_path = download(url, raw_dir / raw_name, max_bytes, args.force, args.timeout)
                out_path = fever_dir / out_name.replace(".jsonl", f"{args.suffix}.jsonl")
                rows = list(normalize_fever(raw_path, split, limit))
                count = write_jsonl(out_path, rows)
                task_path = fever_dir / out_name.replace(".jsonl", f".task{args.suffix}.jsonl")
                write_jsonl(task_path, (task_record(row) for row in rows))
                print(f"[normalize] {out_path} ({count} records, split={split})")
        except Exception as exc:
            failures += 1
            print(f"ERROR: FEVER fetch failed: {exc}", file=sys.stderr)
            print(
                "  Offline tests can use data/fever/*sample.jsonl instead; "
                "re-run with --force when the network is available.",
                file=sys.stderr,
            )

    if args.only in (None, "liar"):
        liar_dir = data_dir / "liar"
        raw_dir = liar_dir / ".raw" / ("full" if limit == 0 else "sample")
        try:
            zip_path = download(args.liar_zip_url, raw_dir / "liar_dataset.zip", 0, args.force, args.timeout)
            tsvs = extract_liar_tsvs(zip_path, raw_dir, args.force)
            for tsv_name, split in (("train.tsv", "train"), ("valid.tsv", "dev"), ("test.tsv", "test")):
                out_path = liar_dir / f"liar_{split}{args.suffix}.jsonl"
                rows = list(normalize_liar(tsvs[tsv_name], split, limit))
                count = write_jsonl(out_path, rows)
                task_path = liar_dir / f"liar_{split}.task{args.suffix}.jsonl"
                write_jsonl(task_path, (task_record(row) for row in rows))
                print(f"[normalize] {out_path} ({count} records, split={split})")
        except Exception as exc:
            failures += 1
            print(f"ERROR: LIAR fetch failed: {exc}", file=sys.stderr)
            print(
                "  Offline tests can use data/liar/*sample.jsonl instead; "
                "re-run with --force when the network is available.",
                file=sys.stderr,
            )

    print("Done." if failures == 0 else f"Done with {failures} dataset failure(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
