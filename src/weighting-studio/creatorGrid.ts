import type { ArcGrid, ArcTask } from "./types";

export type CreatorCaseKind = "train" | "test";
export type CreatorGridKey = "input" | "output";
export type EditorTool = "paint" | "fill" | "select";
export type FlipAxis = "horizontal" | "vertical";
export type RotateDirection = "clockwise" | "counterclockwise";

export interface CreatorCase {
  id: string;
  kind: CreatorCaseKind;
  input: ArcGrid;
  output: ArcGrid;
}

export interface GridSelection {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface SelectedCell {
  x: number;
  y: number;
}

export interface CellSelection {
  kind: "cells";
  cells: SelectedCell[];
}

export type AdvancedGridSelection = GridSelection | CellSelection;

export interface NormalizedSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedGridSelection extends NormalizedSelection {
  kind: "rect" | "cells";
  cells: SelectedCell[];
}

export interface GridClipboard {
  width: number;
  height: number;
  grid: ArcGrid;
}

export interface SparseGridClipboard {
  width: number;
  height: number;
  cells: Array<SelectedCell & { value: number }>;
}

export interface GridSelectionEditResult {
  grid: ArcGrid;
  selection: CellSelection | null;
}

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 60;

export function createGrid(width: number, height: number, fill = 0): ArcGrid {
  const safeWidth = clampDimension(width);
  const safeHeight = clampDimension(height);
  const safeFill = normalizeCell(fill);
  return Array.from({ length: safeHeight }, () => Array.from({ length: safeWidth }, () => safeFill));
}

export function cloneGrid(grid: ArcGrid): ArcGrid {
  return grid.map((row) => [...row]);
}

export function setGridCell(grid: ArcGrid, x: number, y: number, color: number): ArcGrid {
  if (!isInsideGrid(grid, x, y)) {
    return cloneGrid(grid);
  }
  const next = cloneGrid(grid);
  next[y][x] = normalizeCell(color);
  return next;
}

export function resizeGrid(grid: ArcGrid, width: number, height: number, fill = 0): ArcGrid {
  const next = createGrid(width, height, fill);
  for (let y = 0; y < Math.min(grid.length, next.length); y += 1) {
    for (let x = 0; x < Math.min(grid[y]?.length ?? 0, next[y].length); x += 1) {
      next[y][x] = grid[y][x];
    }
  }
  return next;
}

export function floodFillGrid(grid: ArcGrid, startX: number, startY: number, color: number): ArcGrid {
  if (!isInsideGrid(grid, startX, startY)) {
    return cloneGrid(grid);
  }

  const target = grid[startY][startX];
  const replacement = normalizeCell(color);
  if (target === replacement) {
    return cloneGrid(grid);
  }

  const next = cloneGrid(grid);
  const queue: Array<[number, number]> = [[startX, startY]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [x, y] = queue.shift() as [number, number];
    const key = `${x},${y}`;
    if (visited.has(key) || !isInsideGrid(next, x, y) || next[y][x] !== target) {
      continue;
    }

    visited.add(key);
    next[y][x] = replacement;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  return next;
}

export function normalizeSelection(selection: GridSelection | null, grid: ArcGrid): NormalizedSelection | null {
  const width = grid[0]?.length ?? 0;
  const height = grid.length;
  if (!selection || width === 0 || height === 0) {
    return null;
  }

  const x1 = clamp(Math.min(selection.startX, selection.endX), 0, width - 1);
  const x2 = clamp(Math.max(selection.startX, selection.endX), 0, width - 1);
  const y1 = clamp(Math.min(selection.startY, selection.endY), 0, height - 1);
  const y2 = clamp(Math.max(selection.startY, selection.endY), 0, height - 1);

  return {
    x: x1,
    y: y1,
    width: x2 - x1 + 1,
    height: y2 - y1 + 1
  };
}

export function copySelection(grid: ArcGrid, selection: GridSelection | NormalizedSelection | null): GridClipboard | null {
  const normalized = isNormalizedSelection(selection) ? selection : normalizeSelection(selection, grid);
  if (!normalized) {
    return null;
  }

  const copied = grid
    .slice(normalized.y, normalized.y + normalized.height)
    .map((row) => row.slice(normalized.x, normalized.x + normalized.width));

  return {
    width: normalized.width,
    height: normalized.height,
    grid: copied
  };
}

export function normalizeGridSelection(selection: AdvancedGridSelection | null, grid: ArcGrid): NormalizedGridSelection | null {
  if (!selection) {
    return null;
  }

  if (isCellSelection(selection)) {
    const uniqueCells = uniqueInsideCells(selection.cells, grid);
    if (uniqueCells.length === 0) {
      return null;
    }
    const bounds = boundsForCells(uniqueCells);
    return {
      kind: "cells",
      ...bounds,
      cells: uniqueCells
    };
  }

  const rect = normalizeSelection(selection, grid);
  if (!rect) {
    return null;
  }

  const cells: SelectedCell[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      cells.push({ x, y });
    }
  }

  return {
    kind: "rect",
    ...rect,
    cells
  };
}

export function selectCellsByColor(grid: ArcGrid, color: number): CellSelection | null {
  const target = normalizeCell(color);
  const cells: SelectedCell[] = [];

  grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell === target) {
        cells.push({ x, y });
      }
    });
  });

  return cells.length === 0 ? null : { kind: "cells", cells };
}

