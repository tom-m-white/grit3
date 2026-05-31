import bundledProfile from "../../grit3-weighting-profile.json";
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { AuthGate, type AppAccount } from "./account";
import {
  type BenchmarkQuestionRecordRow,
  type BenchmarkRunBundle,
  createBenchmarkRun,
  finishBenchmarkQuestion,
  loadLatestOpenRun,
  loadRunSubmissions,
  recordBenchmarkSubmission,
  saveBenchmarkDraft,
  startOrResumeBenchmarkQuestion
} from "./benchmarkStore";
import { ARC_COLOR_MAP, GridPanel } from "./GridPanel";
import {
  serializeHumanBenchmarkCsv,
  serializeHumanBenchmarkJson,
  summarizeHumanSession
} from "./humanBenchmarkSession";
import {
  clearGridSelection,
  copyGridSelection,
  createGrid,
  flipGrid,
  flipGridSelection,
  floodFillGrid,
  gridDimensions,
  isCellInGridSelection,
  moveGridSelection,
  normalizeGridSelection,
  pasteSparseClipboard,
  resizeGrid,
  rotateGrid,
  rotateGridSelection,
  selectCellsByColor,
  setGridCell,
  validateGrid,
  type AdvancedGridSelection,
  type SparseGridClipboard
} from "./creatorGrid";
import { validateImportedProfile } from "./profile";
import { loadQuestions } from "./questionLoader";
import { QUESTION_IDS } from "./rubric";
import { appPath } from "./routes";
import type { ArcGrid, LoadedQuestion, QuestionId } from "./types";

const QUESTIONS = loadQuestions();
const PROFILE = validateImportedProfile(bundledProfile);
const COLORS = Object.keys(ARC_COLOR_MAP).map(Number);
const HISTORY_LIMIT = 80;

type HumanTool = "paint" | "fill" | "select";
type BenchmarkMode = "intro" | "question" | "complete";

export function HumanBenchmarkApp() {
  return (
    <AuthGate title="Sign in to benchmark">
      {(account, controls) => <HumanBenchmarkWorkspace account={account} onSignOut={controls.signOut} />}
    </AuthGate>
  );
}

