const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Octokit } = require('@octokit/rest');

const router = express.Router();

// --- Configuration ---
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java',
  '.go', '.php', '.rb', '.rs', '.cpp', '.c', '.cs',
]);

// These are directory names; we exclude a file if any of its path segments
// matches one of them (so `build/app.js` is excluded but `src/buildUtils.js` is not).
const EXCLUDED_DIR_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor',
  '__pycache__', '.next', 'coverage',
]);

const MAX_FILE_SIZE = 100 * 1024; // 100 KB
const MAX_FILES = 50;
const CONTENT_BATCH_SIZE = 10;

// --- GitHub client ---
// Works without a token (lower, unauthenticated rate limits); uses GITHUB_TOKEN
// from .env when available for higher limits and private-repo access.
const githubToken = process.env.GITHUB_TOKEN || undefined;
const octokit = new Octokit(githubToken ? { auth: githubToken } : {});

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

// --- Helpers ---

// Extract { owner, repo } from the supported GitHub URL formats.
function parseRepoUrl(repoUrl) {
  if (typeof repoUrl !== 'string') return null;
  const trimmed = repoUrl.trim();
  // Capture owner and repo, stopping the repo segment before any /tree/... , query or hash.
  const match = trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s?#]+)/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, ''); // strip trailing .git
  if (!owner || !repo) return null;
  return { owner, repo };
}

// True if the file lives inside one of the excluded directories.
function isExcludedPath(filePath) {
  return filePath.split('/').some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

// Map an Octokit/network error into a clear { status, message } for the client.
function mapGitHubError(err) {
  const status = err.status || (err.response && err.response.status);
  const headers = (err.response && err.response.headers) || {};

  if (status === 404) {
    return {
      status: 404,
      message: githubToken
        ? 'Repository not found, or your GITHUB_TOKEN does not have access to it.'
        : 'Repository not found. If it is private, set a GITHUB_TOKEN in the backend .env file.',
    };
  }

  if (status === 401) {
    return { status: 401, message: 'GitHub authentication failed. Check that GITHUB_TOKEN is valid.' };
  }

  if (status === 403 || status === 429) {
    const remaining = headers['x-ratelimit-remaining'];
    if (status === 429 || remaining === '0' || remaining === 0) {
      let message = 'GitHub API rate limit exceeded.';
      if (!githubToken) {
        message += ' Set a GITHUB_TOKEN in the backend .env to get a much higher limit.';
      }
      const reset = headers['x-ratelimit-reset'];
      if (reset) {
        message += ` Limit resets at ${new Date(Number(reset) * 1000).toISOString()}.`;
      }
      return { status: 429, message };
    }
    return { status: 403, message: `GitHub denied the request: ${err.message}` };
  }

  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(err.code)) {
    return { status: 502, message: 'Network error while reaching GitHub. Check your internet connection.' };
  }

  return { status: 500, message: err.message || 'Unexpected error while fetching the repository.' };
}

// Run an async worker over items, at most `batchSize` concurrently.
async function fetchInBatches(items, batchSize, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const settled = await Promise.all(batch.map(worker));
    results.push(...settled);
  }
  return results;
}

// --- Route: POST /api/fetch-repo ---
router.post('/', fetchRepoLimiter, async (req, res) => {
  const { repoUrl } = req.body || {};

  if (!repoUrl) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'repoUrl is required in the request body.',
    });
  }

  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Could not parse a GitHub owner/repo from the provided repoUrl.',
    });
  }
  const { owner, repo } = parsed;

  try {
    // 1. Repo metadata
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    const repoInfo = {
      owner: repoData.owner.login,
      name: repoData.name,
      description: repoData.description,
      language: repoData.language,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      lastUpdated: repoData.updated_at,
      defaultBranch,
    };

    // 2. Recursive file tree on the default branch
    const { data: treeData } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: 'true',
    });

    if (treeData.truncated) {
      console.warn(
        `[fetch-repo] Tree for ${owner}/${repo} was truncated by GitHub; some files may be missing.`
      );
    }

    // 3. Code files = blobs with an allowed extension
    const codeBlobs = (treeData.tree || []).filter(
      (item) =>
        item.type === 'blob' &&
        ALLOWED_EXTENSIONS.has(path.extname(item.path).toLowerCase())
    );

    // 4. Filter out excluded directories and oversized files
    const eligible = codeBlobs.filter(
      (item) =>
        !isExcludedPath(item.path) &&
        typeof item.size === 'number' &&
        item.size <= MAX_FILE_SIZE
    );

    // 5. Cap at MAX_FILES, keeping the largest (more code = more to analyze)
    const selected = [...eligible]
      .sort((a, b) => b.size - a.size)
      .slice(0, MAX_FILES);

    // 6. Fetch raw content in batches of 10
    const fetched = await fetchInBatches(selected, CONTENT_BATCH_SIZE, async (item) => {
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: item.path,
          ref: defaultBranch,
        });
        if (!data || data.type !== 'file' || typeof data.content !== 'string') {
          return null;
        }
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return {
          path: item.path,
          content,
          size: item.size,
          extension: path.extname(item.path).toLowerCase(),
        };
      } catch (fileErr) {
        console.warn(`[fetch-repo] Failed to fetch ${item.path}: ${fileErr.message}`);
        return null;
      }
    });

    // 7. Build the response (drop any files whose content fetch failed)
    const files = fetched.filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));

    return res.json({
      repo: repoInfo,
      files,
      totalFiles: files.length,
      skippedFiles: codeBlobs.length - files.length,
    });
  } catch (err) {
    const mapped = mapGitHubError(err);
    console.error(`[fetch-repo] ${owner}/${repo} failed (${mapped.status}): ${err.message}`);
    return res.status(mapped.status).json({ error: 'Fetch failed', message: mapped.message });
  }
});

module.exports = router;

// Exported for unit testing
module.exports.parseRepoUrl = parseRepoUrl;
module.exports.isExcludedPath = isExcludedPath;
