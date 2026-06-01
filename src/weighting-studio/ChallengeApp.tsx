import { type ChangeEvent, type PointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { AuthGate, type AppAccount } from "./account";
import {
  type DuelChallengeDetail,
  getDuelChallenge,
  recordDuelSubmission,
  respondDuelChallenge,
  saveDuelDraft,
  setDuelAttemptMode,
  uploadDuelTask
} from "./challengeStore";
import {
  clearGridSelection,
  copyGridSelection,
  createGrid,
  flipGrid,
  flipGridSelection,
  floodFillGrid,
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
import {
  canEditAttemptMode,
  createDuelSubmissionOutcome,
  expectedOutputsForDuelTask,
  parseDuelTaskJson
} from "./duelSession";
import { SolveAnswerPanel, SolveQuestionPanel, type HumanTool, type SolveOutcome } from "./HumanSolvePanels";
import { gradeOutputs } from "./resultsValidationCore.js";
import { appPath } from "./routes";
import type { ArcGrid, ArcTask } from "./types";

const HISTORY_LIMIT = 80;

export function ChallengeApp() {
  return (
    <AuthGate title="Sign in to challenge">
      {(account, controls) => <ChallengeWorkspace account={account} onSignOut={controls.signOut} />}
    </AuthGate>
  );
}

function ChallengeWorkspace({ account, onSignOut }: { account: AppAccount; onSignOut: () => Promise<void> }) {
  const challengeId = getRequestedChallengeId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftKeyRef = useRef("");
  const isPointerDownRef = useRef(false);
  const lastPaintedRef = useRef<string | null>(null);
  const selectionStartRef = useRef<{ outputIndex: number; x: number; y: number } | null>(null);
  const selectionDraggedRef = useRef(false);
  const selectionBeforePointerDownRef = useRef<AdvancedGridSelection | null>(null);

  const [detail, setDetail] = useState<DuelChallengeDetail | null>(null);
  const [drafts, setDrafts] = useState<ArcGrid[]>([]);
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(challengeId ? "Loading challenge..." : "Challenge link is missing.");
  const [nowTick, setNowTick] = useState(Date.now());
  const [selectedColor, setSelectedColor] = useState(1);
  const [tool, setTool] = useState<HumanTool>("paint");
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [selection, setSelection] = useState<AdvancedGridSelection | null>(null);
  const [clipboard, setClipboard] = useState<SparseGridClipboard | null>(null);
  const [pastDrafts, setPastDrafts] = useState<ArcGrid[][]>([]);
  const [futureDrafts, setFutureDrafts] = useState<ArcGrid[][]>([]);
  const [lastOutcome, setLastOutcome] = useState<SolveOutcome>("idle");

  const parsedTask = useMemo(() => parseDuelTaskJson(jsonText), [jsonText]);
  const opponentTask = detail?.opponent_task ?? null;
  const frozen = Boolean(detail?.status !== "active" || detail.viewer_state_status !== "solving" || detail.completed_at);
  const canSubmit = Boolean(
    detail?.status === "active" &&
      opponentTask &&
      detail.viewer_state_status === "solving" &&
      drafts.length === expectedOutputsForDuelTask(opponentTask).length
  );
  const challengeElapsed = detail?.started_at ? Math.max(0, nowTick - Date.parse(detail.started_at)) : 0;
  const viewerElapsed =
    detail?.viewer_elapsed_ms ??
    (detail?.viewer_started_at ? Math.max(0, nowTick - Date.parse(detail.viewer_started_at)) : challengeElapsed);

  const refresh = useCallback(
    async (showLoading = false) => {
      if (!challengeId) {
        setLoading(false);
        return;
      }
      if (showLoading) {
        setLoading(true);
      }
      try {
        const nextDetail = await getDuelChallenge(challengeId);
        setDetail(nextDetail);
        setStatus((current) =>
          nextDetail
            ? nextDetail.status === "active" && (current.startsWith("Incorrect") || current.startsWith("Correct"))
              ? current
              : statusForChallenge(nextDetail, account.user.id)
            : "Challenge not found."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Challenge could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [account.user.id, challengeId]
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!challengeId) {
      return;
    }
    const interval = window.setInterval(() => void refresh(false), 3000);
    return () => window.clearInterval(interval);
  }, [challengeId, refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!detail?.opponent_task || detail.status !== "active") {
      return;
    }

    const nextKey = `${detail.id}:${detail.status}:${detail.opponent_task.test.length}`;
    if (draftKeyRef.current === nextKey) {
      return;
    }

    draftKeyRef.current = nextKey;
    setDrafts(sanitizeDuelDrafts(detail.viewer_draft_outputs, detail.opponent_task));
    resetEditorState();
    setLastOutcome("idle");
  }, [detail?.id, detail?.opponent_task, detail?.status, detail?.viewer_draft_outputs]);

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

  function resetEditorState() {
    setActiveOutputIndex(0);
    setSelection(null);
    setClipboard(null);
    setPastDrafts([]);
    setFutureDrafts([]);
  }

  async function acceptChallenge() {
    if (!detail) {
      return;
    }
    setStatus("Accepting challenge...");
    try {
      await respondDuelChallenge(detail.id, true);
      await refresh(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Challenge could not be accepted.");
    }
  }

  async function declineChallenge() {
    if (!detail) {
      return;
    }
    setStatus("Declining challenge...");
    try {
      await respondDuelChallenge(detail.id, false);
      await refresh(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Challenge could not be declined.");
    }
  }

  async function changeAttemptMode(nextMode: "one" | "unlimited") {
    if (!detail || detail.attempt_mode === nextMode) {
      return;
    }
    setStatus("Updating attempts...");
    try {
      await setDuelAttemptMode(detail.id, nextMode);
      await refresh(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attempt mode could not be updated.");
    }
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      setJsonText(await file.text());
      setStatus(`Loaded ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "JSON file could not be read.");
    }
  }

  async function submitTask() {
    if (!detail) {
      return;
    }
    const parsed = parseDuelTaskJson(jsonText);
    if (!parsed.task) {
      setStatus(parsed.error ?? "Task JSON is invalid.");
      return;
    }
    setStatus("Uploading task...");
    try {
      await uploadDuelTask(detail.id, parsed.task);
      setJsonText("");
      await refresh(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Task could not be uploaded.");
    }
  }

  function commitCurrentDraft(updater: (drafts: ArcGrid[]) => ArcGrid[], message: string, keepSelection = false) {
    if (!detail || frozen) {
      return;
    }

    const previousDrafts = drafts.map(cloneGrid);
    const nextDrafts = updater(drafts).map(cloneGrid);
    setPastDrafts((items) => [...items, previousDrafts].slice(-HISTORY_LIMIT));
    setFutureDrafts([]);
    setDrafts(nextDrafts);
    void saveDuelDraft(detail.id, nextDrafts).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Draft could not be saved.");
    });
    if (!keepSelection) {
      setSelection(null);
    }
    setStatus(message);
  }

  function replaceCurrentDrafts(nextDrafts: ArcGrid[], message: string) {
    if (!detail) {
      return;
    }
    const cloned = nextDrafts.map(cloneGrid);
    setDrafts(cloned);
    void saveDuelDraft(detail.id, cloned).catch((error) => {
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
    const input = opponentTask?.test[outputIndex]?.input;
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
    if (!detail || !opponentTask || !canSubmit) {
      return;
    }

    setStatus("Submitting answer...");
    try {
      const expectedOutputs = expectedOutputsForDuelTask(opponentTask);
      const grade = gradeOutputs(expectedOutputs, drafts.map(cloneGrid));
      const outcome = createDuelSubmissionOutcome({
        attemptMode: detail.attempt_mode,
        correct: grade.exact,
        opponentUserId: detail.opponent_id,
        viewerUserId: account.user.id
      });
      await recordDuelSubmission({
        challengeId: detail.id,
        correct: grade.exact,
        submittedOutputs: drafts.map(cloneGrid)
      });
      setLastOutcome(grade.exact ? "correct" : "wrong");
      setStatus(
        outcome.complete
          ? outcome.winnerId === account.user.id
            ? "Correct. You won."
            : "Incorrect. One attempt mode gives the win to your opponent."
          : "Incorrect. Keep trying."
      );
      await refresh(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Answer could not be submitted.");
    }
  }

  return (
    <main className="app-shell">
      <AppHeader
        title="1v1 Challenge"
        account={account}
        onSignOut={onSignOut}
        searchId="challenge-profile-search"
        actions={[{ label: "My Profile", href: appPath("/profile.html") }]}
      />

      {!challengeId ? (
        <section className="panel challenge-empty-panel">
          <div className="empty-state">Open a challenge from a profile to start a match.</div>
        </section>
      ) : loading ? (
        <section className="panel challenge-empty-panel">
          <div className="empty-state">Loading challenge...</div>
        </section>
      ) : !detail ? (
        <section className="panel challenge-empty-panel">
          <div className="empty-state">Challenge not found.</div>
        </section>
      ) : detail.status === "pending" ? (
        <PendingPanel detail={detail} onAccept={acceptChallenge} onDecline={declineChallenge} />
      ) : detail.status === "accepted" ? (
        <WaitingPanel
          canChangeAttempts={canEditAttemptMode({ role: detail.role, status: detail.status })}
          detail={detail}
          fileInputRef={fileInputRef}
          jsonError={jsonText.trim() ? parsedTask.error : null}
          jsonText={jsonText}
          onAttemptModeChange={changeAttemptMode}
          onFileInput={handleFileInput}
          onJsonTextChange={setJsonText}
          onSubmitTask={submitTask}
          parsedTask={parsedTask.task}
        />
      ) : detail.status === "active" && opponentTask ? (
        <div className="human-workspace">
          <ChallengeProgressPanel detail={detail} challengeElapsed={challengeElapsed} viewerElapsed={viewerElapsed} />
          <section className="human-question-grid">
            <SolveQuestionPanel eyebrow="Opponent task" task={opponentTask} title={detail.opponent_username} />
            <SolveAnswerPanel
              activeOutputIndex={activeOutputIndex}
              canRedo={futureDrafts.length > 0}
              canSubmit={canSubmit}
              canUndo={pastDrafts.length > 0}
              clipboard={clipboard}
              color={selectedColor}
              drafts={drafts}
              frozen={frozen}
              onCellPointerDown={handleCellPointerDown}
              onCellPointerEnter={handleCellPointerEnter}
              onClear={clearDraft}
              onClearSelection={clearActiveSelectionOrGrid}
              onCopyInput={copyTestInput}
              onCopySelection={copySelectedRegion}
              onDeselectSelection={deselectSelection}
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
              onTryAgain={() => setStatus("Ready for another attempt.")}
              onUndo={undo}
              outcome={detail.viewer_state_status === "won" ? "correct" : lastOutcome}
              selection={selection}
              showTryAgain={lastOutcome === "wrong" && detail.attempt_mode === "unlimited"}
              status={status}
              submitLabel="Submit Answer"
              tool={tool}
            />
          </section>
        </div>
      ) : (
        <ResultPanel account={account} detail={detail} />
      )}

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}

function PendingPanel({
  detail,
  onAccept,
  onDecline
}: {
  detail: DuelChallengeDetail;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const incoming = detail.role === "challenged";
  return (
    <section className="challenge-center">
      <div className="panel challenge-status-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Pending challenge</p>
            <h2>{incoming ? `${detail.challenger_username} challenged you` : `Waiting for ${detail.challenged_username}`}</h2>
          </div>
          <span className="panel-meta">{detail.attempt_mode === "one" ? "One attempt" : "Unlimited attempts"}</span>
        </div>
        <div className="challenge-copy">
          {incoming
            ? "Accept to enter the waiting room, upload your task JSON, and start once both tasks are ready."
            : "Your opponent needs to accept before either player can upload a task."}
        </div>
        <div className="challenge-actions">
          <a className="button secondary" href={appPath("/profile.html")}>
            My Profile
          </a>
          {incoming ? (
            <>
              <button className="button secondary" type="button" onClick={onDecline}>
                Decline
              </button>
              <button className="button primary" type="button" onClick={onAccept}>
                Accept
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function WaitingPanel({
  canChangeAttempts,
  detail,
  fileInputRef,
  jsonError,
  jsonText,
  onAttemptModeChange,
  onFileInput,
  onJsonTextChange,
  onSubmitTask,
  parsedTask
}: {
  canChangeAttempts: boolean;
  detail: DuelChallengeDetail;
  fileInputRef: RefObject<HTMLInputElement>;
  jsonError: string | null;
  jsonText: string;
  onAttemptModeChange: (mode: "one" | "unlimited") => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onJsonTextChange: (value: string) => void;
  onSubmitTask: () => void;
  parsedTask: ArcTask | null;
}) {
  return (
    <section className="challenge-waiting">
      <div className="panel challenge-status-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Waiting room</p>
            <h2>Upload your task for {detail.opponent_username}</h2>
          </div>
          <span className="panel-meta">{detail.viewer_task_uploaded ? "Your task is ready" : "Upload needed"}</span>
        </div>

        <div className="summary-metrics challenge-metrics">
          <Metric label="Opponent" value={detail.opponent_username} />
          <Metric label="Your task" value={detail.viewer_task_uploaded ? "uploaded" : "missing"} />
          <Metric label="Opponent task" value={detail.opponent_task_uploaded ? "uploaded" : "missing"} />
          <Metric label="Attempts" value={detail.attempt_mode === "one" ? "one attempt" : "unlimited"} />
        </div>

        <div className="challenge-attempt-row">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={detail.attempt_mode === "unlimited"}
              onChange={(event) => onAttemptModeChange(event.target.checked ? "unlimited" : "one")}
              disabled={!canChangeAttempts}
            />
            <span>Unlimited attempts</span>
          </label>
          <span className="muted-line">
            {canChangeAttempts ? "The challenger can change this before the round starts." : "Only the challenger can change attempts."}
          </span>
        </div>

        <div className="challenge-upload-grid">
          <label className="field challenge-json-field">
            <span>Task JSON</span>
            <textarea
              value={jsonText}
              onChange={(event) => onJsonTextChange(event.target.value)}
              rows={12}
              placeholder="Paste ARC-style task JSON with train and test arrays."
            />
          </label>
          <div className="challenge-upload-side">
            <div className={jsonError ? "warning-line" : parsedTask ? "success-line" : "muted-line"}>
              {jsonError ??
                (parsedTask
                  ? `Valid task: ${parsedTask.train.length} train, ${parsedTask.test.length} test.`
                  : "Choose the JSON file you downloaded or paste it here.")}
            </div>
            <div className="challenge-actions compact">
              <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
                Choose JSON
              </button>
              <button className="button primary" type="button" onClick={onSubmitTask} disabled={!parsedTask}>
                {detail.viewer_task_uploaded ? "Replace Task" : "Upload Task"}
              </button>
            </div>
            <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={onFileInput} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ChallengeProgressPanel({
  challengeElapsed,
  detail,
  viewerElapsed
}: {
  challengeElapsed: number;
  detail: DuelChallengeDetail;
  viewerElapsed: number;
}) {
  return (
    <section className="panel human-progress-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">1v1</p>
          <h2>{detail.opponent_username}</h2>
        </div>
        <span className="human-weight-pill">{detail.attempt_mode === "one" ? "One attempt" : "Unlimited"}</span>
      </div>
      <div className="summary-metrics human-run-metrics">
        <Metric label="Round" value={formatDuration(challengeElapsed)} />
        <Metric label="Your time" value={formatDuration(viewerElapsed)} />
        <Metric label="Your attempts" value={String(detail.viewer_submission_count)} />
        <Metric label="Opponent attempts" value={String(detail.opponent_submission_count)} />
        <Metric label="Status" value={detail.viewer_state_status ?? detail.status} />
      </div>
    </section>
  );
}

function ResultPanel({ account, detail }: { account: AppAccount; detail: DuelChallengeDetail }) {
  const won = detail.winner_id === account.user.id;
  return (
    <section className="challenge-center">
      <div className="panel challenge-status-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{detail.status === "completed" ? "Complete" : "Challenge"}</p>
            <h2>{resultTitle(detail, account.user.id)}</h2>
          </div>
          <span className={detail.status === "completed" ? (won ? "status-badge correct" : "status-badge wrong") : "panel-meta"}>
            {detail.status}
          </span>
        </div>
        <div className="summary-metrics challenge-metrics">
          <Metric label="Opponent" value={detail.opponent_username} />
          <Metric label="Winner" value={detail.winner_username ?? "none"} />
          <Metric label="Reason" value={formatWinReason(detail.win_reason)} />
          <Metric label="Attempts" value={detail.attempt_mode === "one" ? "one attempt" : "unlimited"} />
        </div>
        <div className="challenge-actions">
          <a className="button secondary" href={appPath("/profile.html")}>
            My Profile
          </a>
          <a className="button primary" href={appPath(`/profile.html?u=${encodeURIComponent(detail.opponent_username)}`)}>
            View Opponent
          </a>
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

function sanitizeDuelDrafts(candidate: ArcGrid[] | null, task: ArcTask): ArcGrid[] {
  const fallback = createBlankOutputDrafts(task);
  if (!Array.isArray(candidate)) {
    return fallback;
  }
  const validDrafts = candidate.filter((grid): grid is ArcGrid => validateGrid(grid, "draft").length === 0).map(cloneGrid);
  return validDrafts.length === fallback.length ? validDrafts : fallback;
}

function createBlankOutputDrafts(task: ArcTask): ArcGrid[] {
  return task.test.map((pair) => createGrid(pair.input[0]?.length ?? 1, pair.input.length, 0));
}

function cloneGrid(grid: ArcGrid): ArcGrid {
  return grid.map((row) => [...row]);
}

function statusForChallenge(detail: DuelChallengeDetail, viewerId: string): string {
  if (detail.status === "completed") {
    return detail.winner_id === viewerId ? "You won." : "Challenge complete.";
  }
  if (detail.status === "active") {
    return "Round active.";
  }
  if (detail.status === "accepted") {
    return "Waiting for both players to upload tasks.";
  }
  if (detail.status === "pending") {
    return detail.role === "challenged" ? "Challenge awaiting your response." : "Waiting for opponent to accept.";
  }
  if (detail.status === "declined") {
    return "Challenge declined.";
  }
  return "Challenge cancelled.";
}

function resultTitle(detail: DuelChallengeDetail, viewerId: string): string {
  if (detail.status === "declined") {
    return "Challenge declined";
  }
  if (detail.status === "cancelled") {
    return "Challenge cancelled";
  }
  if (detail.winner_id === viewerId) {
    return "You won";
  }
  if (detail.winner_id) {
    return `${detail.winner_username ?? detail.opponent_username} won`;
  }
  return "Challenge complete";
}

function formatWinReason(reason: string | null): string {
  if (reason === "correct") {
    return "correct answer";
  }
  if (reason === "opponent_wrong") {
    return "wrong first attempt";
  }
  if (reason === "forfeit") {
    return "forfeit";
  }
  if (reason === "cancelled") {
    return "cancelled";
  }
  return "n/a";
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

function getRequestedChallengeId(): string {
  return new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
}
