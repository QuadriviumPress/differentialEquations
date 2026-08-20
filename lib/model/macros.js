// model/macros.js — the book's own \newcommand definitions, handed to MathJax.
//
// wtrench.sty and the preamble define ~40 macros that appear inside math:
// \twobytwo, \threecol, \matfunc, \dst, \lims, \set, \df and friends. Rather
// than reimplement them, the build extracts the definitions from the source and
// gives them to MathJax verbatim, so math renders exactly as LaTeX sets it —
// and stays correct if the source distribution is ever updated.
//
// Macros whose bodies are text-mode layout (\vskip, \fbox, lists) are excluded:
// they never appear in math, and shipping them would only add weight.
import fs from 'node:fs';
import path from 'node:path';
import { srcRoot, bookFile } from '../paths.js';
import { extractBraceGroup } from '../parse/tex-utils.js';

const DEFINE_RE = /\\(?:new|renew|provide)command\s*\{?\s*\\([a-zA-Z]+)\s*\}?\s*(?:\[(\d+)\])?\s*(?:\[[^\]]*\])?\s*(?=\{)/g;

// Macros the HTML renderer owns (they are prose, not math) plus one that would
// shadow a MathJax builtin: \bbox is MathJax's own boxing command.
const RENDERER_OWNED = new Set(['hint', 'note', 'part', 'bbox', 'rmdefault']);

/** Commands that only make sense in text mode; a macro using one is not math. */
const TEXT_ONLY =
  /\\(?:vskip|hskip|vspace|hspace|noindent|par\b|newpage|centerline|hrule|hrulefill|fbox|framebox|begin\{(?:list|trivlist|tabular|quote|center|figure)\}|setcounter|refstepcounter|usecounter|label|pageref|item\b|underbar|strut|vbox|hbox|vrule|kern|topsep|labelwidth|leftmargin|itemsep|@)/;

/**
 * @returns {{ macros: Record<string, string|[string, number]>, skipped: string[] }}
 * in MathJax's `tex.macros` format: name -> body, or name -> [body, argCount].
 */
export function extractMacros(root) {
  const sources = [
    fs.readFileSync(bookFile(root), 'utf8').replace(/\r\n/g, '\n').split('\\begin{document}')[0],
    fs.readFileSync(path.join(srcRoot(root), 'wtrench.sty'), 'utf8').replace(/\r\n/g, '\n'),
  ];

  const macros = {};
  const skipped = [];

  for (const source of sources) {
    DEFINE_RE.lastIndex = 0;
    let m;
    while ((m = DEFINE_RE.exec(source))) {
      const [, name, argCount] = m;
      const group = extractBraceGroup(source, DEFINE_RE.lastIndex);
      if (!group) continue;
      DEFINE_RE.lastIndex = group.end;

      const body = group.value.replace(/\s+/g, ' ').trim();
      // A body containing $ switches mode inside the expansion, which MathJax
      // cannot follow.
      if (TEXT_ONLY.test(body) || body === '' || body.includes('$') || RENDERER_OWNED.has(name)) {
        skipped.push(name);
        continue;
      }
      macros[name] = argCount ? [body, Number(argCount)] : body;
    }
  }

  // Drop anything that expands to a macro we did not ship: it would fail at
  // typeset time rather than at build time.
  for (const [name, def] of Object.entries(macros)) {
    const body = Array.isArray(def) ? def[0] : def;
    for (const used of body.matchAll(/\\([a-zA-Z]+)/g)) {
      if (skipped.includes(used[1])) {
        delete macros[name];
        skipped.push(name);
        break;
      }
    }
  }

  return { macros, skipped: [...new Set(skipped)].sort() };
}
