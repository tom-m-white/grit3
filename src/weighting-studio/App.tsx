import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { GridPanel } from "./GridPanel";
import { loadQuestions } from "./questionLoader";
import { QUESTION_IDS, RATING_OPTIONS, RUBRIC_FACTORS } from "./rubric";
import { recalculateProfileEntry } from "./scoring";
import {
  createDefaultProfile,
  isComplete,
  normalizeProfile,
  parseTags,
  serializeCsv,
  STORAGE_KEY,
  validateImportedProfile,
  withUpdatedEntry
} from "./profile";
import type { LoadedQuestion, QuestionId, QuestionProfile, Rating, Weight, WeightingProfile } from "./types";

const QUESTIONS = loadQuestions();

export function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showTestOutputs, setShowTestOutputs] = useState(false);
  const [profile, setProfile] = useState<WeightingProfile>(() => readStoredProfile());
  const [status, setStatus] = useState("Autosaved locally.");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedQuestion = QUESTIONS[selectedIndex];
  const questionId = selectedQuestion.question_id;
  const currentEntry = recalculateProfileEntry(profile.questions[questionId]);

  const entries = useMemo(
    () => QUESTION_IDS.map((id) => recalculateProfileEntry(profile.questions[id])),
    [profile]
  );
  const completedEntries = entries.filter(isComplete);
  const averageRatedScore =
    completedEntries.length === 0
      ? 0
      : Math.round(
          (completedEntries.reduce((sum, entry) => sum + entry.computed_average, 0) / completedEntries.length) * 100
        ) / 100;
  const totalWeightedPoints = entries.reduce((sum, entry) => sum + entry.final_weight, 0);
  const weightDistribution = [1, 2, 3, 4, 5].map((weight) => ({
    weight,
    count: entries.filter((entry) => entry.final_weight === weight).length
  }));

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProfile(profile), null, 2));
  }, [profile]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToQuestion(selectedIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToQuestion(selectedIndex + 1);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveNow(profile);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [profile, selectedIndex]);

  function goToQuestion(nextIndex: number) {
    setSelectedIndex(Math.max(0, Math.min(QUESTIONS.length - 1, nextIndex)));
  }

  function updateEntry(changes: Partial<Omit<QuestionProfile, "question_id">>, message = "Saved locally.") {
    setProfile((current) => withUpdatedEntry(current, questionId, changes));
    setStatus(message);
  }

  function updateRating(key: keyof QuestionProfile["ratings"], value: Rating) {
    updateEntry({
      ratings: {
        ...currentEntry.ratings,
        [key]: value
      }
    });
  }

  function updateManualOverride(value: string) {
    updateEntry({
      manual_weight_override: value ? (Number(value) as Weight) : null
    });
  }

  function markReviewed() {
    updateEntry({}, `${questionId} marked reviewed.`);
  }

  function saveNow(nextProfile = profile) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProfile(nextProfile), null, 2));
    setStatus("Saved locally.");
  }

  function exportJson() {
    const normalized = normalizeProfile(profile);
    saveNow(normalized);
    downloadFile("grit3-weighting-profile.json", JSON.stringify(normalized, null, 2), "application/json");
    setStatus("Exported JSON.");
  }

  function exportCsv() {
    downloadFile("grit3-weighting-summary.csv", serializeCsv(normalizeProfile(profile)), "text/csv;charset=utf-8");
    setStatus("Exported CSV.");
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      if (completedEntries.length > 0 && !window.confirm("Replace the current local profile with this JSON file?")) {
        return;
      }
      const parsed = JSON.parse(await file.text());
      const imported = validateImportedProfile(parsed);
      setProfile(imported);
      saveNow(imported);
      setStatus(`Imported ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  }

  return (
    <main className="app-shell">
      <AppHeader
        title="Question Weighting Studio"
        searchId="weighting-profile-search"
        actions={[
          { label: "Import JSON", onClick: () => importInputRef.current?.click() },
          { label: "Export CSV", onClick: exportCsv },
          { label: "Export JSON", onClick: exportJson }
        ]}
      />
      <input ref={importInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importJson} />

      <div className="workspace">
        <aside className="sidebar" aria-label="Question navigation">
          <div className="sidebar-header">
            <strong>Questions</strong>
            <span>{completedEntries.length}/25 complete</span>
          </div>
          <div className="question-list">
            {QUESTIONS.map((question, index) => {
              const entry = profile.questions[question.question_id];
              const complete = isComplete(entry);
              return (
                <button
                  key={question.question_id}
                  className={[
                    "question-link",
                    index === selectedIndex ? "active" : "",
                    complete ? "complete" : "incomplete",
                    question.load_error ? "missing" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                >
                  <span>{question.question_id}</span>
                  <small>{question.load_error ? "missing" : complete ? "complete" : "incomplete"}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="main-column">
          <QuestionViewer
            question={selectedQuestion}
            index={selectedIndex}
            showTestOutputs={showTestOutputs}
            onToggleTestOutputs={() => setShowTestOutputs((value) => !value)}
            onPrevious={() => goToQuestion(selectedIndex - 1)}
            onNext={() => goToQuestion(selectedIndex + 1)}
          />

          <section className="studio-grid">
            <RubricEditor
              entry={currentEntry}
              onRatingChange={updateRating}
              onManualOverrideChange={updateManualOverride}
              onTextChange={(field, value) => updateEntry({ [field]: value })}
              onTagsChange={(value) => updateEntry({ tags: parseTags(value) })}
              onMarkReviewed={markReviewed}
            />

            <SummaryPanel
              entries={entries}
              completedCount={completedEntries.length}
              averageRatedScore={averageRatedScore}
              totalWeightedPoints={totalWeightedPoints}
              weightDistribution={weightDistribution}
              selectedQuestionId={questionId}
              onSelectQuestion={(id) => setSelectedIndex(QUESTION_IDS.indexOf(id))}
            />
          </section>
        </section>
      </div>

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}

interface QuestionViewerProps {
  question: LoadedQuestion;
  index: number;
  showTestOutputs: boolean;
  onToggleTestOutputs: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

function QuestionViewer({
  question,
  index,
  showTestOutputs,
  onToggleTestOutputs,
  onPrevious,
  onNext
}: QuestionViewerProps) {
  return (
    <section className="panel viewer-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Question</p>
          <h2>{question.question_id}</h2>
        </div>
        <div className="nav-actions">
          <button className="button secondary" type="button" onClick={onPrevious} disabled={index === 0}>
            Previous
          </button>
          <button className="button secondary" type="button" onClick={onNext} disabled={index === QUESTIONS.length - 1}>
            Next
          </button>
        </div>
      </div>

      {question.load_error || !question.task ? (
        <div className="empty-state">{question.load_error ?? "Question data is unavailable."}</div>
      ) : (
        <div className="question-content">
          <div className="case-section">
            <h3>Train</h3>
            {question.task.train.map((pair, index) => (
              <div className="pair-row" key={`train-${index}`}>
                <GridPanel title={`Example ${index + 1} input`} grid={pair.input} />
                {pair.output ? <GridPanel title={`Example ${index + 1} output`} grid={pair.output} /> : null}
              </div>
            ))}
          </div>

          <div className="case-section">
            <div className="section-title-row">
              <h3>Test</h3>
              <button className="button ghost" type="button" onClick={onToggleTestOutputs}>
                {showTestOutputs ? "Hide expected outputs" : "Show expected outputs"}
              </button>
            </div>
            {question.task.test.map((pair, index) => (
              <div className="pair-row" key={`test-${index}`}>
                <GridPanel title={`Test ${index + 1} input`} grid={pair.input} />
                {showTestOutputs && pair.output ? <GridPanel title={`Test ${index + 1} expected output`} grid={pair.output} /> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

interface RubricEditorProps {
  entry: QuestionProfile;
  onRatingChange: (key: keyof QuestionProfile["ratings"], value: Rating) => void;
  onManualOverrideChange: (value: string) => void;
  onTextChange: (field: "notes" | "difficulty_rationale", value: string) => void;
  onTagsChange: (value: string) => void;
  onMarkReviewed: () => void;
}

function RubricEditor({
  entry,
  onRatingChange,
  onManualOverrideChange,
  onTextChange,
  onTagsChange,
  onMarkReviewed
}: RubricEditorProps) {
  const overridden = entry.manual_weight_override !== null;

  return (
    <section className="panel rubric-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Rubric profile</p>
          <h2>{entry.question_id}</h2>
        </div>
        <button className="button secondary" type="button" onClick={onMarkReviewed}>
          Mark reviewed
        </button>
      </div>

      <div className="score-strip">
        <Metric label="Average" value={entry.computed_average.toFixed(2)} />
        <Metric label="Suggested" value={String(entry.suggested_weight_bucket)} />
        <Metric label={overridden ? "Final override" : "Final"} value={String(entry.final_weight)} active={overridden} />
      </div>

      <div className="rubric-list">
        {RUBRIC_FACTORS.map((factor) => (
          <fieldset className="rubric-factor" key={factor.key}>
            <legend>{factor.label}</legend>
            <div className="anchors">
              <span>{factor.lowAnchor}</span>
              <span>{factor.highAnchor}</span>
            </div>
            <div className="rating-control" aria-label={factor.label}>
              {RATING_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={entry.ratings[factor.key] === option ? "selected" : ""}
                  type="button"
                  onClick={() => onRatingChange(factor.key, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <label className="field">
        <span>Manual weight override</span>
        <select value={entry.manual_weight_override ?? ""} onChange={(event) => onManualOverrideChange(event.target.value)}>
          <option value="">Use suggested bucket</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </label>

      <label className="field">
        <span>Tags</span>
        <input
          value={entry.tags.join(", ")}
          onChange={(event) => onTagsChange(event.target.value)}
          placeholder="symmetry, counting, object tracking"
        />
      </label>

      <label className="field">
        <span>Notes</span>
        <textarea value={entry.notes} onChange={(event) => onTextChange("notes", event.target.value)} rows={4} />
      </label>

      <label className="field">
        <span>Difficulty rationale</span>
        <textarea
          value={entry.difficulty_rationale}
          onChange={(event) => onTextChange("difficulty_rationale", event.target.value)}
          rows={5}
        />
      </label>
    </section>
  );
}

interface SummaryPanelProps {
  entries: QuestionProfile[];
  completedCount: number;
  averageRatedScore: number;
  totalWeightedPoints: number;
  weightDistribution: { weight: number; count: number }[];
  selectedQuestionId: QuestionId;
  onSelectQuestion: (id: QuestionId) => void;
}

function SummaryPanel({
  entries,
  completedCount,
  averageRatedScore,
  totalWeightedPoints,
  weightDistribution,
  selectedQuestionId,
  onSelectQuestion
}: SummaryPanelProps) {
  return (
    <section className="panel summary-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Summary</h2>
        </div>
      </div>

      <div className="summary-metrics">
        <Metric label="Completed" value={`${completedCount}/25`} />
        <Metric label="Avg rated score" value={averageRatedScore.toFixed(2)} />
        <Metric label="Weighted points" value={String(totalWeightedPoints)} />
      </div>

      <div className="distribution" aria-label="Final weight distribution">
        {weightDistribution.map((item) => (
          <div className="distribution-item" key={item.weight}>
            <span>Weight {item.weight}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>

      <div className="summary-table-wrap">
        <table className="summary-table">
          <thead>
            <tr>
              <th>Question</th>
              <th>Average</th>
              <th>Suggested</th>
              <th>Final</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const complete = isComplete(entry);
              return (
                <tr key={entry.question_id} className={entry.question_id === selectedQuestionId ? "selected-row" : ""}>
                  <td>
                    <button className="table-link" type="button" onClick={() => onSelectQuestion(entry.question_id)}>
                      {entry.question_id}
                    </button>
                  </td>
                  <td>{entry.computed_average.toFixed(2)}</td>
                  <td>{entry.suggested_weight_bucket}</td>
                  <td className={entry.manual_weight_override ? "override-cell" : ""}>{entry.final_weight}</td>
                  <td>{complete ? "complete" : "incomplete"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={active ? "metric active" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function readStoredProfile(): WeightingProfile {
  const fallback = createDefaultProfile();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    return validateImportedProfile(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

function downloadFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
