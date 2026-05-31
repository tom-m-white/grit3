import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { ARC_COLOR_MAP } from "./GridPanel";
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  clearGrid,
  cloneGrid,
  copySelection,
  createGrid,
  floodFillGrid,
  flipGrid,
  gridDimensions,
  normalizeSelection,
  pasteClipboard,
  resizeGrid,
  rotateGrid,
  serializeCreatorTask,
  setGridCell,
  shiftGrid,
  validateArcTask,
  validateGrid,
  type CreatorCase,
  type CreatorCaseKind,
  type CreatorGridKey,
  type EditorTool,
  type GridClipboard,
  type GridSelection
} from "./creatorGrid";
import { appPath } from "./routes";
import type { ArcGrid } from "./types";

const CREATOR_STORAGE_KEY = "grit3.creator.draft.v1";
const EVALUATOR_HANDOFF_KEY = "grit3.creator.evaluatorTask.v1";
const HISTORY_LIMIT = 80;
const COLORS = Object.keys(ARC_COLOR_MAP).map(Number);

interface CreatorDraft {
  trainCases: CreatorCase[];
  testCases: CreatorCase[];
  selectedKind: CreatorCaseKind;
  selectedCaseId: string;
  selectedGridKey: CreatorGridKey;
}

export function CreatorApp() {
  const [draft, setDraft] = useState<CreatorDraft>(() => readStoredDraft());
  const [past, setPast] = useState<CreatorDraft[]>([]);
  const [future, setFuture] = useState<CreatorDraft[]>([]);
  const [selectedColor, setSelectedColor] = useState(1);
  const [tool, setTool] = useState<EditorTool>("paint");
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [clipboard, setClipboard] = useState<GridClipboard | null>(null);
  const [status, setStatus] = useState("Draft autosaved locally.");
  const draftRef = useRef(draft);
  const isPointerDownRef = useRef(false);
  const lastPaintedRef = useRef<string | null>(null);

  const currentCase = getSelectedCase(draft);
  const activeGrid = currentCase[draft.selectedGridKey];
  const activeDimensions = gridDimensions(activeGrid);
  const normalizedSelection = normalizeSelection(selection, activeGrid);
  const task = useMemo(() => serializeCreatorTask(draft.trainCases, draft.testCases), [draft]);
  const validationErrors = useMemo(() => validateArcTask(task), [task]);
  const taskJson = useMemo(() => JSON.stringify(task, null, 2), [task]);

  useEffect(() => {
    draftRef.current = draft;
    window.localStorage.setItem(CREATOR_STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    function handlePointerUp() {
      isPointerDownRef.current = false;
      lastPaintedRef.current = null;
    }

    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  function commitDraft(updater: (current: CreatorDraft) => CreatorDraft, message: string, keepSelection = false) {
    const current = draftRef.current;
    const next = normalizeDraft(updater(current));
    draftRef.current = next;
    setPast((items) => [...items, current].slice(-HISTORY_LIMIT));
    setFuture([]);
    setDraft(next);
    setStatus(message);
    if (!keepSelection) {
      setSelection(null);
    }
  }

  function updateSelectedCase(updater: (current: CreatorCase) => CreatorCase, message: string, keepSelection = false) {
    commitDraft(
      (current) => {
        const listKey = current.selectedKind === "train" ? "trainCases" : "testCases";
        return {
          ...current,
          [listKey]: current[listKey].map((item) => (item.id === current.selectedCaseId ? updater(item) : item))
        };
      },
      message,
      keepSelection
    );
  }

  function updateSelectedGrid(updater: (grid: ArcGrid) => ArcGrid, message: string, keepSelection = false) {
    updateSelectedCase(
      (item) => ({
        ...item,
        [draftRef.current.selectedGridKey]: updater(item[draftRef.current.selectedGridKey])
      }),
      message,
      keepSelection
    );
  }

  function selectCase(kind: CreatorCaseKind, id: string) {
    const next = normalizeDraft({
      ...draftRef.current,
      selectedKind: kind,
      selectedCaseId: id
    });
    draftRef.current = next;
    setDraft(next);
    setSelection(null);
    setStatus(`${labelKind(kind)} selected.`);
  }

  function selectGrid(gridKey: CreatorGridKey) {
    const next = {
      ...draftRef.current,
      selectedGridKey: gridKey
    };
    draftRef.current = next;
    setDraft(next);
    setSelection(null);
  }

  function addCase(kind: CreatorCaseKind) {
    const nextCase = createCreatorCase(kind);
    commitDraft(
      (current) => {
        const listKey = kind === "train" ? "trainCases" : "testCases";
        return {
          ...current,
          [listKey]: [...current[listKey], nextCase],
          selectedKind: kind,
          selectedCaseId: nextCase.id,
          selectedGridKey: "input"
        };
      },
      `${labelKind(kind)} added.`
    );
  }

  function duplicateCase() {
    const current = getSelectedCase(draftRef.current);
    const duplicate = {
      ...current,
      id: makeId(current.kind),
      input: cloneGrid(current.input),
      output: cloneGrid(current.output)
    };
    commitDraft(
      (item) => {
        const listKey = item.selectedKind === "train" ? "trainCases" : "testCases";
        const index = item[listKey].findIndex((candidate) => candidate.id === item.selectedCaseId);
        const nextCases = [...item[listKey]];
        nextCases.splice(index + 1, 0, duplicate);
        return {
          ...item,
          [listKey]: nextCases,
          selectedCaseId: duplicate.id
        };
      },
      `${labelKind(current.kind)} duplicated.`
    );
  }

  function deleteCase() {
    const listKey = draft.selectedKind === "train" ? "trainCases" : "testCases";
    if (draft[listKey].length <= 1) {
      setStatus(`${labelKind(draft.selectedKind)} needs at least one case.`);
      return;
    }

    commitDraft(
      (current) => {
        const cases = current[listKey];
        const index = cases.findIndex((item) => item.id === current.selectedCaseId);
        const nextCases = cases.filter((item) => item.id !== current.selectedCaseId);
        return {
          ...current,
          [listKey]: nextCases,
          selectedCaseId: nextCases[Math.max(0, index - 1)].id
        };
      },
      `${labelKind(draft.selectedKind)} deleted.`
    );
  }

  function copyGridBetween(from: CreatorGridKey, to: CreatorGridKey) {
    updateSelectedCase(
      (item) => ({
        ...item,
        [to]: cloneGrid(item[from])
      }),
      `${labelGrid(from)} copied to ${labelGrid(to)}.`
    );
  }

  function handleCellPointerDown(gridKey: CreatorGridKey, x: number, y: number, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    isPointerDownRef.current = true;
    selectGrid(gridKey);

    if (tool === "select") {
      setSelection({ startX: x, startY: y, endX: x, endY: y });
      return;
    }

    if (tool === "fill") {
      updateSelectedGrid((grid) => floodFillGrid(grid, x, y, selectedColor), "Filled region.");
      return;
    }

    lastPaintedRef.current = `${gridKey}:${x},${y}`;
    updateGridCell(gridKey, x, y, selectedColor, "Painted cell.", true);
  }

  function handleCellPointerEnter(gridKey: CreatorGridKey, x: number, y: number) {
    if (!isPointerDownRef.current || gridKey !== draftRef.current.selectedGridKey) {
      return;
    }

    if (tool === "select") {
      setSelection((current) => (current ? { ...current, endX: x, endY: y } : current));
      return;
    }

    if (tool === "paint") {
      const key = `${gridKey}:${x},${y}`;
      if (lastPaintedRef.current !== key) {
        lastPaintedRef.current = key;
        updateGridCell(gridKey, x, y, selectedColor, "Painted cell.", true);
      }
    }
  }

  function updateGridCell(gridKey: CreatorGridKey, x: number, y: number, color: number, message: string, keepSelection = false) {
    updateSelectedCase(
      (item) => ({
        ...item,
        [gridKey]: setGridCell(item[gridKey], x, y, color)
      }),
      message,
      keepSelection
    );
  }

  function resizeActiveGrid(width: number, height: number) {
    updateSelectedGrid((grid) => resizeGrid(grid, width, height), "Grid resized.");
  }

  function copySelectedRegion() {
    const copied = copySelection(activeGrid, normalizedSelection);
    if (!copied) {
      setStatus("No selection to copy.");
      return;
    }
    setClipboard(copied);
    setStatus(`Copied ${copied.width} x ${copied.height} selection.`);
  }

  function pasteAtSelection() {
    const origin = normalizedSelection ?? { x: 0, y: 0 };
    updateSelectedGrid((grid) => pasteClipboard(grid, clipboard, origin.x, origin.y), "Pasted selection.", true);
  }

  function clearActiveSelectionOrGrid() {
    updateSelectedGrid((grid) => clearGrid(grid, 0, normalizedSelection), normalizedSelection ? "Selection cleared." : "Grid cleared.", true);
  }

  function transformActiveGrid(transform: (grid: ArcGrid) => ArcGrid, message: string) {
    updateSelectedGrid(transform, message);
  }

  function shiftActive(dx: number, dy: number) {
    updateSelectedGrid((grid) => shiftGrid(grid, dx, dy, 0, normalizedSelection), "Shifted grid.", true);
  }

  function undo() {
    if (past.length === 0) {
      return;
    }
    const previous = past[past.length - 1];
    const current = draftRef.current;
    draftRef.current = previous;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items]);
    setDraft(previous);
    setSelection(null);
    setStatus("Undone.");
  }

  function redo() {
    if (future.length === 0) {
      return;
    }
    const next = future[0];
    const current = draftRef.current;
    draftRef.current = next;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, current].slice(-HISTORY_LIMIT));
    setDraft(next);
    setSelection(null);
    setStatus("Redone.");
  }

  function downloadJson() {
    downloadFile("grit3-created-question.json", taskJson, "application/json");
    setStatus("Downloaded task JSON.");
  }

  function sendToEvaluator() {
    if (validationErrors.length > 0) {
      setStatus("Fix validation errors before opening in evaluator.");
      return;
    }
    window.localStorage.setItem(EVALUATOR_HANDOFF_KEY, taskJson);
    window.location.href = appPath("/evaluator.html");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">grit3</p>
          <h1>GRIT3 Creator Studio</h1>
        </div>
        <div className="topbar-actions">
          <a className="button secondary" href={appPath("/")}>
            Home
          </a>
          <a className="button secondary" href={appPath("/evaluator.html")}>
            Evaluator
          </a>
          <a className="button secondary" href={appPath("/studio.html")}>
            Weighting Studio
          </a>
          <a className="button secondary" href={appPath("/results.html")}>
            Results
          </a>
          <a className="button secondary" href={appPath("/human.html")}>
            Human Benchmark
          </a>
        </div>
      </header>

      <div className="creator-workspace">
        <aside className="sidebar creator-sidebar" aria-label="Created case navigation">
          <CreatorCaseList
            cases={draft.trainCases}
            kind="train"
            selectedKind={draft.selectedKind}
            selectedCaseId={draft.selectedCaseId}
            onSelect={selectCase}
            onAdd={addCase}
          />
          <CreatorCaseList
            cases={draft.testCases}
            kind="test"
            selectedKind={draft.selectedKind}
            selectedCaseId={draft.selectedCaseId}
            onSelect={selectCase}
            onAdd={addCase}
          />
        </aside>

        <section className="creator-main">
          <section className="panel creator-editor">
            <div className="panel-header">
              <div>
                <p className="eyebrow">{labelKind(currentCase.kind)}</p>
                <h2>{currentCaseLabel(draft)}</h2>
              </div>
              <div className="nav-actions">
                <button className="button secondary" type="button" onClick={duplicateCase}>
                  Duplicate
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={deleteCase}
                  disabled={(draft.selectedKind === "train" ? draft.trainCases : draft.testCases).length <= 1}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="creator-toolbar">
              <div className="tool-group color-palette" aria-label="Color palette">
                {COLORS.map((color) => (
                  <button
                    className={selectedColor === color ? "color-button selected" : "color-button"}
                    type="button"
                    key={color}
                    title={`${ARC_COLOR_MAP[color].name} (${color})`}
                    onClick={() => setSelectedColor(color)}
                    style={{ backgroundColor: ARC_COLOR_MAP[color].color, color: ARC_COLOR_MAP[color].text }}
                  >
                    {color}
                  </button>
                ))}
              </div>

              <div className="tool-group" aria-label="Tools">
                <ToggleButton selected={tool === "paint"} onClick={() => setTool("paint")} label="Paint" />
                <ToggleButton selected={tool === "fill"} onClick={() => setTool("fill")} label="Fill" />
                <ToggleButton selected={tool === "select"} onClick={() => setTool("select")} label="Select" />
              </div>

              <div className="tool-group" aria-label="Selection">
                <button className="button secondary compact-button" type="button" onClick={copySelectedRegion} disabled={!normalizedSelection}>
                  Copy
                </button>
                <button className="button secondary compact-button" type="button" onClick={pasteAtSelection} disabled={!clipboard}>
                  Paste
                </button>
                <button className="button secondary compact-button" type="button" onClick={clearActiveSelectionOrGrid}>
                  Clear
                </button>
              </div>

              <div className="tool-group" aria-label="Copy between grids">
                <button className="button secondary compact-button" type="button" onClick={() => copyGridBetween("input", "output")}>
                  Input to output
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => copyGridBetween("output", "input")}>
                  Output to input
                </button>
              </div>

              <div className="tool-group" aria-label="Transforms">
                <button className="button secondary compact-button" type="button" onClick={() => transformActiveGrid((grid) => rotateGrid(grid, "counterclockwise"), "Rotated left.")}>
                  Rotate L
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => transformActiveGrid((grid) => rotateGrid(grid, "clockwise"), "Rotated right.")}>
                  Rotate R
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => transformActiveGrid((grid) => flipGrid(grid, "horizontal"), "Flipped horizontally.")}>
                  Flip H
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => transformActiveGrid((grid) => flipGrid(grid, "vertical"), "Flipped vertically.")}>
                  Flip V
                </button>
              </div>

              <div className="tool-group shift-pad" aria-label="Shift">
                <button className="button secondary compact-button" type="button" onClick={() => shiftActive(0, -1)}>
                  Up
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => shiftActive(-1, 0)}>
                  Left
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => shiftActive(1, 0)}>
                  Right
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => shiftActive(0, 1)}>
                  Down
                </button>
              </div>

              <div className="tool-group" aria-label="History">
                <button className="button secondary compact-button" type="button" onClick={undo} disabled={past.length === 0}>
                  Undo
                </button>
                <button className="button secondary compact-button" type="button" onClick={redo} disabled={future.length === 0}>
                  Redo
                </button>
              </div>
            </div>

            <div className="creator-size-row">
              <label className="compact-field">
                <span>Active grid</span>
                <select value={draft.selectedGridKey} onChange={(event) => selectGrid(event.target.value as CreatorGridKey)}>
                  <option value="input">Input</option>
                  <option value="output">Output</option>
                </select>
              </label>
              <label className="compact-field">
                <span>Width</span>
                <input
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  type="number"
                  value={activeDimensions.width}
                  onChange={(event) => resizeActiveGrid(Number(event.target.value), activeDimensions.height)}
                />
              </label>
              <label className="compact-field">
                <span>Height</span>
                <input
                  min={MIN_GRID_SIZE}
                  max={MAX_GRID_SIZE}
                  type="number"
                  value={activeDimensions.height}
                  onChange={(event) => resizeActiveGrid(activeDimensions.width, Number(event.target.value))}
                />
              </label>
              <div className="selection-readout">
                <strong>Selection</strong>
                <span>
                  {normalizedSelection
                    ? `${normalizedSelection.width} x ${normalizedSelection.height} at ${normalizedSelection.x + 1}, ${
                        normalizedSelection.y + 1
                      }`
                    : "None"}
                </span>
              </div>
            </div>

            <div className="creator-grid-layout">
              <EditableGridPanel
                title="Input"
                grid={currentCase.input}
                gridKey="input"
                active={draft.selectedGridKey === "input"}
                selection={draft.selectedGridKey === "input" ? normalizedSelection : null}
                onActivate={() => selectGrid("input")}
                onCellPointerDown={handleCellPointerDown}
                onCellPointerEnter={handleCellPointerEnter}
              />
              <EditableGridPanel
                title="Output"
                grid={currentCase.output}
                gridKey="output"
                active={draft.selectedGridKey === "output"}
                selection={draft.selectedGridKey === "output" ? normalizedSelection : null}
                onActivate={() => selectGrid("output")}
                onCellPointerDown={handleCellPointerDown}
                onCellPointerEnter={handleCellPointerEnter}
              />
            </div>
          </section>

          <section className="panel creator-export-panel">
            <div className="panel-header creator-export-header">
              <div className="creator-export-summary">
                <div>
                  <p className="eyebrow">Export</p>
                  <h2>Task JSON</h2>
                </div>
                {validationErrors.length > 0 ? (
                  <div className="warning-line validation-line">
                    {validationErrors.slice(0, 3).join(" ")}
                    {validationErrors.length > 3 ? ` ${validationErrors.length - 3} more issue(s).` : ""}
                  </div>
                ) : (
                  <div className="success-line">ARC task JSON is valid.</div>
                )}
              </div>
              <div className="nav-actions creator-export-actions">
                <button className="button secondary" type="button" onClick={downloadJson}>
                  Download
                </button>
                <button className="button primary" type="button" onClick={sendToEvaluator} disabled={validationErrors.length > 0}>
                  Open Evaluator
                </button>
              </div>
            </div>
          </section>
        </section>
      </div>

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}

