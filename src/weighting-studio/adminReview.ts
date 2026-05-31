import type { ArcTask } from "./types";

export function formatTaskJsonForReview(task: ArcTask): string {
  return JSON.stringify(
    {
      train: task.train,
      test: task.test
    },
    null,
    2
  );
}
