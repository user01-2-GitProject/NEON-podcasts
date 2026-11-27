# Synthetic podcast claim dataset

`podcast_claims.jsonl` has **2,520** lines, one JSON object per line.
Regenerate it (and this README) with:

```sh
python3 fact-check-training/generate_synthetic.py
```

Defaults: seed `20261127`, 42 scenarios per topic. Templates are
deterministic and use only the Python standard library — no API key or
network access. The claims are invented training examples, not reports
about real events.

## Schema

Each line uses Q1's exact `{instruction, context, output}` shape. `output` is a JSON-encoded string.
The decoded output has `verdict`, `confidence`, and `reasoning`; synthetic category/topic/format are noted in reasoning.

| output verdict | meaning |
| --- | --- |
| `supported` | true |
| `refuted` | false or misleading/partial |
| `unverifiable` | evidence does not establish the claim |

## Counts

| label | count |
| --- | ---: |
| true | 1,008 |
| false | 756 |
| misleading | 504 |
| unverifiable | 252 |

| topic | count |
| --- | ---: |
| news | 420 |
| pop culture | 420 |
| sports | 420 |
| science | 420 |
| history | 420 |
| tech | 420 |

| format | count |
| --- | ---: |
| studio-analysis | 358 |
| breaking-news | 360 |
| interview | 360 |
| field-report | 364 |
| roundtable | 366 |
| recap | 353 |
| debate | 359 |

The dataset is balanced at exactly 40% true, 30% false, 20% misleading/partial, and 10% unverifiable.
Podcast-style openers add conversational phrasing while the evidence and label stay unchanged.

## Verify

```sh
python3 -m unittest fact-check-training/test_q2.py
```
