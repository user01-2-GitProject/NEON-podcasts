#!/usr/bin/env python3
"""Evaluate FEVER dev accuracy for the QLoRA adapter (Q3 entrypoint).

Prints the requested target (>85% FEVER dev accuracy). Q4 = actually running
training/evaluation on a GPU, which is a separate task. Third-party imports are
lazy so --help and py_compile work on a CPU box without ML packages.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterator

from fetch_data import LABELS, PROMPT_SYSTEM, canonical_label, iter_jsonl, user_prompt

DATA_ROOT = Path(__file__).resolve().parent / "data"
DEFAULT_MODEL_ID = "Qwen/Qwen3.5-9B"

PREDICTION_PATTERNS = (
    ("not_enough_info", re.compile(r"not[\s_-]*enough[\s_-]*info|\bnei\b|insufficient", re.I)),
    ("supported", re.compile(r"\bsupported\b|\bsupports\b|\btrue\b|mostly[\s-]true", re.I)),
    ("refuted", re.compile(r"\brefuted\b|\brefutes\b|\bfalse\b|pants[\s-]fire|barely[\s-]true", re.I)),
)


def apply_chat_template(tokenizer, record: dict) -> str:
    """Same prompt as train.py, including Qwen3.5 non-thinking mode."""
    messages = [
        {"role": "system", "content": PROMPT_SYSTEM},
        {"role": "user", "content": user_prompt(record)},
    ]
    try:
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def parse_prediction(text: str) -> str:
    """Extract one canonical label from a greedy generation ('' if unparseable)."""
    for label, pattern in PREDICTION_PATTERNS:
        if pattern.search(text or ""):
            return label
    return ""


def resolve_dev_path(explicit: Path | None, data_dir: Path) -> Path:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"--dev-file does not exist: {path}")
        return path
    for name in ("fever_dev.jsonl", "fever_dev.sample.jsonl"):
        path = Path(data_dir).expanduser() / name
        if path.is_file():
            return path.resolve()
    raise FileNotFoundError(
        f"No FEVER dev file in {data_dir}. Run fetch_data.py or point --dev-file "
        "at data/fever/fever_dev.sample.jsonl."
    )


def iter_dev_records(path: Path, limit: int) -> Iterator[dict]:
    kept = 0
    for row in iter_jsonl(path):
        label = canonical_label(row.get("label"))
        claim = str(row.get("claim", "")).strip()
        if not claim or label not in LABELS:
            continue
        yield {"claim": claim, "label": label, "evidence": str(row.get("evidence", "")).strip()}
        kept += 1
        if limit and kept >= limit:
            return


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help="HF base model id (default: %(default)s)")
    parser.add_argument(
        "--adapter-dir",
        type=Path,
        help="QLoRA adapter dir from train.py; omit to evaluate the base model",
    )
    parser.add_argument("--data-dir", type=Path, default=DATA_ROOT / "fever")
    parser.add_argument("--dev-file", type=Path, help="Explicit normalized FEVER dev JSONL")
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--max-new-tokens", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="Evaluate only N rows; 0 means all")
    parser.add_argument("--target", type=float, default=85.0, help="Target accuracy in percent")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--precision", choices=("bf16", "fp16", "fp32"), default="bf16")
    parser.add_argument(
        "--full-precision",
        action="store_true",
        help="Load the 9B base in bf16/fp16 instead of 4-bit (needs ~18 GB VRAM)",
    )
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Only for custom override models that require it",
    )
    parser.add_argument(
        "--enforce-target",
        action="store_true",
        help="Exit 1 if accuracy is not above --target (off by default for smoke tests)",
    )
    args = parser.parse_args(argv)
    if args.max_length < 32 or args.batch_size < 1 or args.max_new_tokens < 1:
        parser.error("--max-length >= 32, --batch-size >= 1, --max-new-tokens >= 1 are required")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    dev_path = resolve_dev_path(args.dev_file, args.data_dir)
    records = list(iter_dev_records(dev_path, args.limit))
    if not records:
        raise SystemExit(f"No usable FEVER dev records in {dev_path}")

    print(f"[data] FEVER dev: {dev_path} ({len(records)} rows)")
    if ".sample." in dev_path.name:
        print("[note] Using the committed sample fixture: accuracy is a smoke test, not the target metric.")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, set_seed
    except ImportError as exc:
        raise SystemExit(f"Missing ML dependency: {exc}. Install requirements.txt on a GPU box.") from exc

    if not torch.cuda.is_available():
        raise SystemExit("Evaluation of a 9B model needs a CUDA GPU; Q4 is a separate GPU task.")

    set_seed(args.seed)
    dtype = {
        "bf16": torch.bfloat16,
        "fp16": torch.float16,
        "fp32": torch.float32,
    }[args.precision]

    tokenizer = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    model_kwargs = {
        "torch_dtype": dtype,
        "trust_remote_code": args.trust_remote_code,
    }
    if not args.full_precision:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=dtype,
        )
        model_kwargs["device_map"] = {"": 0}
    model = AutoModelForCausalLM.from_pretrained(args.model_id, **model_kwargs)

    if args.adapter_dir:
        from peft import PeftModel

        adapter = Path(args.adapter_dir).expanduser().resolve()
        if not adapter.is_dir():
            raise SystemExit(f"--adapter-dir does not exist: {adapter}")
        model = PeftModel.from_pretrained(model, str(adapter))
        print(f"[model] base={args.model_id} adapter={adapter}")
    else:
        print(f"[model] base={args.model_id} (no adapter)")
    model.eval()
    device = next(model.parameters()).device

    correct = 0
    predicted: dict[str, int] = {label: 0 for label in LABELS}
    unparsed = 0
    for start in range(0, len(records), args.batch_size):
        batch_records = records[start : start + args.batch_size]
        prompts = [apply_chat_template(tokenizer, record) for record in batch_records]
        encoded = tokenizer(
            prompts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=args.max_length,
            add_special_tokens=False,
        )
        encoded = {key: value.to(device) for key, value in encoded.items()}
        prompt_len = encoded["input_ids"].shape[1]
        with torch.no_grad():
            output = model.generate(
                **encoded,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
            )
        completions = tokenizer.batch_decode(
            output[:, prompt_len:], skip_special_tokens=True
        )
        for record, completion in zip(batch_records, completions):
            guess = parse_prediction(completion)
            if not guess:
                unparsed += 1
                continue
            predicted[guess] += 1
            if guess == record["label"]:
                correct += 1

    accuracy = 100.0 * correct / len(records)
    counts = ", ".join(f"{label}={predicted[label]}" for label in LABELS)
    print(f"[result] correct={correct}/{len(records)} unparsed={unparsed} ({counts})")
    print(f"Accuracy: {accuracy:.2f}%")
    print(f"Target: >{args.target:.1f}% FEVER dev accuracy")
    if accuracy > args.target:
        print("Result: PASS (above target)")
    else:
        print(f"Result: below target by {args.target - accuracy:.2f} percentage points")
        if args.enforce_target:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
