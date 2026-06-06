# GRIT3 Toolkit

GRIT3 is a browser-based toolkit for creating, evaluating, weighting, and comparing ARC-style grid reasoning tasks. It includes a polished landing page plus separate tools for task creation, output evaluation, question weighting, model result inspection, and human benchmarking.

The app is built with Vite and React, deploys as static files, and is configured for GitHub Pages under the project path `/grit3/`.

## Tools

- **Landing page** (`/`) - website-style entry point with a top LLM leaderboard and direct workflow links.
- **Output Evaluator** (`/evaluator.html`) - paste task JSON and prediction JSON, then inspect exact matches, cell accuracy, dimensions, and visual diffs.
- **Creator Studio** (`/creator.html`) - build ARC-style `train` and `test` grids, export task JSON, or send a draft directly to the evaluator.
- **Weighting Studio** (`/studio.html`) - manually rate q3-q27 with a structural rubric and export the weighting profile.
- **Results Viewer** (`/results.html`) - compare model runs with weighted scores, coverage, heatmaps, validation checks, timing, cost, and token totals.
- **Human Benchmark** (`/human.html`) - run account-backed human benchmark sessions one random unseen question at a time.
- **Profile** (`/profile.html`) - view benchmark progress, run history, and saved creator questions.
- **1v1 Challenge** (`/challenge.html?id=...`) - profile-launched duel mode where two users exchange created task JSON and race to solve.
- **Admin Review** (`/admin.html`) - role-gated review queue for user-created questions.

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
- `http://localhost:5173/grit3/profile.html`
- `http://localhost:5173/grit3/challenge.html?id=<challenge-id>`
- `http://localhost:5173/grit3/admin.html`

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

Account-backed data is stored in Supabase. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run `supabase/schema.sql` in your Supabase project. Supabase's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names are also supported for compatibility with their setup guide.

The benchmark question JSON files are loaded read-only. The tools do not overwrite question data or benchmark assets. User-created questions are stored for review and are not included in the benchmark pool until a future inclusion workflow is added.

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

Flex processing uses the same lower token rates as the Batch API, but keeps the runner synchronous:

```powershell
npm.cmd run benchmark:openai -- --model gpt-5.4-mini --name "GPT-5.4 mini high flex" --reasoning high --flex --input-price-per-1m 0.375 --output-price-per-1m 2.25
```

The `--flex` flag sends `service_tier: "flex"` to OpenAI. Flex requests may be slower, so the runner allows up to 15 minutes per API request. The price flags only populate the CSV cost column and do not change API billing. The asynchronous Batch API is not exposed by this runner.

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

- `1.00-1.50` -> weight `0.5`
- `>1.50-2.00` -> weight `1`
- `>2.00-2.50` -> weight `1.5`
- `>2.50-3.00` -> weight `2`
- `>3.00-3.50` -> weight `2.5`
- `>3.50-4.00` -> weight `3`
- `>4.00-4.50` -> weight `3.5`
- `>4.50-5.00` -> weight `4`

`final_weight` is the manual override when set; otherwise, it is the suggested bucket. Manual overrides allow half-step weights from `0.5` through `5.5`.
