// parse/answers.js — the "Answers to Selected Exercises" back matter.
//
// The section is a flat run of \answer{C.S.N} markers, each followed by that
// exercise's answer. The keys match the \label{exer:C.S.N} on the exercises
// themselves, so answers can be attached to their exercise as well as rendered
// as back matter — in the print edition the reader has to flip to p. 583.
//
// Group headings ("Section 1.2 Answers, pp. ...") and the running page numbers
// are print furniture and are dropped: the web edition regenerates headings
// from the keys, and page numbers have no meaning here.

import { extractBraceGroup } from './tex-utils.js';

const ANSWER_RE = /\\answer\{([^}]*)\}/g;

/**
 * Remove the "{\bf Section 8.3 Answers, pp. ...}" group headings, which are
 * brace-balanced and may nest \pageref groups, so a regex over [^{}] is not
 * enough. The web edition regenerates these headings from the answer keys.
 */
function stripGroupHeadings(tex) {
  let out = '';
  let i = 0;
  while (i < tex.length) {
    if (tex[i] === '{' && /^\{\s*\\bf\s*Section~/.test(tex.slice(i, i + 24))) {
      const group = extractBraceGroup(tex, i);
      if (group) {
        out = out.replace(/\\medskip\s*$/, '');
        i = group.end;
        continue;
      }
    }
    if (tex[i] === '\\') {
      out += tex.slice(i, i + 2);
      i += 2;
      continue;
    }
    out += tex[i];
    i++;
  }
  return out;
}

/**
 * Two answers (7.4.9 and 8.3.35) end with a `{\bf` that the source never closes.
 * An empty style group carries no content, so drop it.
 */
function dropDanglingGroup(tex, key, warnings) {
  const m = /\{\s*(?:\\[a-zA-Z]+\s*)*$/.exec(tex);
  if (!m) return tex;
  warnings.push(`answers: answer ${key} ends with an unclosed group (source defect; dropped)`);
  return tex.slice(0, m.index);
}

/** Print-only furniture that would otherwise render as stray text. */
function stripPrintFurniture(tex) {
  return stripGroupHeadings(tex)
    .replace(/\\centerline\{\d+\}/g, '')
    .replace(/\\enlargethispage\{[^}]*\}/g, '')
    .replace(/\\(newpage|thispagestyle\{[a-z]*\}|vskip[\d.]+p[ct])/g, '');
}

/**
 * @returns {{ answers: Map<string, string>, warnings: string[] }} answer TeX
 * keyed by exercise number ("1.2.1").
 */
export function parseAnswers(tex) {
  const warnings = [];
  const answers = new Map();
  if (!tex) return { answers, warnings };

  const hits = [];
  ANSWER_RE.lastIndex = 0;
  let m;
  while ((m = ANSWER_RE.exec(tex))) {
    hits.push({ key: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  if (hits.length === 0) warnings.push('answers: no \\answer entries found');

  hits.forEach((hit, i) => {
    const body = tex.slice(hit.end, i + 1 < hits.length ? hits[i + 1].start : tex.length);
    if (!/^\d+\.\d+\.\d+$/.test(hit.key)) {
      warnings.push(`answers: unexpected \\answer key "${hit.key}"`);
    }
    if (answers.has(hit.key)) {
      // 2.1.29 is answered twice in the source, identically; keep the first so
      // the build is deterministic.
      warnings.push(`answers: duplicate answer for exercise ${hit.key} (keeping the first)`);
      return;
    }
    answers.set(
      hit.key,
      dropDanglingGroup(stripPrintFurniture(body).trim(), hit.key, warnings)
    );
  });

  return { answers, warnings };
}
