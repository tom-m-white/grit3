import { useEffect, useMemo, useState } from "react";
import { AccountControls, AuthGate, type AppAccount } from "./account";
import { type BenchmarkRunBundle, listUserRuns } from "./benchmarkStore";
import { type CreatedQuestionRow, listUserCreatedQuestions } from "./createdQuestionsStore";
import { summarizeHumanSession } from "./humanBenchmarkSession";
import { appPath } from "./routes";

export function ProfileApp() {
  return (
    <AuthGate title="Sign in to view profile">
      {(account, controls) => <ProfileWorkspace account={account} onSignOut={controls.signOut} />}
    </AuthGate>
  );
}

function ProfileWorkspace({ account, onSignOut }: { account: AppAccount; onSignOut: () => Promise<void> }) {
  const [runs, setRuns] = useState<BenchmarkRunBundle[]>([]);
  const [createdQuestions, setCreatedQuestions] = useState<CreatedQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading profile...");
  const activeRun = runs.find((bundle) => bundle.run.status !== "completed") ?? null;
  const completedRuns = runs.filter((bundle) => bundle.run.status === "completed");
  const activeSummary = useMemo(
    () =>
      activeRun
        ? summarizeHumanSession(activeRun.records, activeRun.run.started_at, activeRun.run.completed_at)
        : null,
    [activeRun]
  );

  useEffect(() => {
    void refresh();
  }, [account.user.id]);

  async function refresh() {
    setLoading(true);
    try {
      const [nextRuns, nextQuestions] = await Promise.all([
        listUserRuns(account.user.id),
        listUserCreatedQuestions(account.user.id)
      ]);
      setRuns(nextRuns);
      setCreatedQuestions(nextQuestions);
      setStatus("Profile loaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">grit3</p>
          <h1>{account.profile.username}</h1>
        </div>
        <div className="topbar-actions">
          <a className="button secondary" href={appPath("/")}>
            Home
          </a>
          <a className="button secondary" href={appPath("/creator.html")}>
            Creator
          </a>
          <a className="button secondary" href={appPath("/human.html")}>
            Human Benchmark
          </a>
          <a className="button secondary" href={appPath("/results.html")}>
            Results
          </a>
          <AccountControls account={account} onSignOut={onSignOut} />
        </div>
      </header>

      <section className="profile-workspace">
        {loading ? (
          <div className="empty-state">Loading profile...</div>
        ) : (
          <>
            <section className="panel profile-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Benchmark</p>
                  <h2>{activeRun ? "Current progress" : "No active benchmark"}</h2>
                </div>
                <a className="button primary" href={appPath("/human.html")}>
                  {activeRun ? "Resume Benchmark" : "Start Benchmark"}
                </a>
              </div>
              <div className="summary-metrics profile-metrics">
                <Metric label="Active status" value={activeRun?.run.status ?? "none"} />
                <Metric
                  label="Completed"
                  value={activeSummary ? `${activeSummary.completedQuestions}/${activeSummary.totalQuestions}` : "0/25"}
                />
                <Metric
                  label="Weighted"
                  value={activeSummary ? `${activeSummary.correctWeight}/${activeSummary.totalWeight}` : "0/0"}
                />
                <Metric label="Run history" value={String(completedRuns.length)} />
              </div>
            </section>

            <section className="panel profile-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">History</p>
                  <h2>Benchmark runs</h2>
                </div>
              </div>
              <RunTable runs={runs} />
            </section>

            <section className="panel profile-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Creator</p>
                  <h2>Your created questions</h2>
                </div>
                <a className="button secondary" href={appPath("/creator.html")}>
                  Create Question
                </a>
              </div>
              <CreatedQuestionsTable questions={createdQuestions} />
            </section>
          </>
        )}
      </section>

      <div className="save-status" role="status">
        {status}
      </div>
    </main>
  );
}

function RunTable({ runs }: { runs: BenchmarkRunBundle[] }) {
  if (runs.length === 0) {
    return <div className="empty-state">No benchmark runs yet.</div>;
  }

  return (
    <div className="summary-table-wrap">
      <table className="summary-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Started</th>
            <th>Completed</th>
            <th>Correct</th>
            <th>Weighted</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((bundle) => {
            const summary = summarizeHumanSession(bundle.records, bundle.run.started_at, bundle.run.completed_at);
            return (
              <tr key={bundle.run.id}>
                <td>{bundle.run.status}</td>
                <td>{formatDate(bundle.run.started_at)}</td>
                <td>{bundle.run.completed_at ? formatDate(bundle.run.completed_at) : "in progress"}</td>
                <td>
                  {summary.correctQuestions}/{summary.totalQuestions}
                </td>
                <td>
                  {summary.correctWeight}/{summary.totalWeight}
                </td>
                <td>{summary.totalSubmissions}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreatedQuestionsTable({ questions }: { questions: CreatedQuestionRow[] }) {
  if (questions.length === 0) {
    return <div className="empty-state">No saved creator questions yet.</div>;
  }

  return (
    <div className="summary-table-wrap">
      <table className="summary-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Train</th>
            <th>Test</th>
            <th>Updated</th>
            <th>Reviewer notes</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((question) => (
            <tr key={question.id}>
              <td>{question.title}</td>
              <td>{question.review_status}</td>
              <td>{question.task.train.length}</td>
              <td>{question.task.test.length}</td>
              <td>{formatDate(question.updated_at)}</td>
              <td>{question.reviewer_notes || "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
