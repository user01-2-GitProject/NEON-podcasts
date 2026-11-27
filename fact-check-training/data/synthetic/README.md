# Synthetic podcast claim dataset

`podcast_claims.jsonl` has **3,500** lines, one JSON object per line.
Regenerate it (and this README) with:

```sh
python3 fact-check-training/generate_synthetic.py
```

Defaults: seed `20261127`, 100 scenarios per topic. Templates are
deterministic and use only the Python standard library — no API key or
network access. The claims are invented training examples, not reports
about real events.

## Schema

| field | type | meaning |
| --- | --- | --- |
| `id` | string | Stable unique id, `SC00001` onwards. |
| `claim` | string | One podcast-style spoken assertion. |
| `label` | string | `true`, `false`, `misleading`, `unsupported`, `outdated`. |
| `topic` | string | `finance`, `breaking-news`, `interview`, `sports`, `science`, `local news`, `history`. |
| `format` | string | `studio-analysis`, `breaking-news`, `interview`, `field-report`, `roundtable`, `recap`, `debate`. |
| `evidence` | string | A cited source excerpt; enough to decide the label. |
| `explanation` | string | Why the claim earns that label. |

## Counts

| label | count |
| --- | ---: |
| true | 700 |
| false | 700 |
| misleading | 700 |
| unsupported | 700 |
| outdated | 700 |

| topic | count |
| --- | ---: |
| finance | 500 |
| breaking-news | 500 |
| interview | 500 |
| sports | 500 |
| science | 500 |
| local news | 500 |
| history | 500 |

| format | count |
| --- | ---: |
| studio-analysis | 500 |
| breaking-news | 500 |
| interview | 500 |
| field-report | 500 |
| roundtable | 500 |
| recap | 500 |
| debate | 500 |

Each scenario yields five contrastive records: one true claim and four
mutations. False claims rotate through numeric, date, and name
mutations. Misleading claims keep a real number but drop a scope the
source states; unsupported claims add a specific detail the cited
sources do not cover; outdated claims use a superseded figure.

## Verify

```sh
python3 -c 'import json,pathlib; p=pathlib.Path("fact-check-training/data/synthetic/podcast_claims.jsonl"); r=[json.loads(x) for x in p.read_text().splitlines()]; assert len(r)==len({x["id"] for x in r}); assert all(x["label"] in {"true","false","misleading","unsupported","outdated"} for x in r); print(len(r), "records OK")'
```