export function copyGridSelection(grid: ArcGrid, selection: AdvancedGridSelection | null): SparseGridClipboard | null {
  const normalized = normalizeGridSelection(selection, grid);
  if (!normalized) {
    return null;
  }

  return {
    width: normalized.width,
    height: normalized.height,
    cells: normalized.cells.map((cell) => ({
      x: cell.x - normalized.x,
      y: cell.y - normalized.y,
      value: grid[cell.y][cell.x]
    }))
  };
}

export function pasteSparseClipboard(grid: ArcGrid, clipboard: SparseGridClipboard | null, originX: number, originY: number): ArcGrid {
  if (!clipboard) {
    return cloneGrid(grid);
  }

  const next = cloneGrid(grid);
  clipboard.cells.forEach((cell) => {
    const targetX = originX + cell.x;
    const targetY = originY + cell.y;
    if (isInsideGrid(next, targetX, targetY)) {
      next[targetY][targetX] = normalizeCell(cell.value);
    }
  });
  return next;
}

export function clearGridSelection(
  grid: ArcGrid,
  selection: AdvancedGridSelection | null,
  fill = 0
): ArcGrid {
  const normalized = normalizeGridSelection(selection, grid);
  if (!normalized) {
    return cloneGrid(grid);
  }

  const next = cloneGrid(grid);
  const blank = normalizeCell(fill);
  normalized.cells.forEach((cell) => {
    next[cell.y][cell.x] = blank;
  });
  return next;
}

export function moveGridSelection(
  grid: ArcGrid,
  selection: AdvancedGridSelection | null,
  dx: number,
  dy: number,
  fill = 0
): GridSelectionEditResult {
  const normalized = normalizeGridSelection(selection, grid);
  if (!normalized) {
    return { grid: cloneGrid(grid), selection: null };
  }

  const blank = normalizeCell(fill);
  const next = cloneGrid(grid);
  const sourceCells = normalized.cells.map((cell) => ({
    ...cell,
    value: grid[cell.y][cell.x]
  }));
  sourceCells.forEach((cell) => {
    next[cell.y][cell.x] = blank;
  });

  const movedCells: SelectedCell[] = [];
  sourceCells.forEach((cell) => {
    const targetX = cell.x + dx;
    const targetY = cell.y + dy;
    if (isInsideGrid(next, targetX, targetY)) {
      next[targetY][targetX] = cell.value;
      movedCells.push({ x: targetX, y: targetY });
    }
  });

  return {
    grid: next,
    selection: movedCells.length > 0 ? { kind: "cells", cells: movedCells } : null
  };
}

export function rotateGridSelection(
  grid: ArcGrid,
  selection: AdvancedGridSelection | null,
  direction: RotateDirection,
  fill = 0
): GridSelectionEditResult {
  const normalized = normalizeGridSelection(selection, grid);
  const clipboard = copyGridSelection(grid, selection);
  if (!normalized || !clipboard) {
    return { grid: cloneGrid(grid), selection: null };
  }

  const rotated = rotateSparseClipboard(clipboard, direction);
  return pasteTransformedSelection(grid, normalized, rotated, fill);
}

