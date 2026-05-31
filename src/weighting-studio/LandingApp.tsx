import type { CSSProperties } from "react";
import { appPath } from "./routes";

const tools = [
  {
    title: "Output Evaluator",
    path: "/evaluator.html",
    label: "Validate predictions",
    description: "Paste task and prediction JSON, then inspect exact matches, dimensions, cell accuracy, and visual diffs.",
    metric: "JSON + grid diff",
    accent: "teal"
  },
  {
    title: "Creator Studio",
    path: "/creator.html",
    label: "Build tasks",
    description: "Create ARC-style train and test grids, export clean task JSON, or hand a draft directly to the evaluator.",
    metric: "train/test editor",
    accent: "green"
  },
  {
    title: "Weighting Studio",
    path: "/studio.html",
    label: "Score difficulty",
    description: "Review q3-q27 against the structural rubric and export the weighting profile used by results.",
    metric: "7-factor rubric",
    accent: "amber"
  },
  {
    title: "Results Viewer",
    path: "/results.html",
    label: "Compare models",
    description: "Inspect weighted model scores, coverage, heatmaps, validation issues, and per-question output details.",
    metric: "weighted matrix",
    accent: "blue"
  },
  {
    title: "Human Benchmark",
    path: "/human.html",
    label: "Run sessions",
    description: "Record local human attempts with timing, submissions, weighted scoring, and exportable session files.",
    metric: "q3-q27 session",
    accent: "rose"
  }
] as const;

const workflow = [
  "Create an ARC-style task",
  "Evaluate model outputs",
  "Weight question difficulty",
  "Inspect benchmark results",
  "Run human comparisons"
];

const previewGrids = [
  [
    [0, 0, 3, 3, 0, 0],
    [0, 3, 5, 5, 3, 0],
    [3, 5, 8, 8, 5, 3],
    [3, 5, 8, 8, 5, 3],
    [0, 3, 5, 5, 3, 0],
    [0, 0, 3, 3, 0, 0]
  ],
  [
    [2, 0, 0, 0, 0, 2],
    [0, 2, 0, 0, 2, 0],
    [0, 0, 4, 4, 0, 0],
    [0, 0, 4, 4, 0, 0],
    [0, 2, 0, 0, 2, 0],
    [2, 0, 0, 0, 0, 2]
  ],
  [
    [6, 6, 0, 1, 1, 1],
    [6, 0, 0, 0, 1, 0],
    [6, 6, 0, 1, 1, 1],
    [0, 0, 0, 0, 0, 0],
    [7, 7, 7, 0, 9, 9],
    [0, 7, 0, 0, 9, 0]
  ]
] as const;

const colorClass = ["empty", "gray", "red", "blue", "yellow", "green", "purple", "brown", "orange", "black"];

export function LandingApp() {
  return (
    <main className="landing-shell">
      <header className="landing-topbar" aria-label="GRIT3 website navigation">
        <a className="landing-brand" href={appPath("/")} aria-label="GRIT3 home">
          <span className="landing-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>GRIT3</span>
        </a>
        <nav className="landing-nav" aria-label="Tool navigation">
          <a href={appPath("/evaluator.html")}>Evaluator</a>
          <a href={appPath("/creator.html")}>Creator</a>
          <a href={appPath("/studio.html")}>Weights</a>
          <a href={appPath("/results.html")}>Results</a>
          <a href={appPath("/human.html")}>Human</a>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="eyebrow">ARC evaluation workspace</p>
          <h1 id="landing-title">GRIT3</h1>
          <p className="landing-lede">
            A focused toolkit for building grid-reasoning tasks, evaluating outputs, weighting question difficulty,
            comparing model runs, and recording human benchmark sessions.
          </p>
          <div className="landing-hero-actions">
            <a className="button primary landing-cta" href={appPath("/evaluator.html")}>
              Open Evaluator
            </a>
            <a className="button secondary landing-cta" href={appPath("/creator.html")}>
              Create a Task
            </a>
          </div>
        </div>

        <div className="landing-visual" aria-label="GRIT3 grid workflow preview">
          <div className="landing-visual-header">
            <span>q3-q27</span>
            <strong>active workflow</strong>
          </div>
          <div className="landing-preview-stack">
            {previewGrids.map((grid, index) => (
              <GridPreview grid={grid} index={index} key={`preview-${index}`} />
            ))}
          </div>
          <div className="landing-visual-footer">
            <span>Creator</span>
            <span>Evaluator</span>
            <span>Results</span>
          </div>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="tools-title">
        <div className="landing-section-heading">
          <p className="eyebrow">Choose a function</p>
          <h2 id="tools-title">Everything has a direct path.</h2>
        </div>
        <div className="landing-tool-grid">
          {tools.map((tool) => (
            <a className={`landing-tool-card ${tool.accent}`} href={appPath(tool.path)} key={tool.title}>
              <span className="landing-tool-label">{tool.label}</span>
              <strong>{tool.title}</strong>
              <span>{tool.description}</span>
              <em>{tool.metric}</em>
            </a>
          ))}
        </div>
      </section>

      <section className="landing-section landing-workflow-section" aria-labelledby="workflow-title">
        <div className="landing-section-heading">
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-title">Move from task design to benchmark evidence.</h2>
        </div>
        <ol className="landing-workflow">
          {workflow.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function GridPreview({ grid, index }: { grid: readonly (readonly number[])[]; index: number }) {
  return (
    <div className="landing-grid-card" style={{ "--landing-card-index": index } as CSSProperties}>
      <div className="landing-grid">
        {grid.flatMap((row, y) =>
          row.map((cell, x) => <span className={`landing-cell ${colorClass[cell]}`} key={`${x}-${y}`} />)
        )}
      </div>
    </div>
  );
}
