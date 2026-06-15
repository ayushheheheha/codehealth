const express = require('express');

const router = express.Router();

// POST /api/fetch-repo
// Placeholder: will fetch repository metadata/contents from GitHub via @octokit/rest.
router.post('/', (req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    message: 'fetch-repo endpoint is a placeholder.',
  });
});

module.exports = router;
