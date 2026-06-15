/**
 * Turns a flat list of issues (from staticAnalyzer across all files) into an
 * overall health score plus per-category scores.
 *
 * calculateScores(allIssues) -> { overall, security, complexity, maintainability, documentation }
 *
 * Scoring: start at 100, subtract per issue by severity, floor at 0.
 *   critical -15, warning -5, info -2
 *
 * Category mapping (each issue counts toward exactly one category):
 *   security      <- type "security"
 *   complexity    <- type "complexity"
 *   maintainability <- type "smell" (code smells: console logs, empty catch, ...)
 *   documentation <- type "smell" that is comment-related (TODO/FIXME/HACK,
 *                    commented-out code)
 *
 * The overall score is computed from ALL issues together.
 */

const PENALTY = {
  critical: 15,
  warning: 5,
  info: 2,
};

function clamp(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Score a set of issues: start at 100, subtract penalties, floor at 0.
function scoreFrom(issues) {
  let score = 100;
  for (const issue of issues) {
    score -= PENALTY[issue && issue.severity] || 0;
  }
  return clamp(score);
}

// Which category an issue contributes to.
function categoryFor(issue) {
  if (!issue || typeof issue.type !== 'string') return null;
  switch (issue.type) {
    case 'security':
      return 'security';
    case 'complexity':
      return 'complexity';
    case 'smell':
      // Comment-hygiene smells count toward documentation; the rest toward
      // maintainability.
      return /\b(?:TODO|FIXME|HACK)\b|commented[- ]?out/i.test(issue.message || '')
        ? 'documentation'
        : 'maintainability';
    default:
      return null;
  }
}

function calculateScores(allIssues) {
  const issues = Array.isArray(allIssues) ? allIssues : [];

  const buckets = {
    security: [],
    complexity: [],
    maintainability: [],
    documentation: [],
  };

  for (const issue of issues) {
    const category = categoryFor(issue);
    if (category) buckets[category].push(issue);
  }

  return {
    overall: scoreFrom(issues),
    security: scoreFrom(buckets.security),
    complexity: scoreFrom(buckets.complexity),
    maintainability: scoreFrom(buckets.maintainability),
    documentation: scoreFrom(buckets.documentation),
  };
}

module.exports = { calculateScores };
