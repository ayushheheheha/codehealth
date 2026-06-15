// Shared scoring/formatting helpers used across the report components.

// Map a 0-100 score to a tier. Green 80+, amber 50-79, red <50.
export function scoreTier(score) {
  const s = Number(score) || 0;
  if (s >= 80) return 'good';
  if (s >= 50) return 'warn';
  return 'bad';
}

// CSS variable for a score's color (works as an inline style value).
export function scoreColor(score) {
  return `var(--score-${scoreTier(score)})`;
}

// Health badge label for a file/score.
export function healthLabel(score) {
  const tier = scoreTier(score);
  if (tier === 'good') return 'Healthy';
  if (tier === 'warn') return 'Needs Work';
  return 'Critical';
}

// Human-friendly date, e.g. "May 28, 2026".
export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Thousands-separated number, e.g. 1284 -> "1,284".
export function formatNumber(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '0';
  return n.toLocaleString();
}

// Count issues by severity for a file's issue list.
export function countSeverities(issues = []) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) counts[issue.severity] += 1;
  }
  return counts;
}
