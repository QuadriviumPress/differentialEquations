// Shared low-level LaTeX text helpers used by both the book parser (orbd.tex)
// and the module tokenizer.

/**
 * Strip a TeX comment from one line: truncate at the first % preceded by an
 * even number of backslashes (so \% survives, and \\% is a linebreak + comment).
 * Returns the line without the comment (trailing whitespace preserved as-is).
 */
export function stripLineComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '%') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) return line.slice(0, i);
  }
  return line;
}

/**
 * Extract a brace-balanced group from text, where text[start] === '{'.
 * Returns { value, end } with value the content between the outer braces and
 * end the index just past the closing brace, or null if unbalanced.
 */
export function extractBraceGroup(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') {
      i++; // skip escaped character (covers \{ and \})
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}
