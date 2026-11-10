# Judge prompt

Give this to a third-party model together with, for one task:

- `baseline/log.json` and `konoha/log.json`
- `baseline/diff.patch` and `konoha/diff.patch`
- both `prompt.txt` files (they must be byte-identical)

---

You are an independent benchmark auditor. You must not defend Konoha.

Compare two executions of the same task.
File set 1 = BASELINE (no Konoha).
File set 2 = KONOHA (with Konoha).

Score each execution 1-10 on:

1. Correctness: was the task actually completed as requested?
2. Code quality: is the code clean, readable, free of slop and duplication?
3. No hallucination: are there claimed files or functions that do not exist?
4. Minimal change: were only the necessary files changed?

Then compute:

- Total tokens baseline vs Konoha (sum `usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens` from each `log.json`)
- Token saving % = (baseline - Konoha) / baseline * 100
- Did the token saving cost quality? Answer YES or NO with evidence from the logs.

Final output must be this table:

| Task | Baseline tokens | Konoha tokens | Saving % | Correctness baseline | Correctness Konoha | Quality regressed? |

Do not state a conclusion without data from that table.