function CreatorCaseList({
  cases,
  kind,
  selectedKind,
  selectedCaseId,
  onSelect,
  onAdd
}: {
  cases: CreatorCase[];
  kind: CreatorCaseKind;
  selectedKind: CreatorCaseKind;
  selectedCaseId: string;
  onSelect: (kind: CreatorCaseKind, id: string) => void;
  onAdd: (kind: CreatorCaseKind) => void;
}) {
  return (
    <section className="creator-case-section">
      <div className="sidebar-header">
        <strong>{kind === "train" ? "Train" : "Test"}</strong>
        <button className="table-link" type="button" onClick={() => onAdd(kind)}>
          Add
        </button>
      </div>
      <div className="question-list">
        {cases.map((item, index) => (
          <button
            className={selectedKind === kind && selectedCaseId === item.id ? "question-link active" : "question-link"}
            key={item.id}
            type="button"
            onClick={() => onSelect(kind, item.id)}
          >
            <span>{kind === "train" ? `Train ${index + 1}` : `Test ${index + 1}`}</span>
            <small>
              {item.input[0]?.length ?? 0} x {item.input.length}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ToggleButton({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button className={selected ? "tool-button selected" : "tool-button"} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function EditableGridPanel({
  title,
  grid,
  gridKey,
  active,
  selection,
  onActivate,
  onCellPointerDown,
  onCellPointerEnter
}: {
  title: string;
  grid: ArcGrid;
  gridKey: CreatorGridKey;
  active: boolean;
  selection: ReturnType<typeof normalizeSelection>;
  onActivate: () => void;
  onCellPointerDown: (gridKey: CreatorGridKey, x: number, y: number, event: PointerEvent<HTMLButtonElement>) => void;
  onCellPointerEnter: (gridKey: CreatorGridKey, x: number, y: number) => void;
}) {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const style = {
    gridTemplateColumns: `repeat(${width}, var(--cell-size))`,
    gridTemplateRows: `repeat(${height}, var(--cell-size))`,
    "--cell-size": getEditableCellSize(width, height)
  } as CSSProperties;

  return (
    <section className={active ? "grid-panel editable-grid-panel active" : "grid-panel editable-grid-panel"} onPointerDown={onActivate}>
      <div className="grid-panel-header">
        <strong>{title}</strong>
        <span>
          {width} x {height}
        </span>
      </div>
      <div className="grid-scroll">
        <div className="editable-arc-grid" style={style}>
          {grid.flatMap((row, y) =>
            row.map((cell, x) => {
              const color = ARC_COLOR_MAP[cell] ?? ARC_COLOR_MAP[0];
              return (
                <button
                  className={isCellSelected(selection, x, y) ? "editable-cell selected" : "editable-cell"}
                  key={`${x}-${y}`}
                  type="button"
                  title={`${x + 1}, ${y + 1}: ${color.name} (${cell})`}
                  style={{ backgroundColor: color.color, color: color.text }}
                  onPointerDown={(event) => onCellPointerDown(gridKey, x, y, event)}
                  onPointerEnter={() => onCellPointerEnter(gridKey, x, y)}
                />
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}

function isCellSelected(selection: ReturnType<typeof normalizeSelection>, x: number, y: number): boolean {
  return Boolean(
    selection &&
      x >= selection.x &&
      x < selection.x + selection.width &&
      y >= selection.y &&
      y < selection.y + selection.height
  );
}

function getSelectedCase(draft: CreatorDraft): CreatorCase {
  const cases = draft.selectedKind === "train" ? draft.trainCases : draft.testCases;
  return cases.find((item) => item.id === draft.selectedCaseId) ?? cases[0];
}

function normalizeDraft(input: CreatorDraft): CreatorDraft {
  const trainCases = input.trainCases.length > 0 ? input.trainCases : [createCreatorCase("train")];
  const testCases = input.testCases.length > 0 ? input.testCases : [createCreatorCase("test")];
  const selectedKind = input.selectedKind === "test" ? "test" : "train";
  const selectedCases = selectedKind === "train" ? trainCases : testCases;
  const selectedCaseId = selectedCases.some((item) => item.id === input.selectedCaseId)
    ? input.selectedCaseId
    : selectedCases[0].id;

  return {
    trainCases,
    testCases,
    selectedKind,
    selectedCaseId,
    selectedGridKey: input.selectedGridKey === "output" ? "output" : "input"
  };
}

function createCreatorCase(kind: CreatorCaseKind): CreatorCase {
  return {
    id: makeId(kind),
    kind,
    input: createGrid(5, 5, 0),
    output: createGrid(5, 5, 0)
  };
}

function makeId(kind: CreatorCaseKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredDraft(): CreatorDraft {
  const fallback = normalizeDraft({
    trainCases: [createCreatorCase("train")],
    testCases: [createCreatorCase("test")],
    selectedKind: "train",
    selectedCaseId: "",
    selectedGridKey: "input"
  });
  const raw = window.localStorage.getItem(CREATOR_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CreatorDraft>;
    const trainCases = sanitizeCases(parsed.trainCases, "train");
    const testCases = sanitizeCases(parsed.testCases, "test");
    return normalizeDraft({
      trainCases,
      testCases,
      selectedKind: parsed.selectedKind === "test" ? "test" : "train",
      selectedCaseId: typeof parsed.selectedCaseId === "string" ? parsed.selectedCaseId : "",
      selectedGridKey: parsed.selectedGridKey === "output" ? "output" : "input"
    });
  } catch {
    return fallback;
  }
}

function sanitizeCases(input: unknown, kind: CreatorCaseKind): CreatorCase[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item, index) => sanitizeCase(item, kind, index))
    .filter((item): item is CreatorCase => item !== null);
}

function sanitizeCase(input: unknown, kind: CreatorCaseKind, index: number): CreatorCase | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const candidate = input as Partial<CreatorCase>;
  if (!isValidGrid(candidate.input) || !isValidGrid(candidate.output)) {
    return null;
  }
  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : `${kind}-${index + 1}`,
    kind,
    input: cloneGrid(candidate.input),
    output: cloneGrid(candidate.output)
  };
}

function isValidGrid(input: unknown): input is ArcGrid {
  return Array.isArray(input) && input.length > 0 && validateGrid(input as ArcGrid, "grid").length === 0;
}

function currentCaseLabel(draft: CreatorDraft): string {
  const cases = draft.selectedKind === "train" ? draft.trainCases : draft.testCases;
  const index = cases.findIndex((item) => item.id === draft.selectedCaseId);
  return draft.selectedKind === "train" ? `Train ${index + 1}` : `Test ${index + 1}`;
}

function labelKind(kind: CreatorCaseKind): string {
  return kind === "train" ? "Train case" : "Test case";
}

function labelGrid(key: CreatorGridKey): string {
  return key === "input" ? "input" : "output";
}

function getEditableCellSize(width: number, height: number): string {
  const largest = Math.max(width, height);
  if (largest > 50) {
    return "10px";
  }
  if (largest > 35) {
    return "13px";
  }
  if (largest > 25) {
    return "16px";
  }
  return "24px";
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
