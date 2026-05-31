import type { CSSProperties } from "react";
import type { ArcGrid } from "./types";

export const ARC_COLOR_MAP: Record<number, { name: string; color: string; text: string }> = {
  0: { name: "Empty", color: "#ffffff", text: "#111827" },
  1: { name: "Gray", color: "#9ca3af", text: "#111827" },
  2: { name: "Red", color: "#ef4444", text: "#ffffff" },
  3: { name: "Blue", color: "#2563eb", text: "#ffffff" },
  4: { name: "Yellow", color: "#facc15", text: "#111827" },
  5: { name: "Green", color: "#16a34a", text: "#ffffff" },
  6: { name: "Purple", color: "#9333ea", text: "#ffffff" },
  7: { name: "Brown", color: "#92400e", text: "#ffffff" },
  8: { name: "Orange", color: "#f97316", text: "#111827" },
  9: { name: "Black", color: "#111827", text: "#ffffff" }
};

interface GridPanelProps {
  title: string;
  grid: ArcGrid;
  compareGrid?: ArcGrid;
}

export function GridPanel({ title, grid, compareGrid }: GridPanelProps) {
  return (
    <div className="grid-panel">
      <div className="grid-panel-header">
        <strong>{title}</strong>
        <span>
          {grid[0]?.length ?? 0} x {grid.length}
        </span>
      </div>
      <div className="grid-scroll">
        <ArcGridView grid={grid} compareGrid={compareGrid} />
      </div>
    </div>
  );
}

export function ArcGridView({ grid, compareGrid }: { grid: ArcGrid; compareGrid?: ArcGrid }) {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const comparable = Boolean(compareGrid && compareGrid.length === height && compareGrid[0]?.length === width);
  const style = {
    gridTemplateColumns: `repeat(${width}, var(--cell-size))`,
    gridTemplateRows: `repeat(${height}, var(--cell-size))`,
    "--cell-size": getCellSize(width, height)
  } as CSSProperties;

  return (
    <div className="arc-grid" style={style}>
      {grid.flatMap((row, y) =>
        row.map((cell, x) => {
          const color = ARC_COLOR_MAP[cell] ?? ARC_COLOR_MAP[0];
          const expected = compareGrid?.[y]?.[x];
          const matches = !comparable || expected === cell;
          return (
            <div
              className={["arc-cell", comparable ? "diff-cell" : "", comparable && !matches ? "mismatch" : ""]
                .filter(Boolean)
                .join(" ")}
              key={`${x}-${y}`}
              title={
                comparable
                  ? `${x + 1}, ${y + 1}: predicted ${cell}; expected ${expected}`
                  : `${x + 1}, ${y + 1}: ${color.name} (${cell})`
              }
              style={{ backgroundColor: color.color, color: color.text }}
            />
          );
        })
      )}
    </div>
  );
}

function getCellSize(width: number, height: number): string {
  const largest = Math.max(width, height);
  if (largest > 50) {
    return "8px";
  }
  if (largest > 35) {
    return "10px";
  }
  if (largest > 25) {
    return "13px";
  }
  if (largest > 16) {
    return "16px";
  }
  return "20px";
}
