#!/usr/bin/env python3
"""QLoRA fine-tune Qwen3.5-9B for 3-way claim verification.

This is the Q3 implementation only: it defines the reproducible training entrypoint.
Actually running it (Q4) is a separate GPU task. Third-party imports are lazy so the
file can be syntax-checked and --help'd on a CPU box with no ML packages installed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable, Iterator

from fetch_data import LABELS, PROMPT_SYSTEM, canonical_label, iter_jsonl, user_prompt

DATA_ROOT = Path(__file__).resolve().parent / "data"
DEFAULT_MODEL_ID = "Qwen/Qwen3.5-9B"  # verified post-trained (instruct) 9B; Apache-2.0
DEFAULT_LORA_TARGETS = (
    "q_proj,k_proj,v_proj,o_proj,in_proj_qkv,in_proj_z,out_proj,"
    "gate_proj,up_proj,down_proj"
)
EVAL_SPLITS = {"dev", "valid", "validation", "test"}


def apply_chat_template(tokenizer, record: dict) -> str:
    """Use the same Qwen chat template in training and evaluation.

    enable_thinking=False gives a one-line answer, which is what the label
    supervision and the greedy evaluator both expect. Older override models
    may not accept that kwarg, hence the fallback.
    """
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


def collect_records(args: argparse.Namespace) -> Iterator[dict]:
    """Read normalized FEVER/LIAR JSONL plus synthetic/*.jsonl; skip eval splits."""
    roots = [args.fever_dir, args.liar_dir, args.synthetic_dir, *args.extra_data_dir]
    seen: set[tuple[str, str, str]] = set()
    kept = 0

    for root in roots:
        root_path = Path(root).expanduser()
        if not root_path.exists():
            if Path(root) == Path(args.synthetic_dir):
                print(
                    f"[warn] synthetic data dir not present yet: {root_path} "
                    "(another task creates it)",
                    file=sys.stderr,
                )
            continue
        for path in sorted(root_path.rglob("*.jsonl")):
            if ".raw" in path.parts:
                continue
            for row in iter_jsonl(path):
                if {"instruction", "context", "output"}.issubset(row):
                    instruction = str(row.get("instruction", ""))
                    if not instruction.startswith("Verify this claim: ") or not isinstance(row.get("output"), str):
                        continue
                    try:
                        output = json.loads(row["output"])
                    except (TypeError, json.JSONDecodeError):
                        continue
                    verdict = output.get("verdict") if isinstance(output, dict) else None
                    label = "not_enough_info" if verdict == "unverifiable" else canonical_label(verdict)
                    claim = instruction.removeprefix("Verify this claim: ").strip()
                    evidence = str(row.get("context", "")).strip()
                    split = ""
                    source = path.parent.name
                else:
                    split = str(row.get("split", "")).strip().lower()
                    label = canonical_label(row.get("label"))
                    claim = str(row.get("claim", "")).strip()
                    evidence = str(row.get("evidence", "")).strip()
                    source = str(row.get("source", path.parent.name))
                if not args.include_eval and split in EVAL_SPLITS:
                    continue
                if not label or label not in LABELS or not claim:
                    continue
                key = (claim, label, evidence)
                if key in seen:
                    continue
                seen.add(key)
                yield {
                    "claim": claim,
                    "label": label,
                    "evidence": evidence,
                    "source": source,
                    "split": split or "train",
                }
                kept += 1
                if args.max_records and kept >= args.max_records:
                    return


def build_features(tokenizer, records: Iterable[dict], max_length: int) -> list[dict]:
    """Chat-format prompt + label-only completion, masked prompt tokens with -100."""
    if tokenizer.eos_token_id is None:
        raise ValueError("Tokenizer needs an EOS token to build label completions")
    features: list[dict] = []
    for record in records:
        prompt = apply_chat_template(tokenizer, record)
        prompt_ids = tokenizer.encode(prompt, add_special_tokens=False)
        answer_ids = tokenizer.encode(" " + record["label"], add_special_tokens=False)
        answer_ids.append(tokenizer.eos_token_id)
        if max_length <= len(answer_ids):
            raise ValueError(f"--max-length {max_length} is too small for the answer tokens")
        prompt_ids = prompt_ids[: max_length - len(answer_ids)]
        features.append(
            {
                "input_ids": prompt_ids + answer_ids,
                "attention_mask": [1] * (len(prompt_ids) + len(answer_ids)),
                "labels": [-100] * len(prompt_ids) + answer_ids,
            }
        )
    return features


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help="HF model id (default: %(default)s)")
    parser.add_argument("--fever-dir", type=Path, default=DATA_ROOT / "fever")
    parser.add_argument("--liar-dir", type=Path, default=DATA_ROOT / "liar")
    parser.add_argument("--synthetic-dir", type=Path, default=DATA_ROOT / "synthetic")
    parser.add_argument(
        "--extra-data-dir",
        type=Path,
        action="append",
        default=[],
        help="Additional JSONL directory; repeatable",
    )
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=0, help="0 means 2x rank")
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument(
        "--lora-targets",
        default=DEFAULT_LORA_TARGETS,
        help="Comma-separated PEFT target module suffixes (default: %(default)s)",
    )
    parser.add_argument("--output-dir", type=Path, default=DATA_ROOT.parent / "outputs" / "qlora")
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--max-records", type=int, default=0, help="0 means all records")
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--precision", choices=("bf16", "fp16", "fp32"), default="bf16")
    parser.add_argument(
        "--include-eval",
        action="store_true",
        help="Include dev/test records in training (not recommended; breaks evaluation)",
    )
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Only for custom override models that require it",
    )
    args = parser.parse_args(argv)
    if args.lora_rank < 1 or args.max_length < 16 or args.batch_size < 1:
        parser.error("--lora-rank >= 1, --max-length >= 16, --batch-size >= 1 are required")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    records = list(collect_records(args))
    if not records:
        raise SystemExit(
            "No training records found. Run fetch_data.py first and/or create "
            f"{args.synthetic_dir} with normalized *.jsonl files."
        )

    try:
        import torch
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            BitsAndBytesConfig,
            Trainer,
            TrainingArguments,
            set_seed,
        )
    except ImportError as exc:
        raise SystemExit(f"Missing ML dependency: {exc}. Install requirements.txt on a GPU box.") from exc

    if not torch.cuda.is_available():
        raise SystemExit("QLoRA training needs a CUDA GPU; Q4 is a separate cloud/GPU task.")

    set_seed(args.seed)
    dtype = {
        "bf16": torch.bfloat16,
        "fp16": torch.float16,
        "fp32": torch.float32,
    }[args.precision]

    tokenizer = AutoTokenizer.from_pretrained(args.model_id, use_fast=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    features = build_features(tokenizer, records, args.max_length)
    print(f"[data] {len(features)} training examples from {len({r['source'] for r in records})} source(s)")

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        quantization_config=quantization,
        device_map={"": 0},
        torch_dtype=dtype,
        trust_remote_code=args.trust_remote_code,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)

    targets = [name.strip() for name in args.lora_targets.split(",") if name.strip()]
    lora_config = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_alpha or 2 * args.lora_rank,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=targets,
    )
    model = get_peft_model(model, lora_config)
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()
    model.print_trainable_parameters()

    def collate(batch: list[dict]) -> dict:
        max_len = max(len(item["input_ids"]) for item in batch)
        pad_id = tokenizer.pad_token_id
        input_ids, attention_mask, labels = [], [], []
        for item in batch:
            padding = max_len - len(item["input_ids"])
            input_ids.append(item["input_ids"] + [pad_id] * padding)
            attention_mask.append(item["attention_mask"] + [0] * padding)
            labels.append(item["labels"] + [-100] * padding)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attention_mask, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }

    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=args.logging_steps,
        save_strategy="epoch",
        save_total_limit=2,
        bf16=args.precision == "bf16",
        fp16=args.precision == "fp16",
        optim="paged_adamw_8bit",
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        report_to=[],
        seed=args.seed,
        data_seed=args.seed,
        remove_unused_columns=False,
    )
    trainer = Trainer(model=model, args=training_args, train_dataset=features, data_collator=collate)
    trainer.train()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    metadata = {
        "base_model": args.model_id,
        "epochs": args.epochs,
        "lora_rank": args.lora_rank,
        "lora_targets": targets,
        "max_length": args.max_length,
        "seed": args.seed,
        "training_records": len(features),
        "sources": sorted({r["source"] for r in records}),
    }
    (args.output_dir / "train_config.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"[done] adapter saved to {args.output_dir}")
    print("Next: python3 fact-check-training/evaluate.py --adapter-dir " + str(args.output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
