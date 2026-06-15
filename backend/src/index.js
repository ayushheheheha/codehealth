require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const repoRouter = require('./routes/repo');
const analyzeRouter = require('./routes/analyze');

const app = express();

const PORT = process.env.PORT || 5000;

// Environment variables loaded from .env
const { GITHUB_TOKEN, ANTHROPIC_API_KEY } = process.env;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Basic rate limiting on the API surface
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// --- Routes ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/fetch-repo', repoRouter);
app.use('/api/analyze', analyzeRouter);

// --- Server ---
app.listen(PORT, () => {
  console.log(`CodeHealth backend listening on http://localhost:${PORT}`);
  if (!GITHUB_TOKEN) {
    console.warn('  [warn] GITHUB_TOKEN is not set — GitHub requests may be rate limited.');
  }
  if (!ANTHROPIC_API_KEY) {
    console.warn('  [warn] ANTHROPIC_API_KEY is not set — analysis endpoint will not work.');
  }
});

module.exports = app;
