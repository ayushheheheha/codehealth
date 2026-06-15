/**
 * Rule-based static analysis run before sending code to Claude.
 *
 * These checks are intentionally heuristic (regex + brace/indent tracking, no
 * real parser). They are meant to catch obvious issues cheaply and give fast
 * initial feedback — not to be a sound compiler-grade analysis.
 *
 * Exports a single function: analyzeFile(filePath, content, extension)
 *   -> { issues: Issue[], metrics: object }
 *
 * Issue shape: { type, severity, message, line }
 *   type:     "security" | "complexity" | "smell"
 *   severity: "critical" | "warning" | "info"
 */

// --- Extension groups ---
const PY_EXTS = new Set(['.py']);
const RUBY_EXTS = new Set(['.rb']);
const JS_TS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx']);

// Languages whose blocks are delimited by braces.
const BRACE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.java', '.go', '.php', '.rs', '.cpp', '.c', '.cs',
]);

// --- Thresholds ---
const LONG_FUNCTION_LINES = 40;
const DEEP_NESTING_LEVEL = 5;
const LONG_FILE_LINES = 300;
const LONG_LINE_CHARS = 120;
const LONG_LINE_MIN_COUNT = 5; // flag only if MORE than this many long lines
const CONSOLE_MIN_COUNT = 3; // flag only if MORE than this many log statements
const COMMENTED_CODE_RUN = 3; // consecutive comment-code lines to flag

// --- Regexes shared across checks ---
const CONTROL_RE = /^\s*(?:\}\s*)?(?:else\s+)?(?:if|else|for|while|switch|catch|do|try|finally|with|return|case|default|switch)\b/;

