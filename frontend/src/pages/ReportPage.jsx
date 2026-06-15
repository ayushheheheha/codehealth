import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';

import { mockReport } from '../mockData';
import RepoHeader from '../components/RepoHeader';
import ScoreRing from '../components/ScoreRing';
import CategoryCards from '../components/CategoryCards';
import TopPriorities from '../components/TopPriorities';
import IssuesSummary from '../components/IssuesSummary';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function ReportPage() {
  const [searchParams] = useSearchParams();
  const repoUrl = searchParams.get('repo');
  const isDemo = !repoUrl;

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);

  useEffect(() => {
    // No ?repo in the URL → show mock data so the UI is previewable.
    if (!repoUrl) {
      setReport(mockReport);
      setError(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    setSelectedPath(null);

    axios
      .post(`${API_URL}/api/analyze`, { repoUrl })
      .then((res) => {
        if (!cancelled) setReport(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err.response?.data?.message ||
          err.message ||
          'Failed to analyze the repository. Is the backend running?';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoUrl]);

  return (
    <div className="report-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◐</span>
          <span className="brand-name">CodeHealth</span>
        </div>
        <nav className="side-nav">
          <span className="side-nav-item active">Overview</span>
          <span className="side-nav-item is-disabled">Files</span>
          <span className="side-nav-item is-disabled">Insights</span>
          <span className="side-nav-item is-disabled">History</span>
        </nav>
        <div className="sidebar-foot">
          {report?.aiProvider && (
            <span className="ai-badge">AI: {report.aiProvider}</span>
          )}
        </div>
      </aside>

      <main className="report-main">
        {loading && <LoadingState repoUrl={repoUrl} />}

        {error && !loading && <ErrorState message={error} repoUrl={repoUrl} />}

        {report && !loading && !error && (
          <>
            {isDemo && (
              <div className="demo-banner">
                Showing <strong>demo data</strong>. Append{' '}
                <code>?repo=https://github.com/owner/repo</code> to analyze a real repository.
              </div>
            )}

            {(report.partial || report.aiSkipped) && (
              <div className="notice-banner">
                {report.aiSkipped
                  ? 'AI analysis was skipped (no GEMINI_API_KEY) — showing static analysis only.'
                  : `AI analysis was partial (${report.partialReason || 'incomplete'}).`}
              </div>
            )}

            <RepoHeader repo={report.repo} stats={report.stats} />

            <section className="dashboard-row">
              <div className="card score-card">
                <ScoreRing score={report.scores?.overall ?? 0} />
              </div>
              <div className="card categories-card">
                <CategoryCards scores={report.scores} />
              </div>
            </section>

            <TopPriorities priorities={report.topPriorities} />

            <IssuesSummary
              fileReports={report.fileReports}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          </>
        )}
      </main>
    </div>
  );
}

function LoadingState({ repoUrl }) {
  return (
    <div className="state-panel">
      <div className="spinner" aria-hidden="true" />
      <h2>Analyzing repository…</h2>
      {repoUrl && <p className="state-sub mono">{repoUrl}</p>}
      <p className="state-hint">Fetching files, running static checks, and asking the AI reviewer.</p>
    </div>
  );
}

function ErrorState({ message, repoUrl }) {
  return (
    <div className="state-panel">
      <div className="state-icon error" aria-hidden="true">!</div>
      <h2>Analysis failed</h2>
      {repoUrl && <p className="state-sub mono">{repoUrl}</p>}
      <p className="state-error-msg">{message}</p>
    </div>
  );
}

export default ReportPage;
