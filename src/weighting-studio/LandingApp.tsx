import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { APP_TOOL_LINKS } from "./AppHeader";
import { ProfileSearch } from "./ProfileSearch";
import { loadBundledProfile, loadBundledResults } from "./resultsData";
import { appPath } from "./routes";

const PROFILE = loadBundledProfile();
const LEADERBOARD = loadBundledResults(PROFILE)
  .filter((model) => model.summary.evaluatedCount > 0)
  .sort(
    (a, b) =>
      (b.summary.evaluatedWeightedPercent ?? -1) - (a.summary.evaluatedWeightedPercent ?? -1) ||
      b.summary.fullProgressPercent - a.summary.fullProgressPercent ||
      b.summary.coveragePercent - a.summary.coveragePercent ||
      a.metadata.modelName.localeCompare(b.metadata.modelName)
  );

const TOP_MODEL = LEADERBOARD[0] ?? null;
const TOP_SCORE = TOP_MODEL?.summary.evaluatedWeightedPercent ?? null;

const heroStats = [
  { value: String(LEADERBOARD.length), label: "model runs recorded" },
  { value: "25", label: "weighted questions (q3-q27)" },
  { value: TOP_SCORE === null ? "n/a" : formatPercent(TOP_SCORE), label: "current top weighted score" }
];

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
    description: "Answer one random unseen question at a time with account-backed progress, timing, and submissions.",
    metric: "random q3-q27",
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