const SECRET_PATTERNS = [
  /password\s*=\s*["'][^"']+["']/i,
  /api[_-]?key\s*=\s*["']/i,
  /secret\s*=\s*["']/i,
  /token\s*=\s*["']/i,
];

const SQL_CONCAT_PATTERNS = [
  // "SELECT ..." + something
  /["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^"']*["']\s*\+/i,
  // `SELECT ... ${ ... }`
  /`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeExt(extension, filePath) {
  let ext = (extension || '').toLowerCase();
  if (!ext && filePath) {
    const dot = filePath.lastIndexOf('.');
    if (dot >= 0) ext = filePath.slice(dot).toLowerCase();
  }
  if (ext && !ext.startsWith('.')) ext = `.${ext}`;
  return ext;
}

// 1-based line number for a character offset within text.
function lineFromIndex(text, idx) {
  return text.slice(0, idx).split(/\r?\n/).length;
}

// Infer the file's indentation unit (spaces per level) from its lines.
function detectIndentUnit(lines) {
  let min = Infinity;
  for (const line of lines) {
    const m = line.match(/^( +)\S/);
    if (m) min = Math.min(min, m[1].length);
  }
  if (!Number.isFinite(min)) return 2; // tabs-only or no indentation
  return Math.min(Math.max(min, 2), 8);
}

// Indentation level of a line (tabs count as one level each).
function indentLevel(line, unit) {
  const ws = (line.match(/^[ \t]*/) || [''])[0];
  let tabs = 0;
  let spaces = 0;
  for (const ch of ws) {
    if (ch === '\t') tabs += 1;
    else spaces += 1;
  }
  return tabs + Math.floor(spaces / unit);
}

// Does the text (a comment body) look like code rather than prose?
function looksLikeCode(text) {
  const t = text.trim();
  if (!t) return false;
  return /[;{}()[\]]|=>|==|!=|&&|\|\||\breturn\b|\bif\b|\bfor\b|\bwhile\b|\b(?:var|let|const|def|function|func|fn|class|import|public|private)\b|\w+\s*\(|\w+\s*=\s*\S/.test(
    t
  );
}

// ---------------------------------------------------------------------------
// Function-boundary detection (for the "long function" check)
// ---------------------------------------------------------------------------

function isBraceFunctionStart(line) {
  const t = line.trim();
  if (!t) return false;
  if (CONTROL_RE.test(line)) return false;
  if (/\bfunction\b/.test(t)) return true; // JS function declaration/expression
  if (/^func\b/.test(t)) return true; // Go
  if (/\bfn\s+\w+\s*\(/.test(t)) return true; // Rust
  if (/=>\s*\{/.test(t)) return true; // JS arrow with a block body
  // `name(args) {` on one line (method / shorthand)
  if (/\([^;]*\)\s*[:\w<>[\],\s]*\{\s*$/.test(t) && /\(/.test(t)) return true;
  // `type name(args)` with the brace on the next line (C-family). Needs two
  // tokens before `(` so plain calls like `doThing(x)` don't match.
  if (/^[A-Za-z_$][\w$<>[\],:*&~\s]*\s+[\w$~]+\s*\([^;{}]*\)\s*$/.test(t) && !t.includes('=')) {
    return true;
  }
  return false;
}

// End index (inclusive) of a brace-delimited region starting at startIdx, or
// null if no opening brace is found shortly after the start line.
function braceRegionEnd(lines, startIdx) {
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth += 1;
        opened = true;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
    if (opened && depth <= 0) return i;
    if (!opened && i - startIdx > 2) return null;
  }
  return opened ? lines.length - 1 : null;
}

function findBraceFunctions(lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isBraceFunctionStart(lines[i])) continue;
    const end = braceRegionEnd(lines, i);
    if (end === null) continue;
    regions.push({ start: i, end });
    i = end; // skip the body to avoid re-scanning nested functions
  }
  return regions;
}

function findPythonFunctions(lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:async\s+)?def\s+\w+\s*\(/);
    if (!m) continue;
    const base = m[1].length;
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue; // blank lines don't end the body
      const indent = (lines[j].match(/^[ \t]*/) || [''])[0].length;
      if (indent > base) end = j;
      else break;
    }
    regions.push({ start: i, end });
    i = end;
  }
  return regions;
}

function findRubyFunctions(lines) {
  const regions = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)def\s+/);
    if (!m) continue;
    const indent = m[1].length;
    let end = i;
    for (let j = i + 1; j < lines.length; j += 1) {
      const em = lines[j].match(/^(\s*)end\b/);
      if (em && em[1].length === indent) {
        end = j;
        break;
      }
      end = j;
    }
    regions.push({ start: i, end });
    i = end;
  }
  return regions;
}

function findFunctions(lines, ext) {
  if (PY_EXTS.has(ext)) return findPythonFunctions(lines);
  if (RUBY_EXTS.has(ext)) return findRubyFunctions(lines);
  if (BRACE_EXTS.has(ext)) return findBraceFunctions(lines);
  // Unknown language: best-effort brace scan.
  return findBraceFunctions(lines);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkComplexity(lines, ext, content, push) {
  // Long functions
  for (const region of findFunctions(lines, ext)) {
    if (region.end - region.start + 1 > LONG_FUNCTION_LINES) {
      push({
        type: 'complexity',
        severity: 'warning',
        message: 'Function exceeds 40 lines — consider splitting into smaller functions.',
        line: region.start + 1,
      });
    }
  }

  // Deep nesting (flag once, at the first line that reaches the threshold)
  const unit = detectIndentUnit(lines);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    if (indentLevel(lines[i], unit) >= DEEP_NESTING_LEVEL) {
      push({
        type: 'complexity',
        severity: 'warning',
        message: 'Deep nesting detected (5+ levels) — consider extracting nested logic.',
        line: i + 1,
      });
      break;
    }
  }

  // Long file
  if (lines.length > LONG_FILE_LINES) {
    push({
      type: 'complexity',
      severity: 'info',
      message: `File has ${lines.length} lines (over 300) — consider splitting into smaller modules.`,
      line: 1,
    });
  }

  // Long lines
  let longLineCount = 0;
  let firstLong = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > LONG_LINE_CHARS) {
      longLineCount += 1;
      if (firstLong < 0) firstLong = i;
    }
  }
  if (longLineCount > LONG_LINE_MIN_COUNT) {
    push({
      type: 'complexity',
      severity: 'info',
      message: `${longLineCount} lines exceed 120 characters.`,
      line: firstLong + 1,
    });
  }
}

function checkSecurity(lines, ext, content, push) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    if (SECRET_PATTERNS.some((re) => re.test(line))) {
      push({
        type: 'security',
        severity: 'critical',
        message: `Possible hardcoded secret detected on line ${lineNo}.`,
        line: lineNo,
      });
    }

    if (/\beval\s*\(/.test(line)) {
      push({
        type: 'security',
        severity: 'critical',
        message: 'Use of eval() detected — avoid executing dynamic code.',
        line: lineNo,
      });
    }

    if (JS_TS_EXTS.has(ext) && /\.innerHTML\s*=(?!=)/.test(line)) {
      push({
        type: 'security',
        severity: 'warning',
        message: 'Direct innerHTML assignment can lead to XSS.',
        line: lineNo,
      });
    }

    if (SQL_CONCAT_PATTERNS.some((re) => re.test(line))) {
      push({
        type: 'security',
        severity: 'warning',
        message: 'Possible SQL injection via string concatenation.',
        line: lineNo,
      });
    }
  }
}

function checkSmells(lines, ext, content, push) {
  // console.log / print statements
  const logRe = /\bconsole\.log\s*\(|(?<![.\w])print\s*\(/g;
  let logCount = 0;
  let firstLog = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const matches = lines[i].match(logRe);
    if (matches) {
      logCount += matches.length;
      if (firstLog < 0) firstLog = i;
    }
  }
  if (logCount > CONSOLE_MIN_COUNT) {
    push({
      type: 'smell',
      severity: 'info',
      message: `${logCount} console.log/print statements left in code.`,
      line: firstLog + 1,
    });
  }

  // TODO / FIXME / HACK comments (case-sensitive to avoid prose false positives)
  const todoRe = /\b(?:TODO|FIXME|HACK)\b/g;
  let todoCount = 0;
  let firstTodo = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const matches = lines[i].match(todoRe);
    if (matches) {
      todoCount += matches.length;
      if (firstTodo < 0) firstTodo = i;
    }
  }
  if (todoCount > 0) {
    push({
      type: 'smell',
      severity: 'info',
      message: `${todoCount} TODO/FIXME/HACK comment(s) found.`,
      line: firstTodo + 1,
    });
  }

  // Empty catch blocks (scan whole content so multi-line empties are caught)
  const emptyCatchRe = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = emptyCatchRe.exec(content)) !== null) {
    push({
      type: 'smell',
      severity: 'warning',
      message: 'Empty catch block silently swallows errors.',
      line: lineFromIndex(content, m.index),
    });
  }

  // Commented-out code: 3+ consecutive comment lines that look like code
  const prefixes = PY_EXTS.has(ext) || RUBY_EXTS.has(ext) ? ['#'] : ['//'];
  let runStart = -1;
  let runLen = 0;
  const flushRun = () => {
    if (runLen >= COMMENTED_CODE_RUN) {
      push({
        type: 'smell',
        severity: 'info',
        message: 'Commented-out code block (3+ consecutive lines) — consider removing.',
        line: runStart + 1,
      });
    }
    runStart = -1;
    runLen = 0;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    const pfx = prefixes.find((p) => t.startsWith(p));
    if (pfx && looksLikeCode(t.slice(pfx.length))) {
      if (runLen === 0) runStart = i;
      runLen += 1;
    } else {
      flushRun();
    }
  }
  flushRun();
}

function computeMetrics(content, lines) {
  const blankLines = lines.filter((l) => l.trim() === '').length;
  const commentLines = lines.filter((l) => /^\s*(?:\/\/|#)/.test(l)).length;
  const functionCount = (content.match(/\b(?:function|def|func)\b/g) || []).length;
  const importCount = lines.filter(
    (l) =>
      /^\s*import\b/.test(l) ||
      /^\s*from\s+\S+\s+import\b/.test(l) ||
      /\brequire\s*\(/.test(l)
  ).length;

  return {
    lineCount: lines.length,
    blankLines,
    commentLines,
    functionCount,
    importCount,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function analyzeFile(filePath, content, extension) {
  const ext = normalizeExt(extension, filePath);
  const text = typeof content === 'string' ? content : '';
  const lines = text.split(/\r?\n/);

  const issues = [];
  const push = (issue) => issues.push(issue);

  checkComplexity(lines, ext, text, push);
  checkSecurity(lines, ext, text, push);
  checkSmells(lines, ext, text, push);

  const metrics = computeMetrics(text, lines);

  return { issues, metrics };
}

module.exports = { analyzeFile };
