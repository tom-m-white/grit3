# GRIT3 Toolkit

GRIT3 is a browser-based toolkit for creating, evaluating, weighting, and comparing ARC-style grid reasoning tasks. It includes a polished landing page plus separate tools for task creation, output evaluation, question weighting, model result inspection, and human benchmarking.

The app is built with Vite and React, deploys as static files, and is configured for GitHub Pages under the project path `/grit3/`.

## Tools

- **Landing page** (`/`) - website-style entry point for choosing a GRIT3 workflow.
- **Output Evaluator** (`/evaluator.html`) - paste task JSON and prediction JSON, then inspect exact matches, cell accuracy, dimensions, and visual diffs.
- **Creator Studio** (`/creator.html`) - build ARC-style `train` and `test` grids, export task JSON, or send a draft directly to the evaluator.
- **Weighting Studio** (`/studio.html`) - manually rate q3-q27 with a structural rubric and export the weighting profile.
- **Results Viewer** (`/results.html`) - compare model runs with weighted scores, coverage, heatmaps, validation checks, timing, cost, and token totals.
- **Human Benchmark** (`/human.html`) - run local human benchmark sessions, record timing/submissions, and export session data.

## Local Development

Install dependencies and start Vite:

```bash
npm install
npm run dev
```

Open `http://localhost:5173/grit3/` when using the current GitHub Pages-style base path. Vite also serves the individual pages under that prefix:

- `http://localhost:5173/grit3/evaluator.html`
- `http://localhost:5173/grit3/creator.html`
- `http://localhost:5173/grit3/studio.html`
- `http://localhost:5173/grit3/results.html`
- `http://localhost:5173/grit3/human.html`

Run the checks before publishing:

```bash
npm run test
npm run build
```

PowerShell may require `npm.cmd` instead:

```powershell
npm.cmd run test
npm.cmd run build
```

## Deployment

The project is configured for GitHub Pages at:

```text
https://tom-m-white.github.io/grit3/
```

Important deployment pieces:

- `vite.config.ts` sets `base: "/grit3/"`.
- `.github/workflows/deploy.yml` builds the app and publishes `dist/` with GitHub Actions.
- GitHub repo settings should use **Pages -> Build and deployment -> Source: GitHub Actions**.

After pushing to `main`, check the repo's **Actions** tab. A green `Deploy to GitHub Pages` run means the site should be live.

## Data And Storage

Question files live in `questions/q3.json` through `questions/q27.json` and use ARC-style task data:

```json
{
  "train": [{ "input": [[0]], "output": [[0]] }],
  "test": [{ "input": [[0]], "output": [[0]] }]
}
```

Browser data is stored locally:

- Weighting profiles: `grit3.weightingStudio.profile.v1`
- Creator drafts: `grit3.creator.draft.v1`
- Creator-to-evaluator handoff: `grit3.creator.evaluatorTask.v1`
- Human benchmark sessions: `grit3.humanBenchmark.session.v1`

The benchmark question JSON files are loaded read-only. The tools do not overwrite question data or benchmark assets.

## Results And Validation

The Results Viewer reads benchmark CSV files from `data/*.csv`. It skips the first notes/header row, ignores `Question 1` and `Question 2`, and scores q3-q27.

`Cell Accuracy` is the authoritative result status:

- blank means the model was not run
- `100%` or `100.00%` means correct
- any numeric value below `100%` means wrong

To verify recorded outputs against hidden expected outputs:

```bash
npm run validate:results
```

The validator exits nonzero when a recorded percentage, output count, output JSON, or `Correct?` flag does not line up.

## OpenAI Benchmark Runner

The optional benchmark runner reads q3-q27, calls OpenAI once per question, grades returned grids locally, and writes a Google Sheet-compatible CSV into `data/`.

Dry run:

```powershell
npm.cmd run benchmark:openai -- --model gpt-5.5 --dry-run
```

Live run:

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm.cmd run benchmark:openai -- --model gpt-5.5 --name "gpt-5.5" --reasoning high
```

Optional cost calculation:

```powershell
npm.cmd run benchmark:openai -- --model gpt-5.5 --name "gpt-5.5" --input-price-per-1m 5 --output-price-per-1m 30
```

The runner requires `--model` for every live run so it cannot accidentally spend against an implicit default. `OPENAI_API_KEY` is read from the environment and is never written to output CSV files.

## Weighting Rubric

The weighting workflow is intentionally manual. It does not infer weights from model performance.

Each question has seven rubric ratings from 1 to 5:

- `number_of_concepts`
- `object_abstraction`
- `transformation_depth`
- `distractors`
- `output_precision`
- `rule_ambiguity`
- `compositionality`

`computed_average` is the rounded average of those seven values. Suggested weights map as follows:

- `1.00-2.00` -> weight `1`
- `>2.00-3.00` -> weight `2`
- `>3.00-4.00` -> weight `3`
- `>4.00-5.00` -> weight `4`

`final_weight` is the manual override when set; otherwise, it is the suggested bucket.
