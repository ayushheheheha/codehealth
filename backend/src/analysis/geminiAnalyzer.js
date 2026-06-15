/**
 * AI code review using Google Gemini (free tier).
 *
 *   analyzeWithGemini(files, staticIssues)
 *     -> { fileReports, overallInsights, topPriorities, [partial], [reason] }
 *
 * `files`        : [{ path, content, size, extension }]
 * `staticIssues` : { [path]: Issue[] }  — used only to prioritize which files
 *                  to send to the model (more issues + larger = higher priority).
 *
 * The function never throws: on a parse failure it returns an empty structure,
 * on a 429 it returns whatever it has plus { partial: true, reason: "rate_limited" }.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL_NAME = 'gemini-1.5-flash';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// --- Tuning ---
const MAX_FILES = 10; // top N prioritized files sent to the model
const MAX_LINES_PER_FILE = 200; // truncate longer files
const BATCH_SIZE = 5; // files per generateContent call
const BATCH_DELAY_MS = 1000; // delay between batches (free tier ~15 RPM)
const ISSUE_WEIGHT = 1000; // each static issue is "worth" this many bytes when ranking

const EMPTY_RESULT = { fileReports: [], overallInsights: [], topPriorities: [] };

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function truncateToLines(content, maxLines) {
  const lines = String(content || '').split(/\r?\n/);
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join('\n')}\n... [truncated: ${lines.length - maxLines} more lines]`;
}

function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  const text = `${err.status || ''} ${err.message || err}`;
  return /\b429\b|too many requests|rate.?limit|quota|resource_exhausted/i.test(text);
}

// Pick the top files by a combined "issue count + size" score.
function prioritizeFiles(files, staticIssues) {
  const issues = staticIssues || {};
  return [...files]
    .map((f) => {
      const issueCount = Array.isArray(issues[f.path]) ? issues[f.path].length : 0;
      const size = typeof f.size === 'number' ? f.size : (f.content ? f.content.length : 0);
      return { file: f, score: issueCount * ISSUE_WEIGHT + size };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES)
    .map((entry) => ({
      ...entry.file,
      content: truncateToLines(entry.file.content, MAX_LINES_PER_FILE),
    }));
}

function buildPrompt(batchFiles) {
  const fileBlocks = batchFiles
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n`)
    .join('\n');

  return `You are a senior software engineer doing a code review. Analyze the code files below
and respond ONLY with a valid JSON object — no markdown fences, no explanation,
just raw JSON.

Return this exact structure:
{
  "fileReports": [
    {
      "path": "src/index.js",
      "issues": [
        {
          "type": "security|complexity|style|documentation|performance",
          "severity": "critical|warning|info",
          "line": 42,
          "message": "Clear description of the issue",
          "suggestion": "Specific fix or improvement"
        }
      ],
      "summary": "2-3 sentence overall assessment of this file"
    }
  ],
  "overallInsights": ["Key observation about the codebase"],
  "topPriorities": ["Most important thing to fix first"]
}

Files to analyze:
${fileBlocks}`;
}

// Strip markdown fences / stray prose and JSON.parse. Returns the empty
// structure if parsing fails.
function parseGeminiResponse(text) {
  if (!text || typeof text !== 'string') return { ...EMPTY_RESULT };

  let cleaned = text.trim();
  // Remove a leading ```json / ``` fence and a trailing ``` fence.
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If there's surrounding prose, slice to the outermost { ... }.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < cleaned.length - 1)) {
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  }

  try {
    const obj = JSON.parse(cleaned);
    return {
      fileReports: Array.isArray(obj.fileReports) ? obj.fileReports : [],
      overallInsights: Array.isArray(obj.overallInsights) ? obj.overallInsights : [],
      topPriorities: Array.isArray(obj.topPriorities) ? obj.topPriorities : [],
    };
  } catch (e) {
    console.warn(`[geminiAnalyzer] Failed to parse model response as JSON: ${e.message}`);
    return { ...EMPTY_RESULT };
  }
}

function dedupe(arr) {
  return [...new Set(arr.filter((x) => typeof x === 'string' && x.trim()))];
}

// --- Public API ---

async function analyzeWithGemini(files, staticIssues) {
  if (!Array.isArray(files) || files.length === 0) {
    return { ...EMPTY_RESULT };
  }

  // No key → skip the API entirely; the pipeline falls back to static-only.
  if (!process.env.GEMINI_API_KEY) {
    return { ...EMPTY_RESULT, skipped: true, reason: 'no_api_key' };
  }

  try {
    const prioritized = prioritizeFiles(files, staticIssues);
    const batches = chunk(prioritized, BATCH_SIZE);

    const merged = { fileReports: [], overallInsights: [], topPriorities: [] };
    let partial = false;
    let reason = null;

    for (let b = 0; b < batches.length; b += 1) {
      // Delay between batches to respect the free-tier rate limit (~15 RPM).
      if (b > 0) await sleep(BATCH_DELAY_MS);

      const prompt = buildPrompt(batches[b]);
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = parseGeminiResponse(text);
        merged.fileReports.push(...parsed.fileReports);
        merged.overallInsights.push(...parsed.overallInsights);
        merged.topPriorities.push(...parsed.topPriorities);
      } catch (err) {
        if (isRateLimitError(err)) {
          console.warn('[geminiAnalyzer] Rate limited (429) — returning partial results.');
          partial = true;
          reason = 'rate_limited';
          break;
        }
        console.warn(`[geminiAnalyzer] Batch ${b + 1} failed: ${err.message}`);
        partial = true;
        reason = reason || 'error';
      }
    }

    merged.overallInsights = dedupe(merged.overallInsights);
    merged.topPriorities = dedupe(merged.topPriorities);

    if (partial) return { ...merged, partial: true, reason };
    return merged;
  } catch (err) {
    // Catastrophic / unexpected failure — degrade gracefully.
    console.error(`[geminiAnalyzer] Unexpected failure: ${err.message}`);
    return { ...EMPTY_RESULT, partial: true, reason: 'error' };
  }
}

module.exports = { analyzeWithGemini, MODEL_NAME };

// Exported for unit testing
module.exports.parseGeminiResponse = parseGeminiResponse;
module.exports.prioritizeFiles = prioritizeFiles;
module.exports.buildPrompt = buildPrompt;
