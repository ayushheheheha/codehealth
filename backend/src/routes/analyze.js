const express = require('express');

const router = express.Router();

// POST /api/analyze
// Placeholder: will run AI analysis over fetched repo contents via @anthropic-ai/sdk.
router.post('/', (req, res) => {
  res.status(501).json({
    error: 'Not implemented',
    message: 'analyze endpoint is a placeholder.',
  });
});

module.exports = router;
