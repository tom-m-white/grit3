import { type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  gridDimensions,
  normalizeGridSelection,
  type AdvancedGridSelection,
  type SparseGridClipboard
} from "./creatorGrid";
import { ARC_COLOR_MAP, GridPanel } from "./GridPanel";
import type { ArcGrid, ArcTask } from "./types";

export type HumanTool = "paint" | "fill" | "select";
export type SolveOutcome = "idle" | "correct" | "wrong";

const COLORS = Object.keys(ARC_COLOR_MAP).map(Number);

export function SolveQuestionPanel({
  eyebrow = "Question",
  loadError = null,
  task,
  title
}: {
  eyebrow?: string;
  loadError?: string | null;
  task: ArcTask | null;
  title: string;
}) {
  return (
    <section className="panel human-question-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>

      {loadError || !task ? (
        <div className="empty-state">{loadError ?? "Question data is unavailable."}</div>
      ) : (
        <div className="question-content human-question-content">
          <div className="case-section">
            <h3>Train</h3>
            {task.train.map((pair, index) => (
              <div className="pair-row" key={`train-${index}`}>
                <GridPanel title={`Example ${index + 1} input`} grid={pair.input} />
                {pair.output ? <GridPanel title={`Example ${index + 1} output`} grid={pair.output} /> : null}
              </div>
            ))}
          </div>

          <div className="case-section">
            <h3>Test</h3>
            {task.test.map((pair, index) => (
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

export function SolveAnswerPanel({
  activeOutputIndex,
  canRedo,
  canSubmit,
  canUndo,
  clipboard,
  color,
  drafts,
  frozen,
  onAdvance,
  onCellPointerDown,
  onCellPointerEnter,
  onClear,
  onClearSelection,
  onCopyInput,
  onCopySelection,
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
  onTryAgain,
  onUndo,
  outcome,
  selection,
  status,
  tool,
  advanceLabel = "Continue",
  canAdvance = false,
  endLabel = "End Benchmark",
  showTryAgain = outcome === "wrong",
  submitLabel = "Submit Answer"
}: {
  activeOutputIndex: number;
  advanceLabel?: string;
  canAdvance?: boolean;
  canRedo: boolean;
  canSubmit: boolean;
  canUndo: boolean;
  clipboard: SparseGridClipboard | null;
  color: number;
  drafts: ArcGrid[];
  endLabel?: string;
  frozen: boolean;
  onAdvance?: () => void;
  onCellPointerDown: (outputIndex: number, x: number, y: number, event: PointerEvent<HTMLButtonElement>) => void;
  onCellPointerEnter: (outputIndex: number, x: number, y: number) => void;
  onClear: (outputIndex: number) => void;
  onClearSelection: () => void;
  onCopyInput: (outputIndex: number) => void;
  onCopySelection: () => void;
  onDeselectSelection: () => void;
  onEnd?: () => void;
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
  onTryAgain?: () => void;
  onUndo: () => void;
  outcome: SolveOutcome;
  selection: AdvancedGridSelection | null;
  showTryAgain?: boolean;
  status: string;
  submitLabel?: string;
  tool: HumanTool;
}) {
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
        <span className={outcome === "correct" ? "status-badge correct" : outcome === "wrong" ? "status-badge wrong" : "panel-meta"}>
          {outcome === "idle" ? "Unsubmitted" : status}
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
          <ToolButton selected={tool === "paint"} onClick={() => onSelectTool("paint")} disabled={frozen}>
            Paint
          </ToolButton>
          <ToolButton selected={tool === "fill"} onClick={() => onSelectTool("fill")} disabled={frozen}>
            Fill
          </ToolButton>
          <ToolButton selected={tool === "select"} onClick={() => onSelectTool("select")} disabled={frozen}>
            Select
          </ToolButton>
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
          <EditableSolveOutput
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
          {showTryAgain && onTryAgain ? (
            <button className="button secondary" type="button" onClick={onTryAgain}>
              Try Again
            </button>
          ) : null}
          <button className="button primary" type="button" onClick={onSubmit} disabled={!canSubmit}>
            {submitLabel}
          </button>
          {onAdvance ? (
            <button className="button secondary" type="button" onClick={onAdvance} disabled={!canAdvance}>
              {advanceLabel}
            </button>
          ) : null}
          {onEnd ? (
            <button className="button secondary" type="button" onClick={onEnd} disabled={!canAdvance}>
              {endLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ToolButton({
  children,
  disabled,
  onClick,
  selected
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button className={selected ? "tool-button selected" : "tool-button"} type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function EditableSolveOutput({
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

function isSelectedCell(selection: ReturnType<typeof normalizeGridSelection>, x: number, y: number): boolean {
  return Boolean(selection?.cells.some((cell) => cell.x === x && cell.y === y));
}
