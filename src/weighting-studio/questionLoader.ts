import type { ArcGrid, ArcPair, ArcTask, LoadedQuestion, QuestionId } from "./types";
import { QUESTION_IDS } from "./rubric";

const questionModules = import.meta.glob<ArcTask>("../../questions/q*.json", {
  eager: true,
  import: "default"
});

export function loadQuestions(): LoadedQuestion[] {
  return QUESTION_IDS.map((questionId) => {
    const path = `../../questions/${questionId}.json`;
    const rawTask = questionModules[path];

    if (!rawTask) {
      return {
        question_id: questionId,
        task: null,
        load_error: `Missing ${path}`
      };
    }

    try {
      return {
        question_id: questionId,
        task: adaptArcTask(rawTask),
        load_error: null
      };
    } catch (error) {
      return {
        question_id: questionId,
        task: null,
        load_error: error instanceof Error ? error.message : "Could not load question JSON."
      };
    }
  });
}

export function adaptArcTask(rawTask: unknown): ArcTask {
  // Adapter boundary: if grit3 later stores questions in a richer format, convert
  // that format into this ARC shape here without changing benchmark source files.
  if (!rawTask || typeof rawTask !== "object" || Array.isArray(rawTask)) {
    throw new Error("Question file must be an object.");
  }

  const task = rawTask as Partial<ArcTask>;
  if (!Array.isArray(task.train) || !Array.isArray(task.test)) {
    throw new Error("Question file must include train and test arrays.");
  }

  return {
    train: task.train.map((pair, index) => adaptPair(pair, `train[${index}]`, true)),
    test: task.test.map((pair, index) => adaptPair(pair, `test[${index}]`, false))
  };
}

function adaptPair(rawPair: unknown, label: string, requireOutput: boolean): ArcPair {
  if (!rawPair || typeof rawPair !== "object" || Array.isArray(rawPair)) {
    throw new Error(`${label} must be an object.`);
  }
  const pair = rawPair as Partial<ArcPair>;

  const adapted: ArcPair = {
    input: validateGrid(pair.input, `${label}.input`)
  };

  if (pair.output !== undefined) {
    adapted.output = validateGrid(pair.output, `${label}.output`);
  } else if (requireOutput) {
    throw new Error(`${label}.output is required for train examples.`);
  }

  return adapted;
}

function validateGrid(input: unknown, label: string): ArcGrid {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`${label} must be a non-empty grid.`);
  }

  const width = Array.isArray(input[0]) ? input[0].length : 0;
  if (width === 0) {
    throw new Error(`${label} must have at least one column.`);
  }

  return input.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(`${label} row ${rowIndex + 1} must match grid width ${width}.`);
    }
    return row.map((cell, columnIndex) => {
      if (!Number.isInteger(cell) || cell < 0 || cell > 9) {
        throw new Error(`${label} cell ${rowIndex + 1},${columnIndex + 1} must be an integer from 0 to 9.`);
      }
      return cell;
    });
  });
}
