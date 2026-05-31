import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "./AppHeader";
import { AuthGate, type AppAccount } from "./account";
import {
  type CreatedQuestionRow,
  type CreatedQuestionStatus,
  listReviewQueue,
  updateCreatedQuestionReview
} from "./createdQuestionsStore";

const REVIEW_STATUSES: CreatedQuestionStatus[] = ["draft", "submitted", "needs_changes", "verified", "rejected"];

export function AdminReviewApp() {
  return (
    <AuthGate title="Sign in for admin review">
      {(account, controls) => <AdminReviewWorkspace account={account} onSignOut={controls.signOut} />}
    </AuthGate>
  );
}

function AdminReviewWorkspace({ account, onSignOut }: { account: AppAccount; onSignOut: () => Promise<void> }) {
  const [questions, setQuestions] = useState<CreatedQuestionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<CreatedQuestionStatus>("submitted");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading review queue...");
  const selected = useMemo(
    () => questions.find((question) => question.id === selectedId) ?? questions[0] ?? null,
    [questions, selectedId]
  );

  useEffect(() => {
    if (account.profile.role !== "admin") {
      setLoading(false);
      setStatus("Admin access required.");
      return;
    }
    void refresh();
  }, [account.profile.role]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setSelectedId(selected.id);
    setReviewStatus(selected.review_status);
    setNotes(selected.reviewer_notes);
  }, [selected?.id]);

  async function refresh() {
    setLoading(true);
    try {
      const queue = await listReviewQueue();
      setQuestions(queue);
      setSelectedId((current) => current ?? queue[0]?.id ?? null);
      setStatus("Review queue loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Review queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function saveReview() {
    if (!selected) {
      return;
    }
    setStatus("Saving review...");
    try {
      const updated = await updateCreatedQuestionReview({
        questionId: selected.id,
        reviewerId: account.user.id,
        status: reviewStatus,
        notes
      });
      setQuestions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setStatus("Review saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Review could not be saved.");
    }
  }

  return (
    <main className="app-shell">
      <AppHeader title="Admin Review" account={account} onSignOut={onSignOut} searchId="admin-profile-search" />

      {account.profile.role !== "admin" ? (
        <section className="profile-workspace">
          <div className="empty-state">Admin access is required to review created questions.</div>
        </section>
      ) : loading ? (
        <section className="profile-workspace">
          <div className="empty-state">Loading review queue...</div>
        </section>
      ) : (
        <section className="admin-workspace">
          <aside className="sidebar admin-sidebar">
            <div className="sidebar-header">
              <strong>Created questions</strong>
              <span>{questions.length}</span>
            </div>
            <div className="question-list">
              {questions.map((question) => (
                <button
                  className={selected?.id === question.id ? "question-link active" : "question-link"}
                  key={question.id}
                  type="button"
                  onClick={() => setSelectedId(question.id)}
                >
                  <span>{question.title}</span>
                  <small>{question.review_status}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="admin-main">
            {selected ? (
              <>
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">Review</p>
                      <h2>{selected.title}</h2>
                    </div>
                    <span className="panel-meta">{selected.review_status}</span>
                  </div>
                  <div className="admin-review-form">
                    <label className="field">
                      <span>Status</span>
                      <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as CreatedQuestionStatus)}>
                        {REVIEW_STATUSES.map((item) => (
                          <option value={item} key={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Reviewer notes</span>
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                    </label>
                    <div className="admin-actions">
                      <button className="button primary" type="button" onClick={() => void saveReview()}>
                        Save Review
                      </button>
                      <button className="button secondary" type="button" onClick={() => void refresh()}>
                        Refresh
                      </button>
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">Task JSON</p>
                      <h2>Integrity preview</h2>
                    </div>
                    <span className="panel-meta">
                      {selected.task.train.length} train / {selected.task.test.length} test
                    </span>
                  </div>
                  <pre className="json-preview">{JSON.stringify(selected.task, null, 2)}</pre>
                </section>
              </>
            ) : (
              <div className="empty-state">No created questions are available for review.</div>
            )}
          </section>
        </section>
      )}

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}