function HumanBenchmarkWorkspace({ account, onSignOut }: { account: AppAccount; onSignOut: () => Promise<void> }) {
  const [run, setRun] = useState<BenchmarkRunBundle["run"] | null>(null);
  const [records, setRecords] = useState<BenchmarkQuestionRecordRow[]>([]);
  const [mode, setMode] = useState<BenchmarkMode>("intro");
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<ArcGrid[]>([]);
  const [selectedColor, setSelectedColor] = useState(1);
  const [tool, setTool] = useState<HumanTool>("paint");
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [selection, setSelection] = useState<AdvancedGridSelection | null>(null);
  const [clipboard, setClipboard] = useState<SparseGridClipboard | null>(null);
  const [pastDrafts, setPastDrafts] = useState<ArcGrid[][]>([]);
  const [futureDrafts, setFutureDrafts] = useState<ArcGrid[][]>([]);
  const [status, setStatus] = useState("Loading benchmark progress...");
  const [nowTick, setNowTick] = useState(Date.now());
  const isPointerDownRef = useRef(false);
  const lastPaintedRef = useRef<string | null>(null);
  const selectionStartRef = useRef<{ outputIndex: number; x: number; y: number } | null>(null);
  const selectionDraggedRef = useRef(false);
  const selectionBeforePointerDownRef = useRef<AdvancedGridSelection | null>(null);

  const currentQuestionIdValue = run?.current_question_id ?? null;
  const currentQuestion = currentQuestionIdValue ? questionById(currentQuestionIdValue) : null;
  const currentRecord = currentQuestionIdValue
    ? records.find((record) => record.question_id === currentQuestionIdValue) ?? null
    : null;
  const frozen = Boolean(currentRecord?.completed_at || currentRecord?.status === "correct");
  const canSubmit = Boolean(run && currentQuestion?.task && currentRecord && !frozen);
  const summary = useMemo(
    () => (run ? summarizeHumanSession(records, run.started_at, run.completed_at, nowTick) : null),
    [records, run, nowTick]
  );

  useEffect(() => {
    void refreshOpenRun();
  }, [account.user.id]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!currentRecord || !currentQuestion) {
      setDrafts([]);
      return;
    }
    setDrafts(sanitizeRecordDrafts(currentRecord, currentQuestion));
    resetEditorState();
  }, [currentRecord?.id, currentQuestion?.question_id]);

  useEffect(() => {
    function handlePointerUp() {
      if (tool === "select" && selectionStartRef.current && !selectionDraggedRef.current && !frozen) {
        const { outputIndex, x, y } = selectionStartRef.current;
        const grid = drafts[outputIndex];
        const color = grid?.[y]?.[x];
        if (color !== undefined) {
          if (isCellInGridSelection(selectionBeforePointerDownRef.current, grid, x, y)) {
            setSelection(null);
            setStatus("Selection cleared.");
          } else {
            const nextSelection = selectCellsByColor(grid, color);
            setSelection(nextSelection);
            setStatus(nextSelection ? `Selected color ${color}.` : "No matching cells selected.");
          }
        }
      }

      isPointerDownRef.current = false;
      lastPaintedRef.current = null;
      selectionStartRef.current = null;
      selectionDraggedRef.current = false;
      selectionBeforePointerDownRef.current = null;
    }

    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [drafts, frozen, tool]);

  async function refreshOpenRun() {
    setLoading(true);
    try {
      const bundle = await loadLatestOpenRun(account.user.id);
      if (!bundle) {
        setRun(null);
        setRecords([]);
        setMode("intro");
        setStatus("Ready to start.");
        return;
      }
      setRun(bundle.run);
      setRecords(bundle.records);
      setMode("intro");
      setStatus(bundle.run.status === "paused" ? "Benchmark paused." : "Benchmark progress loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load benchmark progress.");
    } finally {
      setLoading(false);
    }
  }

  async function startNewRun() {
    setStatus("Starting benchmark...");
    try {
      const weightsByQuestion = Object.fromEntries(
        QUESTION_IDS.map((questionId) => [questionId, PROFILE.questions[questionId].final_weight])
      ) as Record<QuestionId, number>;
      const created = await createBenchmarkRun(account.user.id, weightsByQuestion);
      const activated = await startOrResumeBenchmarkQuestion(created);
      applyBundle(activated, activated.run.status === "completed" ? "complete" : "question");
      setStatus(activated.run.status === "completed" ? "Benchmark complete." : `${activated.run.current_question_id} ready.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start benchmark.");
    }
  }

  async function resumeRun() {
    if (!run) {
      await startNewRun();
      return;
    }

    setStatus("Resuming benchmark...");
    try {
      const activated = await startOrResumeBenchmarkQuestion({ run, records });
      applyBundle(activated, activated.run.status === "completed" ? "complete" : "question");
      setStatus(activated.run.status === "completed" ? "Benchmark complete." : `${activated.run.current_question_id} ready.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not resume benchmark.");
    }
  }

  function applyBundle(bundle: BenchmarkRunBundle, nextMode: BenchmarkMode) {
    setRun(bundle.run);
    setRecords(bundle.records);
    setMode(nextMode);
    resetEditorState();
  }

  function resetEditorState() {
    setActiveOutputIndex(0);
    setSelection(null);
    setClipboard(null);
    setPastDrafts([]);
    setFutureDrafts([]);
  }

  function commitCurrentDraft(updater: (drafts: ArcGrid[]) => ArcGrid[], message: string, keepSelection = false) {
    if (!currentRecord || frozen) {
      return;
    }

    const previousDrafts = drafts.map(cloneGrid);
    const nextDrafts = updater(drafts).map(cloneGrid);
    setPastDrafts((items) => [...items, previousDrafts].slice(-HISTORY_LIMIT));
    setFutureDrafts([]);
    setDrafts(nextDrafts);
    void saveBenchmarkDraft(currentRecord.id, nextDrafts).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Draft could not be saved.");
    });
    if (!keepSelection) {
      setSelection(null);
    }
    setStatus(message);
  }

  function replaceCurrentDrafts(nextDrafts: ArcGrid[], message: string) {
    if (!currentRecord) {
      return;
    }
    const cloned = nextDrafts.map(cloneGrid);
    setDrafts(cloned);
    void saveBenchmarkDraft(currentRecord.id, cloned).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Draft could not be saved.");
    });
    setSelection(null);
    setStatus(message);
  }

  function updateDraftGrid(outputIndex: number, updater: (grid: ArcGrid) => ArcGrid, message: string, keepSelection = false) {
    if (frozen) {
      return;
    }
    commitCurrentDraft(
      (currentDrafts) => currentDrafts.map((grid, index) => (index === outputIndex ? updater(grid) : grid)),
      message,
      keepSelection
    );
  }

  function resizeDraft(outputIndex: number, width: number, height: number) {
    updateDraftGrid(outputIndex, (grid) => resizeGrid(grid, width, height), "Grid resized.");
  }

  function clearDraft(outputIndex: number) {
    updateDraftGrid(outputIndex, (grid) => createGrid(grid[0]?.length ?? 1, grid.length, 0), "Answer grid cleared.");
  }

  function copyTestInput(outputIndex: number) {
    const input = currentQuestion?.task?.test[outputIndex]?.input;
    if (!input) {
      return;
    }
    updateDraftGrid(outputIndex, () => cloneGrid(input), "Test input copied.");
  }

  function selectOutput(outputIndex: number) {
    setActiveOutputIndex(outputIndex);
    if (outputIndex !== activeOutputIndex) {
      setSelection(null);
    }
  }

  function copySelectedRegion() {
    const grid = drafts[activeOutputIndex];
    const copied = grid ? copyGridSelection(grid, selection) : null;
    if (!copied) {
      setStatus("No selection to copy.");
      return;
    }
    setClipboard(copied);
    setStatus(`Copied ${copied.width} x ${copied.height} selection.`);
  }

  function pasteAtSelection() {
    const grid = drafts[activeOutputIndex];
    if (!grid || !clipboard) {
      setStatus("No copied selection to paste.");
      return;
    }
    const origin = normalizeGridSelection(selection, grid) ?? { x: 0, y: 0 };
    updateDraftGrid(
      activeOutputIndex,
      (currentGrid) => pasteSparseClipboard(currentGrid, clipboard, origin.x, origin.y),
      "Pasted selection.",
      true
    );
  }

  function clearActiveSelectionOrGrid() {
    if (!selection) {
      clearDraft(activeOutputIndex);
      return;
    }
    updateDraftGrid(
      activeOutputIndex,
      (grid) => clearGridSelection(grid, selection),
      "Selection cleared.",
      true
    );
  }

  function deselectSelection() {
    if (!selection) {
      setStatus("No selection to clear.");
      return;
    }
    setSelection(null);
    setStatus("Selection cleared.");
  }

  function moveSelection(dx: number, dy: number) {
    if (!selection) {
      setStatus("Select cells before moving.");
      return;
    }
    const grid = drafts[activeOutputIndex];
    if (!grid) {
      return;
    }
    const result = moveGridSelection(grid, selection, dx, dy);
    setSelection(result.selection);
    commitCurrentDraft(
      (currentDrafts) => currentDrafts.map((draft, index) => (index === activeOutputIndex ? result.grid : draft)),
      "Selection moved.",
      true
    );
  }

  function rotateActive(direction: "clockwise" | "counterclockwise") {
    if (selection) {
      const grid = drafts[activeOutputIndex];
      if (!grid) {
        return;
      }
      const result = rotateGridSelection(grid, selection, direction);
      setSelection(result.selection);
      commitCurrentDraft(
        (currentDrafts) => currentDrafts.map((draft, index) => (index === activeOutputIndex ? result.grid : draft)),
        direction === "clockwise" ? "Selection rotated right." : "Selection rotated left.",
        true
      );
      return;
    }
    updateDraftGrid(
      activeOutputIndex,
      (grid) => rotateGrid(grid, direction),
      direction === "clockwise" ? "Grid rotated right." : "Grid rotated left."
    );
  }

  function flipActive(axis: "horizontal" | "vertical") {
    if (selection) {
      const grid = drafts[activeOutputIndex];
      if (!grid) {
        return;
      }
      const result = flipGridSelection(grid, selection, axis);
      setSelection(result.selection);
      commitCurrentDraft(
        (currentDrafts) => currentDrafts.map((draft, index) => (index === activeOutputIndex ? result.grid : draft)),
        axis === "horizontal" ? "Selection flipped horizontally." : "Selection flipped vertically.",
        true
      );
      return;
    }
    updateDraftGrid(
      activeOutputIndex,
      (grid) => flipGrid(grid, axis),
      axis === "horizontal" ? "Grid flipped horizontally." : "Grid flipped vertically."
    );
  }

  function undo() {
    if (pastDrafts.length === 0) {
      return;
    }
    const previous = pastDrafts[pastDrafts.length - 1];
    setPastDrafts((items) => items.slice(0, -1));
    setFutureDrafts((items) => [drafts.map(cloneGrid), ...items]);
    replaceCurrentDrafts(previous, "Undone.");
  }

  function redo() {
    if (futureDrafts.length === 0) {
      return;
    }
    const next = futureDrafts[0];
    setFutureDrafts((items) => items.slice(1));
    setPastDrafts((items) => [...items, drafts.map(cloneGrid)].slice(-HISTORY_LIMIT));
    replaceCurrentDrafts(next, "Redone.");
  }

  function handleCellPointerDown(outputIndex: number, x: number, y: number, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (frozen) {
      return;
    }

    const previousSelection = outputIndex === activeOutputIndex ? selection : null;
    selectOutput(outputIndex);
    isPointerDownRef.current = true;
    selectionBeforePointerDownRef.current = null;
    if (tool === "select") {
      selectionBeforePointerDownRef.current = previousSelection;
      selectionStartRef.current = { outputIndex, x, y };
      selectionDraggedRef.current = false;
      setSelection({ startX: x, startY: y, endX: x, endY: y });
      return;
    }

    if (tool === "fill") {
      updateDraftGrid(outputIndex, (grid) => floodFillGrid(grid, x, y, selectedColor), "Filled region.");
      return;
    }

    lastPaintedRef.current = `${outputIndex}:${x},${y}`;
    updateDraftGrid(outputIndex, (grid) => setGridCell(grid, x, y, selectedColor), "Painted cell.", true);
  }

  function handleCellPointerEnter(outputIndex: number, x: number, y: number) {
    if (!isPointerDownRef.current || frozen) {
      return;
    }

    if (tool === "select") {
      const start = selectionStartRef.current;
      if (!start || start.outputIndex !== outputIndex) {
        return;
      }
      if (start.x !== x || start.y !== y) {
        selectionDraggedRef.current = true;
      }
      setSelection({ startX: start.x, startY: start.y, endX: x, endY: y });
      return;
    }

    if (tool !== "paint") {
      return;
    }

    const key = `${outputIndex}:${x},${y}`;
    if (lastPaintedRef.current === key) {
      return;
    }
    lastPaintedRef.current = key;
    updateDraftGrid(outputIndex, (grid) => setGridCell(grid, x, y, selectedColor), "Painted cell.", true);
  }

  async function submitCurrentAnswer() {
    if (!currentQuestion?.task || !currentRecord || !canSubmit) {
      return;
    }

    setStatus("Submitting answer...");
    try {
      const expectedOutputs = currentQuestion.task.test.map((pair) => pair.output).filter((grid): grid is ArcGrid => Boolean(grid));
      const updated = await recordBenchmarkSubmission({
        record: currentRecord,
        expectedOutputs,
        submittedOutputs: drafts.map(cloneGrid)
      });
      setRecords((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setStatus(updated.status === "correct" ? "Correct." : "Incorrect.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Answer could not be submitted.");
    }
  }

  async function advanceCurrentQuestion() {
    if (!run || !currentRecord) {
      return;
    }
    setStatus("Loading next question...");
    try {
      const next = await finishBenchmarkQuestion({
        bundle: { run, records },
        record: currentRecord,
        continueRun: true
      });
      applyBundle(next, next.run.status === "completed" ? "complete" : "question");
      setStatus(next.run.status === "completed" ? "Benchmark complete." : `${next.run.current_question_id} ready.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not continue benchmark.");
    }
  }

  async function endBenchmark() {
    if (!run || !currentRecord) {
      window.location.href = appPath("/profile.html");
      return;
    }
    setStatus("Saving progress...");
    try {
      await finishBenchmarkQuestion({
        bundle: { run, records },
        record: currentRecord,
        continueRun: false
      });
      window.location.href = appPath("/profile.html");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not pause benchmark.");
    }
  }

  async function exportJson() {
    if (!run) {
      return;
    }
    const submissions = await loadRunSubmissions(run.id);
    downloadFile(
      `grit3-human-benchmark-${run.id}.json`,
      serializeHumanBenchmarkJson({ run, records, submissions }),
      "application/json"
    );
    setStatus("Exported JSON.");
  }

  async function exportCsv() {
    if (!run) {
      return;
    }
    const submissions = await loadRunSubmissions(run.id);
    downloadFile(
      `grit3-human-benchmark-${run.id}.csv`,
      serializeHumanBenchmarkCsv({ run, records, submissions }),
      "text/csv;charset=utf-8"
    );
    setStatus("Exported CSV.");
  }

  return (
    <main className="app-shell">
      <AppHeader
        title="Human Benchmark"
        account={account}
        onSignOut={onSignOut}
        searchId="human-profile-search"
        actions={
          run
            ? [
                { label: "Export CSV", onClick: () => void exportCsv() },
                { label: "Export JSON", onClick: () => void exportJson() }
              ]
            : []
        }
      />

      {loading ? (
        <section className="panel human-empty-panel">
          <div className="empty-state">Loading benchmark progress...</div>
        </section>
      ) : mode === "intro" ? (
        <StartPanel run={run} records={records} summary={summary} onStart={run ? resumeRun : startNewRun} />
      ) : mode === "complete" && run ? (
        <CompletePanel run={run} records={records} summary={summary} onExportJson={exportJson} onExportCsv={exportCsv} onStartNew={startNewRun} />
      ) : currentQuestion && currentRecord && run && summary ? (
        <div className="human-workspace">
          <HumanProgressPanel run={run} record={currentRecord} records={records} summary={summary} now={nowTick} />

          <section className="human-question-grid">
            <QuestionPanel question={currentQuestion} />
            <AnswerPanel
              activeOutputIndex={activeOutputIndex}
              canSubmit={canSubmit}
              color={selectedColor}
              clipboard={clipboard}
              canRedo={futureDrafts.length > 0}
              drafts={drafts}
              frozen={frozen}
              canUndo={pastDrafts.length > 0}
              onCellPointerDown={handleCellPointerDown}
              onCellPointerEnter={handleCellPointerEnter}
              onClear={clearDraft}
              onClearSelection={clearActiveSelectionOrGrid}
              onCopySelection={copySelectedRegion}
              onCopyInput={copyTestInput}
              onDeselectSelection={deselectSelection}
              onEnd={endBenchmark}
              onFlip={flipActive}
              onMove={moveSelection}
              onPasteSelection={pasteAtSelection}
              onRedo={redo}
              onResize={resizeDraft}
              onRotate={rotateActive}
              onSelectColor={setSelectedColor}
              onSelectOutput={selectOutput}
              onSelectTool={setTool}
              onSubmit={submitCurrentAnswer}
              onAdvance={advanceCurrentQuestion}
              onTryAgain={() => setStatus("Ready for another attempt.")}
              onUndo={undo}
              record={currentRecord}
              selection={selection}
              status={statusForRecord(currentRecord, status)}
              tool={tool}
            />
          </section>
        </div>
      ) : (
        <section className="panel human-empty-panel">
          <div className="empty-state">Question data could not be loaded.</div>
        </section>
      )}

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}

function StartPanel({
  run,
  records,
  summary,
  onStart
}: {
  run: BenchmarkRunBundle["run"] | null;
  records: BenchmarkQuestionRecordRow[];
  summary: ReturnType<typeof summarizeHumanSession> | null;
  onStart: () => void;
}) {
  const hasProgress = records.some((record) => record.completed_at);
  return (
    <section className="human-start">
      <div className="panel human-start-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Directions</p>
            <h2>{run ? "Resume benchmark" : "Start benchmark"}</h2>
          </div>
          <span className="panel-meta">q3-q27</span>
        </div>

        <div className="human-start-body">
          <div className="summary-metrics human-start-metrics">
            <Metric label="Questions" value={String(QUESTION_IDS.length)} />
            <Metric label="Order" value="Random unseen" />
            <Metric label="Storage" value="Supabase" />
            <Metric label="Completed" value={summary ? `${summary.completedQuestions}/${summary.totalQuestions}` : "0/25"} />
          </div>
          <div className="human-directions">
            <p>You will receive one random benchmark question that you have not completed in this run.</p>
            <p>If you leave before finishing a question, your draft is saved and that question resumes next time.</p>
            <p>After submitting, you can try again, move on to another random unseen question, or end and continue later.</p>
          </div>
          <div className="human-start-actions">
            <a className="button secondary" href={appPath("/profile.html")}>
              View Profile
            </a>
            <button className="button primary" type="button" onClick={onStart}>
              {run || hasProgress ? "Resume Benchmark" : "Start Benchmark"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HumanProgressPanel({
  run,
  record,
  records,
  summary,
  now
}: {
  run: BenchmarkRunBundle["run"];
  record: BenchmarkQuestionRecordRow;
  records: BenchmarkQuestionRecordRow[];
  summary: ReturnType<typeof summarizeHumanSession>;
  now: number;
}) {
  const questionStartedAt = record.started_at ? Date.parse(record.started_at) : now;
  const questionElapsed = record.elapsed_ms ?? Math.max(0, now - questionStartedAt);
  const remaining = records.filter((item) => item.completed_at === null && item.id !== record.id).length;

  return (
    <section className="panel human-progress-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>{record.question_id}</h2>
        </div>
        <span className="human-weight-pill">Weight {record.weight}</span>
      </div>
      <div className="summary-metrics human-run-metrics">
        <Metric label="Run status" value={run.status} />
        <Metric label="Question time" value={formatDuration(questionElapsed)} />
        <Metric label="Submissions" value={String(record.submission_count)} />
        <Metric label="Completed" value={`${summary.completedQuestions}/${summary.totalQuestions}`} />
        <Metric label="Remaining" value={String(remaining)} />
      </div>
    </section>
  );
}

function QuestionPanel({ question }: { question: LoadedQuestion }) {
  return (
    <section className="panel human-question-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Question</p>
          <h2>{question.question_id}</h2>
        </div>
      </div>

      {question.load_error || !question.task ? (
        <div className="empty-state">{question.load_error ?? "Question data is unavailable."}</div>
      ) : (
        <div className="question-content human-question-content">
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
            <h3>Test</h3>
            {question.task.test.map((pair, index) => (
              <div className="human-test-row" key={`test-${index}`}>
                <GridPanel title={`Test ${index + 1} input`} grid={pair.input} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AnswerPanel({
  activeOutputIndex,
  canSubmit,
  color,
  clipboard,
  canRedo,
  canUndo,
  drafts,
  frozen,
  onCellPointerDown,
  onCellPointerEnter,
  onClear,
  onClearSelection,
  onCopySelection,
  onCopyInput,
  onDeselectSelection,
  onEnd,
  onFlip,
  onMove,
  onPasteSelection,
  onRedo,
  onResize,
  onRotate,
  onSelectColor,
  onSelectOutput,
  onSelectTool,
  onSubmit,
  onAdvance,
  onTryAgain,
  onUndo,
  record,
  selection,
  status,
  tool
}: {
  activeOutputIndex: number;
  canSubmit: boolean;
  color: number;
  clipboard: SparseGridClipboard | null;
  canRedo: boolean;
  canUndo: boolean;
  drafts: ArcGrid[];
  frozen: boolean;
  onCellPointerDown: (outputIndex: number, x: number, y: number, event: PointerEvent<HTMLButtonElement>) => void;
  onCellPointerEnter: (outputIndex: number, x: number, y: number) => void;
  onClear: (outputIndex: number) => void;
  onClearSelection: () => void;
  onCopySelection: () => void;
  onCopyInput: (outputIndex: number) => void;
  onDeselectSelection: () => void;
  onEnd: () => void;
  onFlip: (axis: "horizontal" | "vertical") => void;
  onMove: (dx: number, dy: number) => void;
  onPasteSelection: () => void;
  onRedo: () => void;
  onResize: (outputIndex: number, width: number, height: number) => void;
  onRotate: (direction: "clockwise" | "counterclockwise") => void;
  onSelectColor: (color: number) => void;
  onSelectOutput: (outputIndex: number) => void;
  onSelectTool: (tool: HumanTool) => void;
  onSubmit: () => void;
  onAdvance: () => void;
  onTryAgain: () => void;
  onUndo: () => void;
  record: BenchmarkQuestionRecordRow;
  selection: AdvancedGridSelection | null;
  status: string;
  tool: HumanTool;
}) {
  const canAdvance = record.status === "correct" || record.status === "wrong";
  const correct = record.status === "correct";
  const wrong = record.status === "wrong";
  const activeGrid = drafts[activeOutputIndex];
  const normalizedSelection = activeGrid ? normalizeGridSelection(selection, activeGrid) : null;
  const hasSelection = Boolean(normalizedSelection);

  return (
    <section className="panel human-answer-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Answer</p>
          <h2>Output</h2>
        </div>
        <span className={correct ? "status-badge correct" : wrong ? "status-badge wrong" : "panel-meta"}>
          {correct || wrong ? status : "Unsubmitted"}
        </span>
      </div>

      <div className="creator-toolbar human-answer-toolbar">
        <div className="tool-group color-palette" aria-label="Color palette">
          {COLORS.map((item) => (
            <button
              className={color === item ? "color-button selected" : "color-button"}
              type="button"
              key={item}
              title={`${ARC_COLOR_MAP[item].name} (${item})`}
              onClick={() => onSelectColor(item)}
              style={{ backgroundColor: ARC_COLOR_MAP[item].color, color: ARC_COLOR_MAP[item].text }}
              disabled={frozen}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="tool-group" aria-label="Tools">
          <button className={tool === "paint" ? "tool-button selected" : "tool-button"} type="button" onClick={() => onSelectTool("paint")} disabled={frozen}>
            Paint
          </button>
          <button className={tool === "fill" ? "tool-button selected" : "tool-button"} type="button" onClick={() => onSelectTool("fill")} disabled={frozen}>
            Fill
          </button>
          <button className={tool === "select" ? "tool-button selected" : "tool-button"} type="button" onClick={() => onSelectTool("select")} disabled={frozen}>
            Select
          </button>
        </div>

        <div className="tool-group" aria-label="Selection actions">
          <button className="button secondary compact-button" type="button" onClick={onCopySelection} disabled={frozen || !hasSelection}>
            Copy
          </button>
          <button className="button secondary compact-button" type="button" onClick={onPasteSelection} disabled={frozen || !clipboard}>
            Paste
          </button>
          <button className="button secondary compact-button" type="button" onClick={onDeselectSelection} disabled={frozen || !hasSelection}>
            Deselect
          </button>
          <button className="button secondary compact-button" type="button" onClick={onClearSelection} disabled={frozen}>
            Clear
          </button>
        </div>

        <div className="tool-group" aria-label="Transforms">
          <button className="button secondary compact-button" type="button" onClick={() => onRotate("counterclockwise")} disabled={frozen}>
            Rotate L
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onRotate("clockwise")} disabled={frozen}>
            Rotate R
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onFlip("horizontal")} disabled={frozen}>
            Flip H
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onFlip("vertical")} disabled={frozen}>
            Flip V
          </button>
        </div>

        <div className="tool-group shift-pad" aria-label="Move selection">
          <button className="button secondary compact-button" type="button" onClick={() => onMove(0, -1)} disabled={frozen || !hasSelection}>
            Up
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onMove(-1, 0)} disabled={frozen || !hasSelection}>
            Left
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onMove(1, 0)} disabled={frozen || !hasSelection}>
            Right
          </button>
          <button className="button secondary compact-button" type="button" onClick={() => onMove(0, 1)} disabled={frozen || !hasSelection}>
            Down
          </button>
        </div>

        <div className="tool-group" aria-label="History">
          <button className="button secondary compact-button" type="button" onClick={onUndo} disabled={frozen || !canUndo}>
            Undo
          </button>
          <button className="button secondary compact-button" type="button" onClick={onRedo} disabled={frozen || !canRedo}>
            Redo
          </button>
        </div>

        {drafts.length > 1 ? (
          <div className="tool-group" aria-label="Output selection">
            {drafts.map((_, index) => (
              <button
                className={activeOutputIndex === index ? "tool-button selected" : "tool-button"}
                type="button"
                key={`output-tab-${index}`}
                onClick={() => onSelectOutput(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="human-output-list">
        {drafts.map((grid, index) => (
          <EditableHumanOutput
            active={activeOutputIndex === index}
            disabled={frozen}
            grid={grid}
            index={index}
            key={`answer-${index}`}
            onActivate={() => onSelectOutput(index)}
            onCellPointerDown={onCellPointerDown}
            onCellPointerEnter={onCellPointerEnter}
            onClear={onClear}
            onCopyInput={onCopyInput}
            onResize={onResize}
            selection={activeOutputIndex === index ? selection : null}
          />
        ))}
      </div>

      <div className="human-submit-row">
        <div className="human-submit-status">
          <strong>{status}</strong>
        </div>
        <div className="nav-actions">
          {wrong ? (
            <button className="button secondary" type="button" onClick={onTryAgain}>
              Try Again
            </button>
          ) : null}
          <button className="button primary" type="button" onClick={onSubmit} disabled={!canSubmit}>
            Submit Answer
          </button>
          <button className="button secondary" type="button" onClick={onAdvance} disabled={!canAdvance}>
            {correct ? "Continue" : "Move On"}
          </button>
          <button className="button secondary" type="button" onClick={onEnd} disabled={!canAdvance}>
            End Benchmark
          </button>
        </div>
      </div>
    </section>
  );
}

function EditableHumanOutput({
  active,
  disabled,
  grid,
  index,
  onActivate,
  onCellPointerDown,
  onCellPointerEnter,
  onClear,
  onCopyInput,
  onResize,
  selection
}: {
  active: boolean;
  disabled: boolean;
  grid: ArcGrid;
  index: number;
  onActivate: () => void;
  onCellPointerDown: (outputIndex: number, x: number, y: number, event: PointerEvent<HTMLButtonElement>) => void;
  onCellPointerEnter: (outputIndex: number, x: number, y: number) => void;
  onClear: (outputIndex: number) => void;
  onCopyInput: (outputIndex: number) => void;
  onResize: (outputIndex: number, width: number, height: number) => void;
  selection: AdvancedGridSelection | null;
}) {
  const dimensions = gridDimensions(grid);
  const normalizedSelection = normalizeGridSelection(selection, grid);
  const style = {
    gridTemplateColumns: `repeat(${dimensions.width}, var(--cell-size))`,
    gridTemplateRows: `repeat(${dimensions.height}, var(--cell-size))`,
    "--cell-size": getHumanCellSize(dimensions.width, dimensions.height)
  } as CSSProperties;

  return (
    <section className={active ? "grid-panel editable-grid-panel active" : "grid-panel editable-grid-panel"} onPointerDown={onActivate}>
      <div className="grid-panel-header human-output-header">
        <strong>Output {index + 1}</strong>
        <span>
          {dimensions.width} x {dimensions.height}
        </span>
      </div>
      <div className="creator-size-row human-output-controls">
        <label className="compact-field">
          <span>Width</span>
          <input
            min={1}
            max={60}
            type="number"
            value={dimensions.width}
            onChange={(event) => onResize(index, Number(event.target.value), dimensions.height)}
            disabled={disabled}
          />
        </label>
        <label className="compact-field">
          <span>Height</span>
          <input
            min={1}
            max={60}
            type="number"
            value={dimensions.height}
            onChange={(event) => onResize(index, dimensions.width, Number(event.target.value))}
            disabled={disabled}
          />
        </label>
        <button className="button secondary compact-button" type="button" onClick={() => onCopyInput(index)} disabled={disabled}>
          Copy Test Input
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => onClear(index)} disabled={disabled}>
          Clear
        </button>
      </div>
      <div className="grid-scroll">
        <div className={disabled ? "editable-arc-grid disabled" : "editable-arc-grid"} style={style}>
          {grid.flatMap((row, y) =>
            row.map((cell, x) => {
              const mapped = ARC_COLOR_MAP[cell] ?? ARC_COLOR_MAP[0];
              const selected = isSelectedCell(normalizedSelection, x, y);
              const dimmed = Boolean(normalizedSelection && !selected);
              return (
                <button
                  className={["editable-cell", selected ? "selected" : "", dimmed ? "dimmed" : ""].filter(Boolean).join(" ")}
                  key={`${x}-${y}`}
                  type="button"
                  title={`${x + 1}, ${y + 1}: ${mapped.name} (${cell})`}
                  style={{ backgroundColor: mapped.color, color: mapped.text }}
                  onPointerDown={(event) => onCellPointerDown(index, x, y, event)}
                  onPointerEnter={() => onCellPointerEnter(index, x, y)}
                  disabled={disabled}
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function isSelectedCell(selection: ReturnType<typeof normalizeGridSelection>, x: number, y: number): boolean {
  return Boolean(selection?.cells.some((cell) => cell.x === x && cell.y === y));
}

function CompletePanel({
  run,
  records,
  summary,
  onExportJson,
  onExportCsv,
  onStartNew
}: {
  run: BenchmarkRunBundle["run"];
  records: BenchmarkQuestionRecordRow[];
  summary: ReturnType<typeof summarizeHumanSession> | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  onStartNew: () => void;
}) {
  const safeSummary = summary ?? summarizeHumanSession(records, run.started_at, run.completed_at);

  return (
    <section className="human-complete">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Complete</p>
            <h2>Benchmark run</h2>
          </div>
          <span className="panel-meta">{run.id}</span>
        </div>
        <div className="summary-metrics human-complete-metrics">
          <Metric label="Total time" value={formatDuration(safeSummary.totalElapsedMs)} />
          <Metric label="Correct" value={`${safeSummary.correctQuestions}/${safeSummary.totalQuestions}`} />
          <Metric label="Weighted" value={`${safeSummary.correctWeight}/${safeSummary.totalWeight}`} />
          <Metric label="Submissions" value={String(safeSummary.totalSubmissions)} />
        </div>
        <div className="human-complete-actions">
          <button className="button secondary" type="button" onClick={onExportCsv}>
            Export CSV
          </button>
          <button className="button secondary" type="button" onClick={onExportJson}>
            Export JSON
          </button>
          <button className="button primary" type="button" onClick={onStartNew}>
            New Run
          </button>
        </div>
        <div className="summary-table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Weight</th>
                <th>Status</th>
                <th>Submissions</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.question_id}</td>
                  <td>{record.weight}</td>
                  <td>{record.final_correct === true ? "correct" : record.final_correct === false ? "wrong" : record.status}</td>
                  <td>{record.submission_count}</td>
                  <td>{formatDuration(record.elapsed_ms ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
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

function statusForRecord(record: BenchmarkQuestionRecordRow, fallback: string): string {
  if (record.status === "correct") {
    return "Correct.";
  }
  if (record.status === "wrong") {
    return "Incorrect.";
  }
  return fallback;
}

function questionById(questionId: QuestionId): LoadedQuestion | null {
  return QUESTIONS.find((question) => question.question_id === questionId) ?? null;
}

function sanitizeRecordDrafts(record: BenchmarkQuestionRecordRow, question: LoadedQuestion | null): ArcGrid[] {
  const fallback = createBlankOutputDrafts(question);
  const candidate = record.draft_outputs;
  if (!Array.isArray(candidate)) {
    return fallback;
  }
  const validDrafts = candidate.filter((grid): grid is ArcGrid => validateGrid(grid, "draft").length === 0).map(cloneGrid);
  return validDrafts.length === fallback.length ? validDrafts : fallback;
}

function createBlankOutputDrafts(question: LoadedQuestion | null): ArcGrid[] {
  if (!question?.task) {
    return [createGrid(1, 1, 0)];
  }
  return question.task.test.map((pair) => createGrid(pair.input[0]?.length ?? 1, pair.input.length, 0));
}

function cloneGrid(grid: ArcGrid): ArcGrid {
  return grid.map((row) => [...row]);
}

function getHumanCellSize(width: number, height: number): string {
  const largest = Math.max(width, height);
  if (largest > 50) {
    return "10px";
  }
  if (largest > 35) {
    return "12px";
  }
  if (largest > 25) {
    return "15px";
  }
  return "22px";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`;
  }
  return `${minutes}:${padTime(seconds)}`;
}

function padTime(value: number): string {
  return value.toString().padStart(2, "0");
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
