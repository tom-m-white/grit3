import { describe, expect, it } from "vitest";
import { adaptArcTask } from "./questionLoader";
import {
  clearGrid,
  clearGridSelection,
  copySelection,
  copyGridSelection,
  createGrid,
  floodFillGrid,
  flipGridSelection,
  flipGrid,
  importCreatorJson,
  isCellInGridSelection,
  pasteClipboard,
  pasteSparseClipboard,
  resizeGrid,
  moveGridSelection,
  normalizeGridSelection,
  rotateGrid,
  rotateGridSelection,
  selectCellsByColor,
  serializeCreatorTask,
  shiftGrid,
  validateArcTask,
  type CreatorCase
} from "./creatorGrid";

const grid = [
  [1, 1, 0],
  [1, 2, 0],
  [0, 0, 0]
];

describe("creator grid helpers", () => {
  it("creates and resizes grids while preserving existing cells", () => {
    expect(createGrid(2, 3, 4)).toEqual([
      [4, 4],
      [4, 4],
      [4, 4]
    ]);

    expect(resizeGrid(grid, 2, 2)).toEqual([
      [1, 1],
      [1, 2]
    ]);

    expect(resizeGrid([[9]], 3, 2, 7)).toEqual([
      [9, 7, 7],
      [7, 7, 7]
    ]);
  });

  it("flood fills contiguous cells only", () => {
    expect(floodFillGrid(grid, 0, 0, 5)).toEqual([
      [5, 5, 0],
      [5, 2, 0],
      [0, 0, 0]
    ]);
  });

  it("copies selections and clips paste at grid bounds", () => {
    const copied = copySelection(grid, { startX: 1, startY: 0, endX: 2, endY: 1 });
    expect(copied).toEqual({
      width: 2,
      height: 2,
      grid: [
        [1, 0],
        [2, 0]
      ]
    });

    expect(pasteClipboard(createGrid(2, 2), copied, 1, 1)).toEqual([
      [0, 0],
      [0, 1]
    ]);
  });

  it("rotates and flips grids", () => {
    const source = [
      [1, 2, 3],
      [4, 5, 6]
    ];

    expect(rotateGrid(source, "clockwise")).toEqual([
      [4, 1],
      [5, 2],
      [6, 3]
    ]);
    expect(rotateGrid(source, "counterclockwise")).toEqual([
      [3, 6],
      [2, 5],
      [1, 4]
    ]);
    expect(flipGrid(source, "horizontal")).toEqual([
      [3, 2, 1],
      [6, 5, 4]
    ]);
    expect(flipGrid(source, "vertical")).toEqual([
      [4, 5, 6],
      [1, 2, 3]
    ]);
  });

  it("shifts whole grids and selections", () => {
    expect(shiftGrid([[1, 2, 3]], 1, 0)).toEqual([[0, 1, 2]]);

    expect(
      shiftGrid(
        [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]
        ],
        1,
        0,
        0,
        { startX: 0, startY: 0, endX: 1, endY: 1 }
      )
    ).toEqual([
      [0, 1, 3],
      [0, 4, 6],
      [7, 8, 9]
    ]);
  });

  it("clears full grids and selections", () => {
    expect(clearGrid(grid, 9, { startX: 1, startY: 1, endX: 2, endY: 2 })).toEqual([
      [1, 1, 0],
      [1, 9, 9],
      [0, 9, 9]
    ]);
  });

  it("normalizes rectangular selections into selected cells", () => {
    expect(normalizeGridSelection({ startX: 2, startY: 1, endX: 1, endY: 2 }, grid)).toEqual({
      kind: "rect",
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      cells: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 }
      ]
    });
  });

  it("selects all matching cells by color", () => {
    expect(selectCellsByColor(grid, 1)).toEqual({
      kind: "cells",
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ]
    });
  });

  it("detects cells inside rectangular and sparse selections", () => {
    expect(isCellInGridSelection({ startX: 2, startY: 1, endX: 1, endY: 2 }, grid, 1, 2)).toBe(true);
    expect(
      isCellInGridSelection(
        {
          kind: "cells",
          cells: [
            { x: 0, y: 0 },
            { x: 2, y: 2 }
          ]
        },
        grid,
        1,
        1
      )
    ).toBe(false);
  });

  it("copies and pastes sparse selections while preserving gaps", () => {
    const source = [
      [1, 0, 1],
      [0, 2, 0],
      [3, 0, 3]
    ];
    const selection = {
      kind: "cells" as const,
      cells: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 }
      ]
    };
    const clipboard = copyGridSelection(source, selection);

    expect(clipboard).toEqual({
      width: 3,
      height: 2,
      cells: [
        { x: 0, y: 0, value: 1 },
        { x: 2, y: 0, value: 1 },
        { x: 1, y: 1, value: 2 }
      ]
    });
    expect(pasteSparseClipboard(createGrid(4, 4), clipboard, 0, 1)).toEqual([
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [0, 2, 0, 0],
      [0, 0, 0, 0]
    ]);
  });

  it("cut-moves selected cells and clears originals", () => {
    const result = moveGridSelection(
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ],
      {
        kind: "cells",
        cells: [
          { x: 0, y: 0 },
          { x: 1, y: 1 }
        ]
      },
      1,
      0
    );

    expect(result.grid).toEqual([
      [0, 1, 3],
      [4, 0, 5],
      [7, 8, 9]
    ]);
    expect(result.selection).toEqual({
      kind: "cells",
      cells: [
        { x: 1, y: 0 },
        { x: 2, y: 1 }
      ]
    });
  });

  it("rotates and flips selected cells inside their bounding box", () => {
    const source = [
      [1, 0],
      [0, 2]
    ];
    const selection = {
      kind: "cells" as const,
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 1 }
      ]
    };

    expect(rotateGridSelection(source, selection, "clockwise").grid).toEqual([
      [0, 1],
      [2, 0]
    ]);
    expect(flipGridSelection(source, selection, "horizontal").grid).toEqual([
      [0, 1],
      [2, 0]
    ]);
  });

  it("clears only selected sparse cells", () => {
    expect(
      clearGridSelection(
        [
          [1, 2, 3],
          [4, 5, 6]
        ],
        {
          kind: "cells",
          cells: [
            { x: 0, y: 0 },
            { x: 2, y: 1 }
          ]
        }
      )
    ).toEqual([
      [0, 2, 3],
      [4, 5, 0]
    ]);
  });

  it("serializes pure ARC task JSON and validates with existing adapter", () => {
    const trainCase: CreatorCase = {
      id: "train-1",
      kind: "train",
      input: [[1]],
      output: [[2]]
    };
    const testCase: CreatorCase = {
      id: "test-1",
      kind: "test",
      input: [[3]],
      output: [[4]]
    };

    const task = serializeCreatorTask([trainCase], [testCase]);
    expect(task).toEqual({
      train: [{ input: [[1]], output: [[2]] }],
      test: [{ input: [[3]], output: [[4]] }]
    });
    expect(validateArcTask(task)).toEqual([]);
    expect(adaptArcTask(task)).toEqual(task);
  });

  it("imports ARC task JSON into editable creator cases", () => {
    const imported = importCreatorJson({
      title: "Diagonal rule",
      train: [{ input: [[1]], output: [[2]] }],
      test: [{ input: [[3]], output: [[4]] }]
    });

    expect(imported.title).toBe("Diagonal rule");
    expect(imported.trainCases).toEqual([
      {
        id: "train-1",
        kind: "train",
        input: [[1]],
        output: [[2]]
      }
    ]);
    expect(imported.testCases).toEqual([
      {
        id: "test-1",
        kind: "test",
        input: [[3]],
        output: [[4]]
      }
    ]);
  });

  it("creates blank editable outputs for imported test cases without hidden answers", () => {
    const imported = importCreatorJson({
      task: {
        train: [{ input: [[1, 0]], output: [[0, 1]] }],
        test: [{ input: [[5, 5, 5]] }]
      }
    });

    expect(imported.testCases[0].input).toEqual([[5, 5, 5]]);
    expect(imported.testCases[0].output).toEqual([[0, 0, 0]]);
  });

  it("reports invalid ARC task shapes", () => {
    expect(
      validateArcTask({
        train: [],
        test: [{ input: [[1, 2], [3]], output: [[10]] }]
      })
    ).toEqual([
      "Task must include at least one train example.",
      "test[0].input row 2 must match width 2.",
      "test[0].output cell 1,1 must be an integer from 0 to 9."
    ]);
  });
});
