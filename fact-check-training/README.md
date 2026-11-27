# Fact-check training (Q1 + Q3)

This directory contains the **data pipeline** (Q1) and the **training/evaluation entrypoints** (Q3) for the
fact-check council model. It does **not** run training here: Q4 (the actual GPU training run and the
>85% FEVER-dev evaluation) is a separate task on a GPU box/cloud instance.

Everything Python here is syntax-checked with `python3 -m py_compile`. `fetch_data.py` needs only the standard
library; `train.py` and `evaluate.py` import ML packages lazily so `--help` works without them installed.

## Layout

```text
fact-check-training/
  fetch_data.py            # stdlib downloader + normalizer
  train.py                 # transformers + peft + bitsandbytes QLoRA
  evaluate.py              # FEVER dev accuracy
  requirements.txt         # pinned GPU-stack versions
  data/
    fever/
      fever_train.sample.jsonl   # committed small fixture (real rows)
      fever_dev.sample.jsonl     # committed small fixture (real rows)
      fever_train.task.jsonl     # Q1 instruction/context/output format after full fetch
      .raw/sample/               # Range-capped cache, gitignored
      .raw/full/                 # complete source downloads, gitignored
    liar/
      liar_train.sample.jsonl
      liar_dev.sample.jsonl
      liar_test.sample.jsonl
      liar_valid.sample.tsv      # raw TSV excerpt for parser tests
      liar_train.task.jsonl      # Q1 instruction/context/output format after full fetch
      .raw/sample/               # cached sample source files
      .raw/full/                 # complete source files
    synthetic/                   # created by another task; normalized *.jsonl
  outputs/                       # adapters, gitignored
```

## Normalized record schema

Every JSONL line is exactly:

```json
{"claim":"...","label":"supported","evidence":"...","source":"fever","split":"dev"}
```

Canonical labels are `supported`, `refuted`, `not_enough_info`.

| Dataset | Original label | Canonical label |
| --- | --- | --- |
| FEVER | `SUPPORTS` | `supported` |
| FEVER | `REFUTES` | `refuted` |
| FEVER | `NOT ENOUGH INFO` | `not_enough_info` |
| LIAR | `true`, `mostly-true` | `supported` |
| LIAR | `pants-fire`, `false`, `barely-true` | `refuted` |
| LIAR | `half-true` | `not_enough_info` (mixed/uncertain) |

LIAR's `valid.tsv` becomes `split: "dev"`; `test.tsv` becomes `split: "test"`.

Each fetch also writes parallel `*.task.jsonl` files in the requested Q1 format:
`instruction`, `context`, and `output` (a JSON string containing `verdict`, `confidence`,
and `reasoning`). `not_enough_info` maps to `unverifiable`. Confidence is `1.0` for the
source dataset's gold annotation; reasoning states the gold label because these datasets
do not provide model-written explanations. The normalized files remain the trainer input.

`evidence` is a compact identifier, not the full evidence corpus:
- FEVER: flattened `wikipedia:<page>:<sentence_id>` ids from the row's nested evidence (up to 5).
- LIAR: `PolitiFact:<id> | speaker: ... | original label: ... | context: ...`.

Evaluation is therefore **evidence-aware verification with supplied gold evidence**, not open-domain
retrieval. The large FEVER Wikipedia corpus is deliberately not downloaded.

## Exact sources, licenses and attribution

| Data | Exact URL(s) used by `fetch_data.py` | License / attribution |
| --- | --- | --- |
| FEVER train | `https://fever.ai/download/fever/train.jsonl` | FEVER, Thorne *et al.*, NAACL-HLT 2018. Dataset page: `https://fever.ai/dataset/fever.html`. Hugging Face card `https://huggingface.co/datasets/fever/fever` lists **CC BY-SA-3.0** (data) and **GPL-3.0** (support code); Wikipedia-derived text is CC BY-SA. |
| FEVER dev | `https://fever.ai/download/fever/shared_task_dev.jsonl` | Same as above. This is the labelled shared-task dev split. |
| LIAR | `https://www.cs.ucsb.edu/~william/data/liar_dataset.zip` (redirects to `https://sites.cs.ucsb.edu/~william/data/liar_dataset.zip`; contains `train.tsv`, `valid.tsv`, `test.tsv`) | William Yang Wang, *"Liar, Liar Pants on Fire: A New Benchmark Dataset for Fake News Detection"*, ACL 2017, DOI `10.18653/v1/P17-2067`, `https://www.aclweb.org/anthology/P17-2067`. The HF card `https://huggingface.co/datasets/ucsbai/liar` lists the license as **unknown**; treat it as research data. Only small excerpts are committed here. |
| Base model | `https://huggingface.co/Qwen/Qwen3.5-9B` | Qwen3.5-9B is the post-trained (instruct) 9B checkpoint, **Apache-2.0**. `--model-id` overrides it. |

