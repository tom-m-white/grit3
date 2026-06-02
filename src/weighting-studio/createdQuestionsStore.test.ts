import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCreatedQuestion, normalizeTitle } from "./createdQuestionsStore";
import { requireSupabase } from "./supabaseClient";

vi.mock("./supabaseClient", () => ({
  requireSupabase: vi.fn()
}));

describe("created question store helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes valid titles", () => {
    expect(normalizeTitle("  Symmetry check  ")).toBe("Symmetry check");
  });

  it("rejects missing or very long titles", () => {
    expect(() => normalizeTitle(" ")).toThrow(/title is required/i);
    expect(() => normalizeTitle("x".repeat(121))).toThrow(/120 characters/i);
  });

  it("deletes created questions with an owner scoped query", async () => {
    const query = mockDeleteQuery(Promise.resolve({ data: { id: "question-1" }, error: null }));
    const deleteCall = vi.fn(() => query);
    const from = vi.fn(() => ({ delete: deleteCall }));
    vi.mocked(requireSupabase).mockReturnValue({ from } as unknown as ReturnType<typeof requireSupabase>);

    await deleteCreatedQuestion({
      ownerId: "owner-1",
      questionId: "question-1"
    });

    expect(from).toHaveBeenCalledWith("created_questions");
    expect(deleteCall).toHaveBeenCalled();
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", "question-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "owner_id", "owner-1");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.maybeSingle).toHaveBeenCalled();
  });

  it("rejects deletes when no created question row was removed", async () => {
    const query = mockDeleteQuery(Promise.resolve({ data: null, error: null }));
    const deleteCall = vi.fn(() => query);
    const from = vi.fn(() => ({ delete: deleteCall }));
    vi.mocked(requireSupabase).mockReturnValue({ from } as unknown as ReturnType<typeof requireSupabase>);

    await expect(
      deleteCreatedQuestion({
        ownerId: "owner-1",
        questionId: "missing-question"
      })
    ).rejects.toThrow(/not removed/i);
  });
});

function mockDeleteQuery(result: Promise<{ data: { id: string } | null; error: Error | null }>) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(() => result),
    select: vi.fn()
  };
  query.eq.mockReturnValueOnce(query);
  query.eq.mockReturnValueOnce(query);
  query.select.mockReturnValueOnce(query);
  return query;
}
