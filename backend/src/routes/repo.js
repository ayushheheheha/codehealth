const express = require('express');
const rateLimit = require('express-rate-limit');
const { fetchRepoData, parseRepoUrl, isExcludedPath } = require('../services/githubService');

const router = express.Router();

// --- Per-route rate limiting: max 10 requests / 15 min / IP ---
const fetchRepoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit reached: max 10 repository fetches per 15 minutes. Please wait and try again.',
  },
});

// --- Route: POST /api/fetch-repo ---
router.post('/', fetchRepoLimiter, async (req, res) => {
  const { repoUrl } = req.body || {};

  if (!repoUrl) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'repoUrl is required in the request body.',
    });
  }

  try {
    const data = await fetchRepoData(repoUrl);
    return res.json(data);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: 'Fetch failed', message: err.message });
  }
});

module.exports = router;

// Re-exported for unit testing
module.exports.parseRepoUrl = parseRepoUrl;
module.exports.isExcludedPath = isExcludedPath;
