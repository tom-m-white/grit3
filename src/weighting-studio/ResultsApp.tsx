import { useMemo, useState } from "react";
import { AppHeader } from "./AppHeader";
import { GridPanel } from "./GridPanel";
import { loadQuestions } from "./questionLoader";
import { QUESTION_IDS } from "./rubric";
import {
  getExpectedOutputs,
  loadBundledProfile,
  loadBundledResults,
  type MetricSource,
  type ModelResult,
  type ResultStatus
} from "./resultsData";
import type { ArcGrid, QuestionId } from "./types";

const QUESTIONS = loadQuestions();
const PROFILE = loadBundledProfile();
const MODELS = loadBundledResults(PROFILE, QUESTIONS);

type SortKey = "evaluatedWeightedPercent" | "fullProgressPercent" | "coveragePercent" | "correctCount" | "totalDollars";

export function ResultsApp() {
  const [selectedQuestionId, setSelectedQuestionId] = useState<QuestionId>("q3");
  const [selectedModelId, setSelectedModelId] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("evaluatedWeightedPercent");

  const totalWeight = QUESTION_IDS.reduce((sum, questionId) => sum + PROFILE.questions[questionId].final_weight, 0);
  const selectedQuestion = QUESTIONS.find((question) => question.question_id === selectedQuestionId);
  const selectedProfile = PROFILE.questions[selectedQuestionId];
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
                    {QUESTION_IDS.map((questionId) => (
                      <th key={questionId}>{questionId}</th>
                    ))}
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
