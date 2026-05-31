import { describe, expect, it } from "vitest";
import { formatTaskJsonForReview } from "./adminReview";
import type { ArcTask } from "./types";

describe("admin review helpers", () => {
  it("formats task JSON with train before test", () => {
    const task = {
      test: [{ input: [[3]], output: [[4]] }],
      train: [{ input: [[1]], output: [[2]] }]
    } as unknown as ArcTask;

    const formatted = formatTaskJsonForReview(task);

    expect(formatted.indexOf('"train"')).toBeLessThan(formatted.indexOf('"test"'));
    expect(JSON.parse(formatted)).toEqual({
      train: [{ input: [[1]], output: [[2]] }],
      test: [{ input: [[3]], output: [[4]] }]
    });
  });
});