const timeline = [
  {
    id: "origins",
    era: "Origins",
    date: "January 27, 2025",
    title: "The first 17-question test",
    description:
      "Where it all started: a 17-question benchmark mixing math, general reasoning, word problems, and real-world analysis — the proving ground for everything that followed.",
    status: "archived" as const
  },
  {
    id: "grit",
    era: "GRIT",
    date: "April 10, 2025",
    title: "The General Reasoning and Intelligence Test",
    description:
      "A 35-question benchmark built purely for general reasoning — harder, longer, trickier questions with no math portion. Calibrated so a college graduate should score around 70%.",
    status: "archived" as const
  },
  {
    id: "grit1",
    era: "GRIT1",
    date: "April 21, 2025",
    title: "Only the hardest questions",
    description:
      "A curated 15-question set selecting the most challenging problems from every benchmark so far — reasonable, complete reasoning problems with substantial room for model growth.",
    status: "archived" as const
  },
  {
    id: "grit2",
    era: "GRIT2",
    date: "May 1, 2026",
    title: "Broader problem domains",
    description:
      "Fifteen questions spanning mazes, physics, logic, geometry, and programming-style outputs — pushing models beyond pure verbal reasoning into structured problem solving.",
    status: "archived" as const
  },
  {
    id: "grit3",
    era: "GRIT3",
    date: "May 4, 2026",
    title: "Extremely hard for LLMs, easy for humans",
    description:
      "Twenty-seven questions — the hardest benchmark yet, with some modeled on the ARC-AGI-2 set. Now live on this site with a seven-factor difficulty rubric, weighted scoring (q3-q27), automated validation, and human benchmark sessions.",
    status: "live" as const
  },
  {
    id: "grit3-100",
    era: "Milestone",
    date: "June 9, 2026",
    title: "First perfect run",
    description:
      "Claude Fable 5 became the first model to record a 100% weighted score on GRIT3, saturating the benchmark and kicking off work on its successor.",
    status: "milestone" as const
  },
  {
    id: "grit4",
    era: "GRIT4",
    date: "In development",
    title: "The next generation",
    description:
      "A harder question pool designed to separate frontier models again, building on everything GRIT3 measured. No results yet — GRIT3 remains the authoritative leaderboard until GRIT4 lands.",
    status: "upcoming" as const
  }
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

const heroFragments = [
  { text: TOP_SCORE === null ? "q3-q27" : `${formatPercent(TOP_SCORE)} weighted`, kind: "score" },
  { text: TOP_MODEL ? `#1 ${TOP_MODEL.metadata.modelName}` : "#1 —", kind: "rank" },
  { text: "cell accuracy 100%", kind: "score" },
  { text: "7-factor rubric", kind: "tag" },
  { text: "GRIT4 incoming", kind: "tag" }
];

const colorClass = ["empty", "gray", "red", "blue", "yellow", "green", "purple", "brown", "orange", "black"];

function useScrollReveal() {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (targets.length === 0) return;
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      targets.forEach((target) => target.classList.add("is-revealed"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return rootRef;
}

export function LandingApp() {
  const rootRef = useScrollReveal();

  return (
    <main className="landing-shell" ref={rootRef}>
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
        <nav className="landing-nav" aria-label="GRIT3 navigation">
          <a href="#leaderboard">Leaderboard</a>
          <a href="#timeline">History</a>
          <a href="#tools">Tools</a>
          <a className="landing-nav-grit4" href="#grit4">
            GRIT4
          </a>
          <details className="header-menu landing-menu">
            <summary className="button secondary">Tools</summary>
            <div className="header-menu-list">
              {APP_TOOL_LINKS.map((tool) => (
                <a className="header-menu-item" href={appPath(tool.path)} key={tool.path}>
                  {tool.label}
                </a>
              ))}
            </div>
          </details>
          <a className="button secondary landing-profile-link" href={appPath("/profile.html")}>
            Profile
          </a>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-scene" aria-hidden="true">
          <div className="landing-hero-gridlines" />
          <div className="landing-hero-glow" />
          {heroFragments.map((fragment, index) => (
            <span
              className={`landing-hero-fragment ${fragment.kind}`}
              key={fragment.text}
              style={{ "--fragment-index": index } as CSSProperties}
            >
              {fragment.text}
            </span>
          ))}
          <span className="landing-hero-question" style={{ "--question-index": 0 } as CSSProperties}>
            ?
          </span>
          <span className="landing-hero-question" style={{ "--question-index": 1 } as CSSProperties}>
            ?
          </span>
          <span className="landing-hero-question" style={{ "--question-index": 2 } as CSSProperties}>
            ?
          </span>
        </div>

        <div className="landing-hero-copy">
          <p className="eyebrow landing-hero-eyebrow">ARC evaluation workspace</p>
          <h1 id="landing-title">
            <span className="landing-title-grit">GRIT</span>
            <span className="landing-title-num">3</span>
          </h1>
          <p className="landing-lede">
            A focused toolkit for building grid-reasoning tasks, evaluating outputs, weighting question difficulty,
            comparing model runs, and recording human benchmark sessions.
          </p>
          <dl className="landing-hero-stats">
            {heroStats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className="landing-profile-search-block">
            <ProfileSearch
              id="landing-profile-search"
              label="Search public profiles"
              placeholder="Search public profiles"
              variant="hero"
            />
          </div>
          <div className="landing-hero-actions">
            <a className="button primary landing-cta" href="#leaderboard">
              See the Leaderboard
            </a>
            <a className="button secondary landing-cta" href={appPath("/evaluator.html")}>
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

      <section className="landing-section landing-leaderboard-section" id="leaderboard" aria-labelledby="leaderboard-title">
        <div className="landing-section-heading landing-leaderboard-heading" data-reveal>
          <div>
            <p className="eyebrow">Leaderboard</p>
            <h2 id="leaderboard-title">Top recorded LLM runs.</h2>
            {TOP_MODEL ? (
              <p className="landing-section-note">
                {TOP_MODEL.metadata.modelName} currently leads with{" "}
                {formatNullablePercent(TOP_MODEL.summary.evaluatedWeightedPercent)} weighted.
              </p>
            ) : null}
          </div>
          <a className="button secondary landing-results-link" href={appPath("/results.html")}>
            View Full Results
          </a>
        </div>
        <div className="landing-leaderboard-wrap" data-reveal>
          <table className="landing-leaderboard">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Model</th>
                <th>Eval weighted</th>
                <th>Full weighted</th>
                <th>Correct</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {LEADERBOARD.map((model, index) => (
                <tr
                  className={index === 0 ? "landing-leader-row is-top" : "landing-leader-row"}
                  key={model.id}
                  style={{ "--row-index": index } as CSSProperties}
                >
                  <td>
                    {index + 1}
                    {index === 0 ? <span className="landing-crown"> ★</span> : null}
                  </td>
                  <td>
                    <strong>{model.metadata.modelName}</strong>
                    <span>{model.metadata.thinkingLevel ? `${model.metadata.thinkingLevel} thinking` : model.fileName}</span>
                  </td>
                  <td>{formatNullablePercent(model.summary.evaluatedWeightedPercent)}</td>
                  <td>{formatPercent(model.summary.fullProgressPercent)}</td>
                  <td>
                    {model.summary.correctCount}/{model.summary.evaluatedCount}
                  </td>
                  <td>{formatPercent(model.summary.coveragePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="landing-section landing-timeline-section" id="timeline" aria-labelledby="timeline-title">
        <div className="landing-section-heading" data-reveal>
          <p className="eyebrow">Benchmark history</p>
          <h2 id="timeline-title">From a 17-question quiz to a saturated leaderboard.</h2>
        </div>
        <ol className="landing-timeline">
          {timeline.map((entry, index) => (
            <li
              className={`landing-timeline-item ${entry.status}`}
              data-reveal
              key={entry.id}
              style={{ "--timeline-index": index } as CSSProperties}
            >
              <div className="landing-timeline-marker" aria-hidden="true">
                <span />
              </div>
              <div className="landing-timeline-card">
                <div className="landing-timeline-meta">
                  <span className="landing-timeline-era">{entry.era}</span>
                  <span className="landing-timeline-date">{entry.date}</span>
                </div>
                <strong>{entry.title}</strong>
                <p>{entry.description}</p>
                {entry.status === "live" ? <em className="landing-timeline-badge live">Live now</em> : null}
                {entry.status === "milestone" ? <em className="landing-timeline-badge milestone">100% weighted</em> : null}
                {entry.status === "upcoming" ? <em className="landing-timeline-badge upcoming">Coming soon</em> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="tools" aria-labelledby="tools-title">
        <div className="landing-section-heading" data-reveal>
          <p className="eyebrow">Choose a function</p>
          <h2 id="tools-title">Everything has a direct path.</h2>
        </div>
        <div className="landing-tool-grid" data-reveal>
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
        <div className="landing-section-heading" data-reveal>
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-title">Move from task design to benchmark evidence.</h2>
        </div>
        <ol className="landing-workflow" data-reveal>
          {workflow.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-grit4-section" id="grit4" aria-labelledby="grit4-title">
        <div className="landing-grit4-card" data-reveal>
          <div className="landing-grit4-copy">
            <p className="eyebrow landing-grit4-eyebrow">In the works</p>
            <h2 id="grit4-title">GRIT4 is coming.</h2>
            <p>
              GRIT3 has been solved — a perfect weighted run is on the board. GRIT4 raises the ceiling with a harder
              question pool built to separate frontier models again. Until its first results land, GRIT3 stays the
              authoritative live leaderboard.
            </p>
            <div className="landing-hero-actions">
              <a className="button primary landing-cta" href={appPath("/creator.html")}>
                Help Build Tasks
              </a>
              <a className="button secondary landing-cta" href={appPath("/results.html")}>
                Explore GRIT3 Results
              </a>
            </div>
          </div>
          <div className="landing-grit4-visual" aria-hidden="true">
            <div className="landing-grit4-grid">
              {Array.from({ length: 36 }, (_, index) => (
                <span key={index} style={{ "--grit4-cell": index } as CSSProperties} />
              ))}
            </div>
            <span className="landing-grit4-mark">GRIT4</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : formatPercent(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`;
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
