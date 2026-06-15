import { useMemo, useState } from 'react';
import { countSeverities, healthLabel, scoreTier } from '../lib/format';

const COLUMNS = [
  { key: 'path', label: 'File', align: 'left' },
  { key: 'critical', label: 'Critical', align: 'center' },
  { key: 'warning', label: 'Warnings', align: 'center' },
  { key: 'info', label: 'Info', align: 'center' },
  { key: 'health', label: 'Health', align: 'center' },
];

function IssuesSummary({ fileReports = [], selectedPath, onSelect }) {
  const [sortKey, setSortKey] = useState('critical');
  const [sortDir, setSortDir] = useState('desc');

  // Flatten each file report into a row with severity counts.
  const rows = useMemo(
    () =>
      fileReports.map((fr) => {
        const counts = countSeverities(fr.issues);
        return {
          path: fr.path,
          critical: counts.critical,
          warning: counts.warning,
          info: counts.info,
          health: fr.healthScore ?? 100,
        };
      }),
    [fileReports]
  );

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      if (sortKey === 'path') {
        return sortDir === 'asc'
          ? a.path.localeCompare(b.path)
          : b.path.localeCompare(a.path);
      }
      const diff = a[sortKey] - b[sortKey];
      return sortDir === 'asc' ? diff : -diff;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Text sorts ascending by default; numeric columns descending (worst first).
      setSortDir(key === 'path' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key) => {
    if (key !== sortKey) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <section className="section issues-summary">
      <h2 className="section-title">Files</h2>
      <div className="table-wrap">
        <table className="issues-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`col-${col.align} ${sortKey === col.key ? 'sorted' : ''}`}
                  onClick={() => toggleSort(col.key)}
                  aria-sort={
                    sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  {col.label}
                  <span className="sort-indicator">{sortIndicator(col.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="table-empty">
                  No files were analyzed.
                </td>
              </tr>
            )}
            {sorted.map((row) => {
              const isSelected = row.path === selectedPath;
              return (
                <tr
                  key={row.path}
                  className={`issue-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelect && onSelect(row.path)}
                >
                  <td className="col-left file-cell">{row.path}</td>
                  <td className="col-center">
                    <CountCell value={row.critical} severity="critical" />
                  </td>
                  <td className="col-center">
                    <CountCell value={row.warning} severity="warning" />
                  </td>
                  <td className="col-center">
                    <CountCell value={row.info} severity="info" />
                  </td>
                  <td className="col-center">
                    <span className={`health-badge tier-${scoreTier(row.health)}`}>
                      {healthLabel(row.health)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// A severity count: dimmed when zero, colored chip when non-zero.
function CountCell({ value, severity }) {
  if (!value) return <span className="count-zero">0</span>;
  return <span className={`count-chip sev-${severity}`}>{value}</span>;
}

export default IssuesSummary;
