import { useMemo, useState } from "react";
import { AppHeader } from "./AppHeader";
import { GridPanel } from "./GridPanel";
import { loadQuestions } from "./questionLoader";
import { QUESTION_IDS } from "./rubric";
import {
  getExpectedOutputs,
  loadBundledProfile,
  loadBundledResults,
  summarizeQuestionWinRates,
  type MetricSource,
  type ModelResult,
  type QuestionWinRate,
  type ResultStatus
} from "./resultsData";
import type { ArcGrid, QuestionId } from "./types";

const QUESTIONS = loadQuestions();
const PROFILE = loadBundledProfile();
const MODELS = loadBundledResults(PROFILE, QUESTIONS);
const QUESTION_WIN_RATES = summarizeQuestionWinRates(MODELS);
const RELEASE_CHART_POINTS = buildReleaseDateChartPoints(MODELS);
const COST_CHART_POINTS = buildCostChartPoints(MODELS);

type SortKey =
  | "evaluatedWeightedPercent"
  | "averageComputedCellScorePercent"
  | "fullProgressPercent"
  | "coveragePercent"
  | "correctCount"
  | "totalDollars";

interface ChartPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  xText: string;
  source?: MetricSource;
}

interface ChartPointLayout extends ChartPoint {
  pointX: number;
  pointY: number;
  labelX: number;
  labelY: number;
  displayLabel: string;
}

