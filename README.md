# GRIT3 Question Weighting Studio

This repository contains a website-style landing page at `index.html`, the standalone output evaluator at `evaluator.html`, a local creator studio at `creator.html`, a local weighting studio at `studio.html`, a human benchmarker at `human.html`, and a model results viewer at `results.html`.

## Run The Studio

```bash
npm install
npm run dev
```

Open:

- `http://localhost:5173/` for the GRIT3 landing page and tool chooser
- `http://localhost:5173/evaluator.html` for the original output evaluator
- `http://localhost:5173/creator.html` to build custom ARC-style train/test question JSON
- `http://localhost:5173/studio.html` to edit structural question weights
- `http://localhost:5173/results.html` to inspect model results with those weights
- `http://localhost:5173/human.html` to run the local human benchmarker

For a production check:

```bash
npm run test
npm run build
```

To verify that recorded outputs match the sheet's `Cell Accuracy` values:

```bash
npm run validate:results
```

The validator checks q3-q27 in `data/*.csv` against the hidden expected outputs in `questions/`. It exits nonzero when a recorded percentage, output count, output JSON, or `Correct?` flag does not line up.

## Run OpenAI Benchmarks

The benchmark runner reads `questions/q3.json` through `questions/q27.json`, calls OpenAI once per question, grades the returned grids locally against the hidden `test.output` answers, and writes a Google Sheet-compatible CSV into `data/`.

PowerShell dry run:

```powershell
npm.cmd run benchmark:openai -- --model gpt-5.5 --dry-run
```

PowerShell live run:

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm.cmd run benchmark:openai -- --model gpt-5.5 --name "gpt-5.5" --reasoning high
```

Optional cost calculation:

```powershell
npm.cmd run benchmark:openai -- --model gpt-5.5 --name "gpt-5.5" --input-price-per-1m 5 --output-price-per-1m 30
```

The runner requires `--model` for every live run so it cannot accidentally spend against an implicit default. `OPENAI_API_KEY` is read from the environment and is never written to the output CSV.

## Profile Storage

Profiles autosave in the browser under this localStorage key:

```text
grit3.weightingStudio.profile.v1
```

Use **Export JSON** to save the full profile object, **Import JSON** to restore or edit a saved profile, and **Export CSV** for a compact summary table.

The benchmark question JSON files in `questions/` are loaded read-only. The studio does not overwrite question data or benchmark assets.

The results viewer uses the root `grit3-weighting-profile.json` by default, so export your completed profile with that filename when you want the viewer to use it.

## Human Benchmark Storage

The Human Benchmark page autosaves the current run in the browser under this localStorage key:

```text
grit3.humanBenchmark.session.v1
```

It runs q3-q27 in fixed order, shows one question at a time, records per-question and per-submission timing, and exports full JSON or attempt-level CSV for later collection.

## Creator Storage

The Creator Studio autosaves drafts in the browser under this localStorage key:

```text
grit3.creator.draft.v1
```

It exports pure ARC-style task JSON with `train` and `test` arrays. Use **Copy JSON** or **Download** to save a created question locally. **Open Evaluator** stores the current task under `grit3.creator.evaluatorTask.v1` and preloads it into the standalone evaluator at `evaluator.html`.

## Scoring And Weights

Each question has seven manual rubric ratings from 1 to 5:

- `number_of_concepts`
- `object_abstraction`
- `transformation_depth`
- `distractors`
- `output_precision`
- `rule_ambiguity`
- `compositionality`

`computed_average` is the average of those seven values, rounded to two decimals.

Suggested weights map as follows:

- `1.00-2.00` => weight `1`
- `>2.00-3.00` => weight `2`
- `>3.00-4.00` => weight `3`
- `>4.00-5.00` => weight `4`

`final_weight` is the manual override when one is set; otherwise it is the suggested bucket. Overrides can be `1` through `5` and are visually marked in the UI.

## Question Data Format

Repo inspection confirmed that `questions/q3.json` through `questions/q27.json` use ARC-style task data:

```json
{
  "train": [{ "input": [[0]], "output": [[0]] }],
  "test": [{ "input": [[0]], "output": [[0]] }]
}
```

The loader lives in `src/weighting-studio/questionLoader.ts`. If grit3 later stores questions in a richer format, update `adaptArcTask` there to convert that format into the internal ARC shape without modifying the benchmark files.

## Results CSV Format

The results viewer reads all `data/*.csv` files exported from the Google Sheet layout. The first CSV row is a notes/header row and is skipped.

Rows for `Question 1` and `Question 2` are ignored. Only q3 through q27 are scored.

`Cell Accuracy` is the authoritative result status:

- blank cell accuracy means the model was not run on that question
- `100%` or `100.00%` means correct
- any numeric value below `100%` means wrong

The `Correct?` column is shown only as raw context and is not used for scoring.

The viewer calculates:

- evaluated weighted score: correct weighted points divided by evaluated weighted points
- full benchmark progress: correct weighted points divided by all q3-q27 weighted points
- coverage: evaluated weighted points divided by all q3-q27 weighted points

Time, cost, and token totals are calculated from the per-question columns. The notes column is used only for metadata such as model name, date, and thinking level when present.

## Guardrails

The weighting workflow is intentionally manual. It does not include model names, model scores, or any logic that infers weights from model performance.
