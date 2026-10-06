# QA Flow File Format & Codify Mapping

A flow file is a plain JSON array of `agent-browser` commands. It serves as the executable reproduction, the verification contract, and the deterministic input for `qa_codify`.

## File Format

Stored under `<test-dir>/e2e/flows/<name>.json`:

```json
[
  ["open", "http://localhost:4173/detector"],
  ["find", "role", "heading", "--name", "AI Detector"],
  ["find", "label", "Input Text", "fill", "Sample automated test text"],
  ["find", "role", "button", "click", "--name", "Analyze"],
  ["wait", "--text", "Analysis Complete"]
]
```

## Codify Mapping Table

| Flow Command Array | Deterministic Playwright Output |
|---|---|
| `["open", url]` | `await page.goto(url);` |
| `["find", "role", R, "click", "--name", N]` | `await page.getByRole(R, { name: N }).click();` |
| `["find", "role", R, "fill", V, "--name", N]` | `await page.getByRole(R, { name: N }).fill(V);` |
| `["find", "label", L, "fill", V]` | `await page.getByLabel(L).fill(V);` |
| `["find", "label", L, "click"]` | `await page.getByLabel(L).click();` |
| `["find", "text", T, "click"]` | `await page.getByText(T).click();` |
| `["find", "testid", ID, "click"]` | `await page.getByTestId(ID).click();` |
| `["find", "testid", ID, "fill", V]` | `await page.getByTestId(ID).fill(V);` |
| `["press", key]` | `await page.keyboard.press(key);` |
| `["wait", "--text", T]` | `await expect(page.getByText(T)).toBeVisible();` |
| `["wait", "--url", glob]` | `await page.waitForURL(glob);` |
| `["wait", selector]` | `await expect(page.locator(selector)).toBeVisible();` |
| `["is", "visible", selector]` | `await expect(page.locator(selector)).toBeVisible();` |
| `["click", selector]` | `await page.locator(selector).click();` |
| `["fill", selector, value]` | `await page.locator(selector).fill(value);` |

### Modifiers & Options

- `--exact`: Translates into `{ exact: true }` in locator options.
- `--name N`: Used in ARIA role lookups (`{ name: N }`).

### Lint & Rejection Rules

1. **Transient Refs Forbidden**: Any command containing `@e1`, `@e2`, etc. is rejected with an error. Flows must use semantic locators (`find role|label|text|testid`).
2. **Exploration Only Commands**: `snapshot`, `screenshot`, `console`, `errors`, `network` are stripped during codification.
3. **No Slop or Fake Green**: Generated tests must never contain `test.skip`, `test.fixme`, `.only`, `page.pause()`, or arbitrary `sleep` calls.