export function ResultsApp() {
  const [selectedQuestionId, setSelectedQuestionId] = useState<QuestionId>("q3");
  const [selectedModelId, setSelectedModelId] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("evaluatedWeightedPercent");

  const totalWeight = QUESTION_IDS.reduce((sum, questionId) => sum + PROFILE.questions[questionId].final_weight, 0);
  const selectedQuestion = QUESTIONS.find((question) => question.question_id === selectedQuestionId);
  const selectedProfile = PROFILE.questions[selectedQuestionId];
  const selectedWinRate = QUESTION_WIN_RATES[selectedQuestionId];
  const visibleModels = selectedModelId === "all" ? MODELS : MODELS.filter((model) => model.id === selectedModelId);
  const sortedModels = useMemo(() => sortModels(MODELS, sortKey), [sortKey]);
  const averageCoverage =
    MODELS.length === 0 ? 0 : roundToOne(MODELS.reduce((sum, model) => sum + model.summary.coveragePercent, 0) / MODELS.length);
  const validationIssueCount = MODELS.reduce((sum, model) => sum + model.summary.validationIssueCount, 0);

  return (
    <main className="app-shell">
      <AppHeader title="Results Viewer" searchId="results-profile-search" />

      <div className="results-workspace">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Overview</p>
              <h2>Weighted model results</h2>
            </div>
            <span className="panel-meta">q3-q27 only</span>
          </div>
          <div className="summary-metrics results-metrics">
            <Metric label="Models" value={String(MODELS.length)} />
            <Metric label="Total weight" value={String(totalWeight)} />
            <Metric label="Avg coverage" value={`${averageCoverage}%`} />
            <Metric label="Questions" value="25" />
            <Metric label="Validation issues" value={String(validationIssueCount)} />
          </div>
        </section>

        <section className="results-chart-grid">
          <ScatterChart
            eyebrow="Release"
            title="Release date vs score"
            xLabel="Model release date"
            yLabel="Evaluated weighted score"
            points={RELEASE_CHART_POINTS}
            formatXTick={formatShortDate}
            formatXValue={(point) => point.xText}
          />
          <ScatterChart
            eyebrow="Cost"
            title="Cost vs score"
            xLabel="Total cost"
            yLabel="Evaluated weighted score"
            points={COST_CHART_POINTS}
            formatXTick={formatChartDollars}
            formatXValue={(point) => formatDollars(point.x, point.source)}
            showSourceLegend
            xStartsAtZero
          />
        </section>

        <section className="results-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Models</p>
                <h2>Summary</h2>
              </div>
              <label className="compact-field">
                <span>Sort</span>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                  <option value="evaluatedWeightedPercent">Evaluated weighted</option>
                  <option value="averageComputedCellScorePercent">Avg cell score</option>
                  <option value="fullProgressPercent">Full progress</option>
                  <option value="coveragePercent">Coverage</option>
                  <option value="correctCount">Correct count</option>
                  <option value="totalDollars">Cost</option>
                </select>
              </label>
            </div>
            <div className="summary-table-wrap">
              <table className="summary-table model-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Eval weighted</th>
                    <th>Avg cell score</th>
                    <th>Full progress</th>
                    <th>Coverage</th>
                    <th>Checks</th>
                    <th>Correct</th>
                    <th>Wrong</th>
                    <th>Not run</th>
                    <th>Time</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.map((model) => (
                    <tr key={model.id}>
                      <td>
                        <button className="table-link" type="button" onClick={() => setSelectedModelId(model.id)}>
                          {model.metadata.modelName}
                        </button>
                      </td>
                      <td>{formatNullablePercent(model.summary.evaluatedWeightedPercent)}</td>
                      <td title={`${model.summary.computedCellScoreCount} recomputed question score(s)`}>
                        {formatPreciseNullablePercent(model.summary.averageComputedCellScorePercent)}
                      </td>
                      <td>
                        {model.summary.correctWeight}/{model.summary.totalWeight} ({model.summary.fullProgressPercent}%)
                      </td>
                      <td>
                        {model.summary.evaluatedWeight}/{model.summary.totalWeight} ({model.summary.coveragePercent}%)
                      </td>
                      <td className={model.summary.validationIssueCount > 0 ? "validation-count" : undefined}>
                        {model.summary.validationIssueCount === 0
                          ? "OK"
                          : `${model.summary.validationIssueCount} in ${model.summary.validationQuestionCount} q`}
                      </td>
                      <td>{model.summary.correctCount}</td>
                      <td>{model.summary.wrongCount}</td>
                      <td>{model.summary.notEvaluatedCount}</td>
                      <td>{formatSeconds(model.summary.totalSeconds)}</td>
                      <td>{formatDollars(model.summary.totalDollars, model.summary.totalDollarsSource)}</td>
                      <td>{formatNumber(model.summary.totalTokens, model.summary.totalTokensSource)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Matrix</p>
                <h2>q3-q27 heatmap</h2>
              </div>
              <div className="legend">
                <span className="legend-pill correct">Correct</span>
                <span className="legend-pill wrong">Wrong</span>
                <span className="legend-pill not-run">Not run</span>
              </div>
            </div>
            <div className="heatmap-wrap">
              <table className="heatmap">
                <thead>
                  <tr>
                    <th>Model</th>
                    {QUESTION_IDS.map((questionId) => {
                      const winRate = QUESTION_WIN_RATES[questionId];
                      return (
                        <th className="heatmap-question-header" key={questionId} title={formatQuestionWinRateTitle(questionId, winRate)}>
                          <span className="heatmap-question-label">{questionId}</span>
                          <span className="heatmap-question-win">{formatNullablePercent(winRate.winPercent)}</span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {MODELS.map((model) => (
                    <tr key={model.id}>
                      <th>{model.metadata.modelName}</th>
                      {QUESTION_IDS.map((questionId) => {
                        const result = model.results[questionId];
                        const validationCount = result.validationIssues.length;
                        return (
                          <td key={questionId}>
                            <button
                              className={`heatmap-cell ${statusClass(result.status)} ${
                                selectedQuestionId === questionId ? "selected" : ""
                              } ${validationCount > 0 ? "validation-issue" : ""}`}
                              type="button"
                              title={`${model.metadata.modelName} ${questionId}: ${statusLabel(result.status)}${
                                result.cellAccuracy === null ? "" : ` (${result.cellAccuracy}%)`
                              }${validationCount > 0 ? `; ${validationCount} validation issue(s)` : ""}`}
                              onClick={() => {
                                setSelectedQuestionId(questionId);
                                setSelectedModelId(model.id);
                              }}
                            >
                              {statusSymbol(result.status)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Question detail</p>
              <h2>{selectedQuestionId}</h2>
            </div>
            <div className="detail-controls">
              <label className="compact-field">
                <span>Question</span>
                <select value={selectedQuestionId} onChange={(event) => setSelectedQuestionId(event.target.value as QuestionId)}>
                  {QUESTION_IDS.map((questionId) => (
                    <option value={questionId} key={questionId}>
                      {questionId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="compact-field">
                <span>Model</span>
                <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
                  <option value="all">All models</option>
                  {MODELS.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.metadata.modelName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="question-profile-strip">
            <Metric label="Weight" value={String(selectedProfile.final_weight)} />
            <Metric label="Rubric avg" value={selectedProfile.computed_average.toFixed(2)} />
            <Metric label="Suggested" value={String(selectedProfile.suggested_weight_bucket)} />
            <Metric label="Model win rate" value={formatQuestionWinRate(selectedWinRate)} />
            <div className="profile-notes">
              <strong>Tags</strong>
              <span>{selectedProfile.tags.length > 0 ? selectedProfile.tags.join(", ") : "None"}</span>
            </div>
          </div>

          {selectedQuestion?.task ? (
            <div className="expected-section">
              <h3>Expected test outputs</h3>
              <div className="output-grid-list">
                {getExpectedOutputs(selectedQuestion).map((grid, index) => (
                  <GridPanel title={`Expected ${index + 1}`} grid={grid} key={`expected-${index}`} />
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">Question data could not be loaded.</div>
          )}

          <div className="model-detail-list">
            {visibleModels.map((model) => (
              <ModelQuestionDetail
                expectedOutputs={getExpectedOutputs(selectedQuestion)}
                model={model}
                questionId={selectedQuestionId}
                key={model.id}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ScatterChart({
  eyebrow,
  title,
  xLabel,
  yLabel,
  points,
  formatXTick,
  formatXValue,
  showSourceLegend = false,
  xStartsAtZero = false
}: {
  eyebrow: string;
  title: string;
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
  formatXTick: (value: number) => string;
  formatXValue: (point: ChartPoint) => string;
  showSourceLegend?: boolean;
  xStartsAtZero?: boolean;
}) {
  const width = 760;
  const height = 340;
  const top = 28;
  const right = 190;
  const bottom = 58;
  const left = 58;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xValues = points.length > 0 ? points.map((point) => point.x) : [0, 1];
  const rawMinX = xStartsAtZero ? 0 : Math.min(...xValues);
  const rawMaxX = Math.max(...xValues);
  const rawSpanX = rawMaxX - rawMinX || Math.max(Math.abs(rawMaxX), 1);
  const xMin = xStartsAtZero ? 0 : rawMinX - rawSpanX * 0.08;
  const xMax = rawMaxX + rawSpanX * 0.08;
  const xSpan = xMax - xMin || 1;
  const xTicks = buildChartTicks(xMin, xMax, 3);
  const yTicks = [0, 25, 50, 75, 100];
  const plotRight = width - right;
  const pointLayouts = buildChartPointLayouts(points, {
    xMin,
    xSpan,
    left,
    top,
    chartWidth,
    chartHeight,
    labelX: plotRight + 24,
    minLabelY: top + 14,
    maxLabelY: height - bottom - 8
  });

  return (
    <section className="panel results-chart-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {showSourceLegend ? (
          <div className="chart-legend">
            <span>
              <i className="chart-swatch recorded" aria-hidden="true" />
              Recorded
            </span>
            <span>
              <i className="chart-swatch estimated" aria-hidden="true" />
              Estimated
            </span>
          </div>
        ) : (
          <span className="panel-meta">{points.length} models</span>
        )}
      </div>
      <div className="scatter-chart-wrap">
        {points.length === 0 ? (
          <div className="empty-state">No plottable models.</div>
        ) : (
          <svg className="scatter-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            {yTicks.map((tick) => {
              const y = top + chartHeight - (tick / 100) * chartHeight;
              return (
                <g key={`y-${tick}`}>
                  <line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} />
                  <text className="chart-tick" x={left - 10} y={y + 4} textAnchor="end">
                    {formatChartPercent(tick)}
                  </text>
                </g>
              );
            })}
            {xTicks.map((tick) => {
              const x = left + ((tick - xMin) / xSpan) * chartWidth;
              return (
                <g key={`x-${tick}`}>
                  <line className="chart-grid-line vertical" x1={x} x2={x} y1={top} y2={height - bottom} />
                  <text className="chart-tick" x={x} y={height - bottom + 22} textAnchor="middle">
                    {formatXTick(tick)}
                  </text>
                </g>
              );
            })}
            <line className="chart-axis-line" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
            <line className="chart-axis-line" x1={left} x2={left} y1={top} y2={height - bottom} />
            <text className="chart-axis-label" x={left + chartWidth / 2} y={height - 12} textAnchor="middle">
              {xLabel}
            </text>
            <text
              className="chart-axis-label"
              x={-(top + chartHeight / 2)}
              y={16}
              textAnchor="middle"
              transform="rotate(-90)"
            >
              {yLabel}
            </text>
            {pointLayouts.map((point) => {
              const sourceClass = point.source === "estimated" ? "estimated" : "recorded";

              return (
                <g className="scatter-point-group" key={point.id}>
                  <line
                    className={`chart-label-line ${sourceClass}`}
                    x1={point.pointX + 8}
                    x2={point.labelX - 9}
                    y1={point.pointY}
                    y2={point.labelY - 4}
                  />
                  <circle className={`scatter-point ${sourceClass}`} cx={point.pointX} cy={point.pointY} r="6.5">
                    <title>
                      {point.label}: {formatXValue(point)}; score {formatChartPercent(point.y)}
                    </title>
                  </circle>
                  <text className={`chart-label-text ${sourceClass}`} x={point.labelX} y={point.labelY}>
                    {point.displayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}

function ModelQuestionDetail({
  model,
  questionId,
  expectedOutputs
}: {
  model: ModelResult;
  questionId: QuestionId;
  expectedOutputs: ArcGrid[];
}) {
  const result = model.results[questionId];

  return (
    <article className="model-detail-card">
      <div className="model-detail-header">
        <div>
          <h3>{model.metadata.modelName}</h3>
          <p className="muted-line">{model.fileName}</p>
        </div>
        <span className={`status-badge ${statusClass(result.status)}`}>{statusLabel(result.status)}</span>
      </div>
      <div className="result-facts">
        <span>Cell accuracy: {result.cellAccuracy === null ? "blank" : `${result.cellAccuracy}%`}</span>
        <span>Recomputed: {result.computedValidation ? result.computedValidation.cellAccuracyRaw : "n/a"}</span>
        <span>Checks: {result.validationIssues.length === 0 ? "OK" : `${result.validationIssues.length} issue(s)`}</span>
        <span>Correct? flag: {result.rawCorrectFlag || "blank"}</span>
        <span>Time: {formatSeconds(result.seconds)}</span>
        <span>Cost: {formatDollars(result.effectiveDollars, result.dollarsSource)}</span>
        <span>Tokens: {formatNumber(result.effectiveTokens, result.tokensSource)}</span>
      </div>
      {result.outputParseError && result.validationIssues.length === 0 ? (
        <div className="warning-line">Output parse error: {result.outputParseError}</div>
      ) : null}
      {result.validationIssues.map((issue, index) => (
        <div className="warning-line validation-line" key={`${issue.kind}-${index}`}>
          {issue.message}
        </div>
      ))}
      {result.parsedOutputs.length > 0 ? (
        <div className="output-grid-list">
          {result.parsedOutputs.map((grid, index) => {
            const expected = expectedOutputs[index];
            return (
              <GridPanel
                title={`Model output ${index + 1}${expected && gridsComparable(grid, expected) ? " diff" : ""}`}
                grid={grid}
                compareGrid={expected && gridsComparable(grid, expected) ? expected : undefined}
                key={`${model.id}-${questionId}-${index}`}
              />
            );
          })}
        </div>
      ) : (
        <p className="muted-line">No parseable output grid recorded.</p>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function sortModels(models: ModelResult[], sortKey: SortKey): ModelResult[] {
  return [...models].sort((a, b) => {
    const av = a.summary[sortKey] ?? -1;
    const bv = b.summary[sortKey] ?? -1;
    return Number(bv) - Number(av) || b.summary.coveragePercent - a.summary.coveragePercent;
  });
}

function buildReleaseDateChartPoints(models: ModelResult[]): ChartPoint[] {
  return models
    .map((model): ChartPoint | null => {
      const score = model.summary.evaluatedWeightedPercent;
      const timestamp = dateToTimestamp(model.metadata.releaseDate);
      if (score === null || timestamp === null) {
        return null;
      }
      return {
        id: `${model.id}-release`,
        label: model.metadata.modelName,
        x: timestamp,
        y: score,
        xText: formatFullDate(timestamp)
      };
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.x - b.x || b.y - a.y);
}

function buildCostChartPoints(models: ModelResult[]): ChartPoint[] {
  return models
    .map((model): ChartPoint | null => {
      const score = model.summary.evaluatedWeightedPercent;
      const dollars = model.summary.totalDollars;
      if (score === null || dollars === null || model.summary.totalDollarsSource === "blank") {
        return null;
      }
      return {
        id: `${model.id}-cost`,
        label: model.metadata.modelName,
        x: dollars,
        y: score,
        xText: formatDollars(dollars, model.summary.totalDollarsSource),
        source: model.summary.totalDollarsSource
      };
    })
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.x - b.x || b.y - a.y);
}

function buildChartTicks(min: number, max: number, count: number): number[] {
  if (count <= 1 || min === max) {
    return [min];
  }
  return Array.from({ length: count }, (_, index) => min + ((max - min) / (count - 1)) * index);
}

function buildChartPointLayouts(
  points: ChartPoint[],
  dimensions: {
    xMin: number;
    xSpan: number;
    left: number;
    top: number;
    chartWidth: number;
    chartHeight: number;
    labelX: number;
    minLabelY: number;
    maxLabelY: number;
  }
): ChartPointLayout[] {
  const minGap = 23;
  const layouts = points
    .map((point) => ({
      ...point,
      pointX: dimensions.left + ((point.x - dimensions.xMin) / dimensions.xSpan) * dimensions.chartWidth,
      pointY: dimensions.top + dimensions.chartHeight - (point.y / 100) * dimensions.chartHeight,
      labelX: dimensions.labelX,
      labelY: dimensions.top,
      displayLabel: chartModelLabel(point.label)
    }))
    .sort((a, b) => a.pointY - b.pointY || a.pointX - b.pointX);

  let nextLabelY = dimensions.minLabelY;
  for (const layout of layouts) {
    layout.labelY = Math.max(layout.pointY + 4, nextLabelY);
    nextLabelY = layout.labelY + minGap;
  }

  const overflow = layouts.length === 0 ? 0 : layouts[layouts.length - 1].labelY - dimensions.maxLabelY;
  if (overflow > 0) {
    for (const layout of layouts) {
      layout.labelY -= overflow;
    }
  }

  const underflow = layouts.length === 0 ? 0 : dimensions.minLabelY - layouts[0].labelY;
  if (underflow > 0) {
    for (const layout of layouts) {
      layout.labelY += underflow;
    }
  }

  return layouts;
}

function chartModelLabel(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized.includes("claude opus 4 8")) {
    return "Claude Opus 4.8";
  }
  if (normalized.includes("gemini 3 5 flash")) {
    return "Gemini 3.5 Flash";
  }
  if (normalized.includes("gemini 3 1 pro")) {
    return "Gemini 3.1 Pro";
  }
  if (normalized.includes("chatgpt 5 5") || normalized.includes("gpt 5 5")) {
    return "ChatGPT 5.5 ET";
  }
  if (
    normalized.includes("chatgpt 5 4 et") ||
    normalized.includes("chatgpt 5 4 extended thinking") ||
    normalized.includes("gpt 5 4 et") ||
    normalized.includes("gpt 5 4 extended thinking")
  ) {
    return "ChatGPT 5.4 ET";
  }
  if (normalized.includes("deepseek v4 pro")) {
    return "DeepSeek V4 Pro";
  }
  if (normalized.includes("grok 4 3 beta")) {
    return "Grok 4.3 Beta";
  }
  if (normalized.includes("gpt 5 4 mini")) {
    return "GPT-5.4 Mini";
  }
  return value.length <= 18 ? value : `${value.slice(0, 15)}...`;
}

function dateToTimestamp(date: string | undefined): number | null {
  if (!date) {
    return null;
  }
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function statusClass(status: ResultStatus): string {
  return status === "not_evaluated" ? "not-run" : status;
}

function statusLabel(status: ResultStatus): string {
  if (status === "not_evaluated") {
    return "Not run";
  }
  return status === "correct" ? "Correct" : "Wrong";
}

function statusSymbol(status: ResultStatus): string {
  if (status === "correct") {
    return "1";
  }
  if (status === "wrong") {
    return "0";
  }
  return "-";
}

function formatNullablePercent(value: number | null): string {
  return value === null ? "n/a" : `${value}%`;
}

function formatPreciseNullablePercent(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(4)}%`;
}

function formatQuestionWinRate(winRate: QuestionWinRate): string {
  return `${winRate.correctCount}/${winRate.evaluatedCount} (${formatNullablePercent(winRate.winPercent)})`;
}

function formatQuestionWinRateTitle(questionId: QuestionId, winRate: QuestionWinRate): string {
  return `${questionId} model win rate: ${formatQuestionWinRate(winRate)}; ${winRate.notEvaluatedCount} not run of ${winRate.totalModelCount} models`;
}

function formatChartPercent(value: number): string {
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`;
}

function formatChartDollars(value: number): string {
  if (value >= 10) {
    return `$${value.toFixed(0)}`;
  }
  return `$${value.toFixed(value === 0 ? 0 : 2)}`;
}

function formatShortDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatFullDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(value)
  );
}

function formatSeconds(value: number | null): string {
  if (value === null) {
    return "blank";
  }
  return `${formatNumber(value)}s`;
}

function formatDollars(value: number | null, source: MetricSource = "recorded"): string {
  if (value === null || source === "blank") {
    return "blank";
  }
  return `${source === "estimated" ? "~" : ""}$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatNumber(value: number | null, source: MetricSource = "recorded"): string {
  if (value === null || source === "blank") {
    return "blank";
  }
  return `${source === "estimated" ? "~" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}

function gridsComparable(a: ArcGrid, b: ArcGrid): boolean {
  return a.length === b.length && a[0]?.length === b[0]?.length;
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}