Observed official file sizes: FEVER train ~33 MB, FEVER shared-task dev ~4.3 MB, LIAR zip ~1 MB.
The committed fixtures are tiny excerpts (a few hundred rows total) and no large binaries are committed.

The full fetch currently produces **145,449 FEVER train + 19,998 labelled dev rows** and **12,836 LIAR rows**
(train/valid/test). FEVER's published total of 185,445 also counts the blind test split, which is unlabelled;
it is not included because Q1 requires label-bearing training JSONL. The full source, normalized and task-format
files stay local under ignored `data/` paths to avoid committing the LIAR archive or dataset dumps.

## Q1: fetch / normalize

```bash
cd /home/jimmy/Projects/neon-fact-check

# Small, reproducible samples (HTTP Range-capped; safe on a laptop/CI):
python3 fact-check-training/fetch_data.py --limit 120 --max-bytes 200000 --suffix .sample

# Full source datasets (the fetch keeps sample and full caches separate):
python3 fact-check-training/fetch_data.py --limit 0

# Only one dataset, or override a URL if a mirror is needed:
python3 fact-check-training/fetch_data.py --only liar --force
python3 fact-check-training/fetch_data.py --fever-dev-url https://mirror.example/shared_task_dev.jsonl

# Reproduce the raw TSV excerpt fixture after a LIAR fetch:
head -n 20 fact-check-training/data/liar/.raw/valid.tsv > fact-check-training/data/liar/liar_valid.sample.tsv
```

Useful flags: `--data-dir`, `--limit` (`0` = full), `--max-bytes`, `--suffix`, `--only`, `--force`,
`--timeout`. Raw downloads are cached under each dataset's `.raw/` and are gitignored; re-running with the
same cache is deterministic. If the network is blocked, the script prints a clear error and the committed
`*.sample.jsonl` files keep offline tests runnable.

## Q3: train / evaluate

The prompt is shared verbatim by `train.py` and `evaluate.py` through `PROMPT_SYSTEM` and `user_prompt()`
in `fetch_data.py`, so train/eval cannot drift:

```text
system: You are a careful fact-checker. Classify the claim using ONLY the supplied evidence...
user:   Claim: <claim>
        Evidence: <evidence or "(no evidence supplied)">
        Label (supported / refuted / not_enough_info):
target: one canonical label + EOS (prompt tokens masked with -100)
```

Qwen3.5 uses `enable_thinking=False` in the chat template so the target stays one short label.

### Local / cloud setup

```bash
python3 -m venv .venv && source .venv/bin/activate
# On a CUDA box, install the torch wheel matching your driver first (see requirements.txt), then:
pip install -r fact-check-training/requirements.txt

# Train a QLoRA adapter (needs a CUDA GPU; this command is the Q4 task, not run here):
python3 fact-check-training/train.py \
  --model-id Qwen/Qwen3.5-9B \
  --output-dir fact-check-training/outputs/qlora \
  --epochs 1 --lora-rank 16 --max-length 1024 --seed 42

# Evaluate full FEVER dev against the target:
python3 fact-check-training/evaluate.py \
  --model-id Qwen/Qwen3.5-9B \
  --adapter-dir fact-check-training/outputs/qlora \
  --max-length 1024
```

`evaluate.py` prints both accuracy and `Target: >85.0% FEVER dev accuracy` and reports PASS/below-target.
It uses greedy decoding and the supplied dev evidence. Add `--enforce-target` to exit 1 when the target is
missed; otherwise the exit code stays 0 so smoke tests are not flaky.

Main train flags: `--model-id`, `--fever-dir`, `--liar-dir`, `--synthetic-dir`, `--extra-data-dir`,
`--epochs`, `--lora-rank`, `--lora-alpha`, `--lora-dropout`, `--lora-targets`, `--output-dir`,
`--max-length`, `--max-records`, `--batch-size`, `--grad-accum`, `--lr`, `--seed`, `--precision`.
Dev/test records are excluded from training; synthetic records from `data/synthetic/*.jsonl` are included
automatically once the other task creates them (missing directory only warns).

Main evaluate flags: `--model-id`, `--adapter-dir`, `--data-dir`, `--dev-file`, `--max-length`,
`--max-new-tokens`, `--batch-size`, `--limit`, `--target`, `--seed`, `--full-precision`,
`--enforce-target`. If `fever_dev.jsonl` is absent it falls back to `fever_dev.sample.jsonl` and says so.

**Memory note:** 4-bit QLoRA needs roughly 10–14 GB VRAM for a 9B model; `--full-precision` needs ~18 GB
and `--max-length`/`--batch-size` can be lowered to fit. CPU training/evaluation is out of scope.
