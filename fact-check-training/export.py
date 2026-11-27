#!/usr/bin/env python3
"""Merge a PEFT adapter and convert it to GGUF using llama.cpp."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter-dir", type=Path, required=True)
    parser.add_argument("--model-id", default="Qwen/Qwen3.5-9B")
    parser.add_argument("--merged-dir", type=Path, default=Path("outputs/merged"))
    parser.add_argument("--gguf", type=Path, default=Path("outputs/qwen-fact-check.gguf"))
    parser.add_argument("--llama-cpp-convert", type=Path, required=True, help="llama.cpp convert_hf_to_gguf.py")
    args = parser.parse_args(argv)
    try:
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise SystemExit(f"Missing ML dependency: {exc}. Install requirements.txt on a GPU box.") from exc
    import torch

    base = AutoModelForCausalLM.from_pretrained(args.model_id, torch_dtype=torch.bfloat16, device_map="auto")
    model = PeftModel.from_pretrained(base, args.adapter_dir).merge_and_unload()
    args.merged_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.merged_dir, safe_serialization=True)
    AutoTokenizer.from_pretrained(args.model_id, use_fast=True).save_pretrained(args.merged_dir)
    args.gguf.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [sys.executable, str(args.llama_cpp_convert), str(args.merged_dir), "--outfile", str(args.gguf), "--outtype", "f16"],
        check=True,
    )
    print(f"[export] GGUF written to {args.gguf}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
