// model/book-index.js — the book's own back-of-book index (\begin{tindex}).
//
// Unlike a \index{}-generated index, Trench's is written out by hand as a flat
// list of \item / \subitem / \subsubitem entries whose page references are
// \pageref{label} — pointing at the very labels the rest of the build already
// resolves. So the web index links straight to the equation, theorem, example
// or exercise concerned instead of to a page number.
//
// Entry text is left as TeX and rendered by the caller through renderInline,
// which is what turns each \pageref into a link.

const ENTRY_RE = /\\(alphsep|subsubitem|subitem|item)\b/g;

/**
 * @returns {{ groups: Array<{letter: string, entries: Entry[]}>, warnings: string[] }}
 * where Entry is { tex, subs: Entry[] }.
 */
export function buildBookIndex(indexTex) {
  const warnings = [];
  const groups = [];
  if (!indexTex) {
    warnings.push('index: no tindex environment to build from');
    return { groups, warnings };
  }

  // The environment opens by defining its own letter-heading macro.
  const body = indexTex.replace(/\\newcommand\{\\alphsep\}(\[\d\])?\{[\s\S]*?\n/, '');

  const hits = [];
  ENTRY_RE.lastIndex = 0;
  let m;
  while ((m = ENTRY_RE.exec(body))) {
    hits.push({ kind: m[1], start: m.index, end: m.index + m[0].length });
  }

  let group = null;
  let lastItem = null;
  let lastSub = null;

  hits.forEach((hit, i) => {
    const raw = body.slice(hit.end, i + 1 < hits.length ? hits[i + 1].start : body.length);
    const tex = raw.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');

    if (hit.kind === 'alphsep') {
      const letter = tex.replace(/[{}]/g, '').trim();
      group = { letter, entries: [] };
      groups.push(group);
      lastItem = null;
      lastSub = null;
      return;
    }
    if (tex === '') return;
    if (!group) {
      warnings.push(`index: entry before the first letter heading: ${tex.slice(0, 40)}`);
      group = { letter: '', entries: [] };
      groups.push(group);
    }
    if (hit.kind === 'item') {
      lastItem = { tex, subs: [] };
      lastSub = null;
      group.entries.push(lastItem);
      return;
    }
    if (hit.kind === 'subitem') {
      if (!lastItem) {
        warnings.push(`index: \\subitem with no \\item: ${tex.slice(0, 40)}`);
        return;
      }
      lastSub = { tex, subs: [] };
      lastItem.subs.push(lastSub);
      return;
    }
    // subsubitem
    if (!lastSub) {
      warnings.push(`index: \\subsubitem with no \\subitem: ${tex.slice(0, 40)}`);
      return;
    }
    lastSub.subs.push({ tex, subs: [] });
  });

  return { groups, warnings };
}
