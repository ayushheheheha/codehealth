import { formatDate, formatNumber } from '../lib/format';

function RepoHeader({ repo, stats }) {
  if (!repo) return null;

  return (
    <header className="repo-header">
      <div className="repo-header-main">
        {repo.owner && <div className="repo-owner">{repo.owner}</div>}
        <h1 className="repo-title">{repo.name || 'Unknown repository'}</h1>
        {repo.description && <p className="repo-desc">{repo.description}</p>}

        <div className="repo-pills">
          {repo.language && (
            <span className="pill">
              <span className="pill-dot" aria-hidden="true" />
              {repo.language}
            </span>
          )}
          <span className="pill">★ {formatNumber(repo.stars || 0)}</span>
          <span className="pill">Updated {formatDate(repo.lastUpdated)}</span>
        </div>

        <p className="repo-stat-line">
          Analyzed <strong>{stats?.totalFiles ?? 0}</strong> files ·{' '}
          Found <strong>{stats?.totalIssues ?? 0}</strong> issues
        </p>
      </div>

      <div className="repo-header-actions">
        <button className="btn btn-primary" type="button" disabled title="Coming soon">
          Re-analyze
        </button>
      </div>
    </header>
  );
}

export default RepoHeader;