export function flipGridSelection(
  grid: ArcGrid,
  selection: AdvancedGridSelection | null,
  axis: FlipAxis,
  fill = 0
): GridSelectionEditResult {
  const normalized = normalizeGridSelection(selection, grid);
  const clipboard = copyGridSelection(grid, selection);
  if (!normalized || !clipboard) {
    return { grid: cloneGrid(grid), selection: null };
  }

  const flipped = flipSparseClipboard(clipboard, axis);
  return pasteTransformedSelection(grid, normalized, flipped, fill);
}

export function pasteClipboard(grid: ArcGrid, clipboard: GridClipboard | null, originX: number, originY: number): ArcGrid {
  if (!clipboard) {
    return cloneGrid(grid);
  }

  const next = cloneGrid(grid);
  for (let y = 0; y < clipboard.height; y += 1) {
    for (let x = 0; x < clipboard.width; x += 1) {
      const targetX = originX + x;
      const targetY = originY + y;
      if (isInsideGrid(next, targetX, targetY)) {
        next[targetY][targetX] = clipboard.grid[y][x];
      }
    }
  }
  return next;
}

export function rotateGrid(grid: ArcGrid, direction: RotateDirection): ArcGrid {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const next = createGrid(height, width);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (direction === "clockwise") {
        next[x][height - 1 - y] = grid[y][x];
      } else {
        next[width - 1 - x][y] = grid[y][x];
      }
    }
  }

  return next;
}

export function flipGrid(grid: ArcGrid, axis: FlipAxis): ArcGrid {
  if (axis === "horizontal") {
    return grid.map((row) => [...row].reverse());
  }
  return cloneGrid(grid).reverse();
}

export function shiftGrid(
  grid: ArcGrid,
  dx: number,
  dy: number,
  fill = 0,
  selection: GridSelection | NormalizedSelection | null = null
): ArcGrid {
  const normalized = isNormalizedSelection(selection) ? selection : normalizeSelection(selection, grid);
  const next = cloneGrid(grid);
  const area = normalized ?? { x: 0, y: 0, width: grid[0]?.length ?? 0, height: grid.length };
  const blank = normalizeCell(fill);
  const source = copySelection(grid, area);

  if (!source) {
    return next;
  }

  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      next[y][x] = blank;
    }
  }

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = area.x + x + dx;
      const targetY = area.y + y + dy;
      if (
        targetX >= area.x &&
        targetX < area.x + area.width &&
        targetY >= area.y &&
        targetY < area.y + area.height
      ) {
        next[targetY][targetX] = source.grid[y][x];
      }
    }
  }

  return next;
}

export function clearGrid(grid: ArcGrid, fill = 0, selection: GridSelection | NormalizedSelection | null = null): ArcGrid {
  const normalized = isNormalizedSelection(selection) ? selection : normalizeSelection(selection, grid);
  const blank = normalizeCell(fill);
  const next = cloneGrid(grid);
  const area = normalized ?? { x: 0, y: 0, width: grid[0]?.length ?? 0, height: grid.length };

  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      next[y][x] = blank;
    }
  }

  return next;
}

export function serializeCreatorTask(trainCases: CreatorCase[], testCases: CreatorCase[]): ArcTask {
  return {
    train: trainCases.map((item) => ({
      input: cloneGrid(item.input),
      output: cloneGrid(item.output)
    })),
    test: testCases.map((item) => ({
      input: cloneGrid(item.input),
      output: cloneGrid(item.output)
    }))
  };
}

export function validateArcTask(task: ArcTask): string[] {
  const errors: string[] = [];
  if (task.train.length === 0) {
    errors.push("Task must include at least one train example.");
  }
  if (task.test.length === 0) {
    errors.push("Task must include at least one test case.");
  }

  task.train.forEach((pair, index) => {
    errors.push(...validateGrid(pair.input, `train[${index}].input`));
    errors.push(...validateGrid(pair.output, `train[${index}].output`));
  });
  task.test.forEach((pair, index) => {
    errors.push(...validateGrid(pair.input, `test[${index}].input`));
    errors.push(...validateGrid(pair.output, `test[${index}].output`));
  });

  return errors;
}

