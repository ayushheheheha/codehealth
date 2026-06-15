const express = require('express');
const rateLimit = require('express-rate-limit');

const { fetchRepoData } = require('../services/githubService');
const { analyzeFile } = require('../analysis/staticAnalyzer');
const { analyzeWithGemini, MODEL_NAME } = require('../analysis/geminiAnalyzer');
const { calculateScores } = require('../analysis/scoreCalculator');

const router = express.Router();

// --- Config ---
const ANALYZE_BUDGET_MS = 30 * 1000; // overall soft deadline for the analyze call
const CACHE_TTL_MS = 60 * 60 * 1000; // results valid for 1 hour
const CACHE_MAX = 10; // keep the last 10 repos

// --- Per-route rate limiting (analysis is expensive) ---
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit reached: max 10 analyses per 15 minutes. Please wait and try again.',
  },
});

// --- In-memory LRU cache (repoUrl -> { expires, payload }) ---
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  // Refresh recency (LRU).
  cache.delete(key);
  cache.set(key, entry);
  return entry.payload;
}

function setCached(key, payload) {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, payload });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Resolve to `fallback` if `promise` doesn't settle within `ms`.
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

const tagSource = (source) => (issue) => ({ ...issue, source });

// --- Route: POST /api/analyze ---
router.post('/', analyzeLimiter, async (req, res) => {
  const { repoUrl } = req.body || {};

  if (!repoUrl) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'repoUrl is required in the request body.',
    });
  }

  // Serve from cache if fresh.
  const cached = getCached(repoUrl);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  const startTime = Date.now();

  try {
    // a. Fetch repo files (shared GitHub service)
    const { repo, files } = await fetchRepoData(repoUrl);

    // b. Static analysis on every file
    const staticByPath = {};
    for (const file of files) {
      const { issues } = analyzeFile(file.path, file.content, file.extension);
      staticByPath[file.path] = issues;
    }

    // c. AI analysis on prioritized files, bounded by the remaining time budget
    const remaining = ANALYZE_BUDGET_MS - (Date.now() - startTime);
    const timeoutFallback = { fileReports: [], overallInsights: [], topPriorities: [], partial: true, reason: 'timeout' };
    const aiResult =
      remaining > 0
        ? await withTimeout(analyzeWithGemini(files, staticByPath), remaining, timeoutFallback)
        : timeoutFallback;

    // d. Merge static + AI issues per file
    const aiByPath = {};
    for (const fr of aiResult.fileReports || []) {
      if (fr && typeof fr.path === 'string') aiByPath[fr.path] = fr;
    }

    const fileReports = files.map((file) => {
      const staticIssues = (staticByPath[file.path] || []).map(tagSource('static'));
      const ai = aiByPath[file.path];
      const aiIssues = (ai && Array.isArray(ai.issues) ? ai.issues : []).map(tagSource('ai'));
      const issues = [...staticIssues, ...aiIssues];
      return {
        path: file.path,
        issues,
        summary: ai && typeof ai.summary === 'string' ? ai.summary : '',
        healthScore: calculateScores(issues).overall,
      };
    });

    // e. Scores over all combined issues
    const allIssues = fileReports.flatMap((fr) => fr.issues);
    const scores = calculateScores(allIssues);

    // f. Assemble the report
    const countSeverity = (sev) => allIssues.filter((i) => i.severity === sev).length;
    const payload = {
      repo,
      scores,
      fileReports,
      overallInsights: aiResult.overallInsights || [],
      topPriorities: aiResult.topPriorities || [],
      stats: {
        totalFiles: files.length,
        totalIssues: allIssues.length,
        criticalCount: countSeverity('critical'),
        warningCount: countSeverity('warning'),
        infoCount: countSeverity('info'),
        analysisTime: Date.now() - startTime,
      },
      aiProvider: MODEL_NAME,
    };

    // Surface AI status so the client knows the report is static-only or partial.
    if (aiResult.skipped) {
      payload.aiSkipped = true;
      payload.aiSkippedReason = aiResult.reason || 'unknown';
    }
    if (aiResult.partial) {
      payload.partial = true;
      payload.partialReason = aiResult.reason || 'unknown';
    }

    // Only cache complete results (don't lock in a timed-out / rate-limited run).
    if (!payload.partial) {
      setCached(repoUrl, payload);
    }

    return res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: 'Analysis failed', message: err.message });
  }
});

module.exports = router;
