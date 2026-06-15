// Realistic fake analysis report matching the backend /api/analyze response
// shape. Used to build/preview the UI without a running backend.
//
// Issue shape: { type, severity, line, message, suggestion, source }
//   type:     security | complexity | smell | style | documentation | performance
//   severity: critical | warning | info
//   source:   static | ai

export const mockReport = {
  repo: {
    owner: 'acme',
    name: 'payment-service',
    description: 'Node.js payment-processing microservice with Stripe integration',
    language: 'JavaScript',
    stars: 1284,
    forks: 143,
    lastUpdated: '2026-05-28T14:22:10Z',
    defaultBranch: 'main',
  },
  scores: {
    overall: 68,
    security: 45,
    complexity: 62,
    maintainability: 78,
    documentation: 85,
  },
  fileReports: [
    {
      path: 'src/index.js',
      healthScore: 88,
      summary:
        'Clean entry point that wires up middleware and routes. The bootstrap function is doing a bit too much and would read better split into smaller steps.',
      issues: [
        {
          type: 'complexity',
          severity: 'warning',
          line: 42,
          message: 'Function `bootstrap` exceeds 40 lines.',
          suggestion: 'Split startup (config, db, routes, listen) into smaller functions.',
          source: 'static',
        },
      ],
    },
    {
      path: 'src/services/paymentProcessor.js',
      healthScore: 41,
      summary:
        'Core payment logic with serious security gaps: a hardcoded secret and card data reaching the logs. Also contains a blocking crypto call on the hot path.',
      issues: [
        {
          type: 'security',
          severity: 'critical',
          line: 23,
          message: 'Hardcoded Stripe secret key detected.',
          suggestion: 'Move the key to an environment variable and rotate the exposed one.',
          source: 'static',
        },
        {
          type: 'security',
          severity: 'critical',
          line: 88,
          message: 'Full card number written to the application log.',
          suggestion: 'Remove the log line or redact all but the last 4 digits.',
          source: 'ai',
        },
        {
          type: 'complexity',
          severity: 'warning',
          line: 55,
          message: 'Retry logic is nested 5 levels deep.',
          suggestion: 'Extract the retry loop into a helper using early returns.',
          source: 'static',
        },
        {
          type: 'performance',
          severity: 'warning',
          line: 120,
          message: 'Synchronous crypto.pbkdf2Sync blocks the event loop on each request.',
          suggestion: 'Use the asynchronous crypto.pbkdf2 instead.',
          source: 'ai',
        },
        {
          type: 'style',
          severity: 'info',
          line: 7,
          message: 'Unused import `lodash`.',
          suggestion: 'Remove the unused import.',
          source: 'ai',
        },
      ],
    },
    {
      path: 'src/routes/webhooks.js',
      healthScore: 64,
      summary:
        'Handles inbound Stripe webhooks but does not verify signatures, and the handler has grown long. Documentation of the event contract is missing.',
      issues: [
        {
          type: 'security',
          severity: 'warning',
          line: 31,
          message: 'Webhook payload processed without verifying the Stripe-Signature header.',
          suggestion: 'Verify the signature with the webhook signing secret before handling events.',
          source: 'ai',
        },
        {
          type: 'complexity',
          severity: 'warning',
          line: 12,
          message: 'Function `handleWebhook` exceeds 40 lines.',
          suggestion: 'Route each event type to its own handler function.',
          source: 'static',
        },
        {
          type: 'documentation',
          severity: 'info',
          line: 1,
          message: 'Missing module-level description of the webhook contract.',
          suggestion: 'Add a short comment describing supported events and expected payloads.',
          source: 'ai',
        },
      ],
    },
    {
      path: 'src/utils/validation.js',
      healthScore: 82,
      summary:
        'Small, focused validation helpers. Mostly healthy aside from some stale TODOs and an inconsistent return type.',
      issues: [
        {
          type: 'smell',
          severity: 'info',
          line: 18,
          message: '3 TODO/FIXME/HACK comment(s) found.',
          suggestion: 'Resolve or remove the stale TODO comments.',
          source: 'static',
        },
        {
          type: 'style',
          severity: 'info',
          line: 45,
          message: '`validate` returns either a boolean or a string.',
          suggestion: 'Return a consistent shape (e.g. always a boolean, or always an errors array).',
          source: 'ai',
        },
      ],
    },
    {
      path: 'src/db/queries.js',
      healthScore: 52,
      summary:
        'Database access layer with a string-concatenated query that is open to SQL injection. The file is also large and has duplicated query-building logic.',
      issues: [
        {
          type: 'security',
          severity: 'critical',
          line: 34,
          message: 'SQL query built with string concatenation — injection risk.',
          suggestion: 'Use parameterized queries / prepared statements.',
          source: 'static',
        },
        {
          type: 'complexity',
          severity: 'info',
          line: 1,
          message: 'File has 412 lines (over 300).',
          suggestion: 'Split queries by domain into separate modules.',
          source: 'static',
        },
        {
          type: 'complexity',
          severity: 'warning',
          line: 78,
          message: 'Query-building logic is duplicated across three functions.',
          suggestion: 'Extract a shared query builder.',
          source: 'ai',
        },
      ],
    },
  ],
  overallInsights: [
    'Documentation and overall structure are solid, but security hygiene around secrets and input handling is the weakest area.',
    'Long, deeply-nested functions are concentrated in the payment and webhook paths.',
    'AI review flagged a blocking synchronous crypto call that can degrade throughput under load.',
  ],
  topPriorities: [
    'Remove the hardcoded Stripe secret key in src/services/paymentProcessor.js and rotate it immediately.',
    'Switch src/db/queries.js to parameterized queries to close the SQL injection vector.',
    'Verify the Stripe-Signature header before processing webhooks in src/routes/webhooks.js.',
  ],
  stats: {
    totalFiles: 5,
    totalIssues: 14,
    criticalCount: 3,
    warningCount: 6,
    infoCount: 5,
    analysisTime: 4213,
  },
  aiProvider: 'gemini-1.5-flash',
};

export default mockReport;