export function validateGrid(grid: ArcGrid | undefined, label: string): string[] {
  if (!Array.isArray(grid) || grid.length === 0) {
    return [`${label} must be a non-empty grid.`];
  }

  const width = Array.isArray(grid[0]) ? grid[0].length : 0;
  if (width === 0) {
    return [`${label} must have at least one column.`];
  }

  const errors: string[] = [];
  grid.forEach((row, y) => {
    if (!Array.isArray(row) || row.length !== width) {
      errors.push(`${label} row ${y + 1} must match width ${width}.`);
      return;
    }
    row.forEach((cell, x) => {
      if (!Number.isInteger(cell) || cell < 0 || cell > 9) {
        errors.push(`${label} cell ${x + 1},${y + 1} must be an integer from 0 to 9.`);
      }
    });
  });

  return errors;
}

export function gridDimensions(grid: ArcGrid): { width: number; height: number } {
  return {
    width: grid[0]?.length ?? 0,
    height: grid.length
  };
}

function isInsideGrid(grid: ArcGrid, x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[y]?.length ?? 0);
}

function normalizeCell(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 9 ? value : 0;
}

function clampDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_GRID_SIZE;
  }
  return clamp(Math.round(value), MIN_GRID_SIZE, MAX_GRID_SIZE);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isNormalizedSelection(selection: GridSelection | NormalizedSelection | null): selection is NormalizedSelection {
  return Boolean(selection && "x" in selection && "width" in selection);
}

function isCellSelection(selection: AdvancedGridSelection): selection is CellSelection {
  return "kind" in selection && selection.kind === "cells";
}

function uniqueInsideCells(cells: SelectedCell[], grid: ArcGrid): SelectedCell[] {
  const seen = new Set<string>();
  const result: SelectedCell[] = [];

  cells.forEach((cell) => {
    if (!isInsideGrid(grid, cell.x, cell.y)) {
      return;
    }
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push({ x: cell.x, y: cell.y });
  });

  return result;
}

function boundsForCells(cells: SelectedCell[]): NormalizedSelection {
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function rotateSparseClipboard(clipboard: SparseGridClipboard, direction: RotateDirection): SparseGridClipboard {
  return {
    width: clipboard.height,
    height: clipboard.width,
    cells: clipboard.cells.map((cell) =>
      direction === "clockwise"
        ? {
            x: clipboard.height - 1 - cell.y,
            y: cell.x,
            value: cell.value
          }
        : {
            x: cell.y,
            y: clipboard.width - 1 - cell.x,
            value: cell.value
          }
    )
  };
}

function flipSparseClipboard(clipboard: SparseGridClipboard, axis: FlipAxis): SparseGridClipboard {
  return {
    width: clipboard.width,
    height: clipboard.height,
    cells: clipboard.cells.map((cell) =>
      axis === "horizontal"
        ? {
            x: clipboard.width - 1 - cell.x,
            y: cell.y,
            value: cell.value
          }
        : {
            x: cell.x,
            y: clipboard.height - 1 - cell.y,
            value: cell.value
          }
    )
  };
}

function pasteTransformedSelection(
  grid: ArcGrid,
  normalized: NormalizedGridSelection,
  clipboard: SparseGridClipboard,
  fill: number
): GridSelectionEditResult {
  let next = cloneGrid(grid);
  const blank = normalizeCell(fill);
  normalized.cells.forEach((cell) => {
    next[cell.y][cell.x] = blank;
  });
  next = pasteSparseClipboard(next, clipboard, normalized.x, normalized.y);
  const pastedCells = clipboard.cells
    .map((cell) => ({
      x: normalized.x + cell.x,
      y: normalized.y + cell.y
    }))
    .filter((cell) => isInsideGrid(next, cell.x, cell.y));

  return {
    grid: next,
    selection: pastedCells.length > 0 ? { kind: "cells", cells: pastedCells } : null
  };
}
