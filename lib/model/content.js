// model/content.js — pass over the tokenized units in reading order: assign
// print-edition numbers to equations, examples, theorems, definitions, figures,
// tables and exercises, and build the global anchors map that resolves
// \ref, \eqref, \pageref and \hyperref.
//
// Numbering is label-driven. Trench's labels already carry the print number
// (\label{eq:2.1.15} is equation 2.1.15, \label{example:7.1.1} is Example
// 7.1.1), so the label is authoritative and a per-section counter runs
// alongside it purely as a check: any disagreement is reported rather than
// silently accepted. Unlabeled items fall back to the counter.
//
// Equation numbering is server-authoritative: MathJax runs with tags:'none'
// and every number is injected as \tag{...} here, so displayed tags, \eqref
// link text and the print edition agree.

import { extractBraceGroup } from '../parse/tex-utils.js';

/**
 * Every \label{...} in a chunk of TeX, brace-balanced: a few labels nest a group
 * (\label{eq:7.4.{exer:7.4.19}A}) and a non-greedy /[^}]+/ would truncate them,
 * so the anchor would never match the \eqref that points at it.
 */
function findLabels(tex, prefix = '') {
  const labels = [];
  let at = 0;
  while ((at = tex.indexOf('\\label', at)) !== -1) {
    let i = at + '\\label'.length;
    while (i < tex.length && /\s/.test(tex[i])) i++;
    const group = extractBraceGroup(tex, i);
    if (!group) {
      at += '\\label'.length;
      continue;
    }
    if (!prefix || group.value.startsWith(prefix)) labels.push(group.value);
    at = group.end;
  }
  return labels;
}

/** Labels become HTML ids; colons and dots are awkward in CSS selectors. */
export function anchorId(label) {
  return String(label).replace(/[^A-Za-z0-9]+/g, '-');
}

const LABEL_KINDS = {
  eq: 'equation',
  example: 'example',
  thmtype: 'theorem',
  figure: 'figure',
  table: 'table',
  exer: 'exercise',
};

/** "eq:2.1.15" -> { kind: 'equation', number: '2.1.15', section: '2.1', n: 15 } */
function parseLabel(label) {
  const m = /^([a-zA-Z]+):(\d+)\.(\d+)\.(\d+)$/.exec(String(label).trim());
  if (!m) return null;
  const kind = LABEL_KINDS[m[1]];
  if (!kind) return null;
  return {
    kind,
    number: `${m[2]}.${m[3]}.${m[4]}`,
    section: `${m[2]}.${m[3]}`,
    n: Number(m[4]),
  };
}

function newCounters() {
  // theorem and definition share one counter: wtrench.sty's definition
  // environment numbers itself with \refstepcounter{theorem}.
  return { equation: 0, example: 0, theorem: 0, figure: 0, table: 0, exercise: 0 };
}

export function annotateContent(model, tokenized, warnings, notices) {
  const anchors = new Map();
  const mismatches = [];

  for (const page of model.pages) {
    if (page.kind === 'answers') continue;

    const sectionNumber = page.kind === 'section' ? page.number : null;
    const ctx = {
      page,
      anchors,
      warnings,
      mismatches,
      sectionNumber,
      notices,
      counters: newCounters(),
      mathSpans: [],
      name: page.url,
    };

    for (const unit of page.units) {
      const mod = tokenized.get(unit.name);
      if (!mod) continue;
      ctx.mathSpans = mod.mathSpans;
      ctx.name = unit.name;
      walkBlocks(mod.blocks, ctx);
    }
  }

  // Answer pages anchor every answer so exercises can link to them.
  for (const page of model.answerPages ?? []) {
    for (const group of page.answerGroups) {
      for (const entry of group.entries) {
        anchors.set(`answer:${entry.key}`, {
          url: page.url,
          id: anchorId(`answer:${entry.key}`),
          number: entry.key.split('.')[2],
          kind: 'answer',
        });
      }
    }
  }

  return { anchors, mismatches };
}

/**
 * Number one item: the label wins, the counter checks it. Returns the print
 * number as a string.
 */
function assignNumber(kind, label, ctx) {
  const counted = ++ctx.counters[kind];
  const parsed = label ? parseLabel(label) : null;

  if (!parsed) {
    // Hand-built labels like \label{eq:7.4.{exer:7.4.19}A} name an equation
    // inside an exercise, whose numbering the source restarts with
    // \setcounter; the running counter is right for these.
    if (label) ctx.notices.push(`${ctx.name}: ${kind} label "${label}" is not a print number`);
    if (ctx.sectionNumber === null) return null; // chapter openers and the preface are unnumbered
    return kind === 'exercise' ? String(counted) : `${ctx.sectionNumber}.${counted}`;
  }

  if (parsed.kind !== kind) {
    ctx.warnings.push(`${ctx.name}: ${kind} carries a ${parsed.kind} label (${label})`);
  }
  if (ctx.sectionNumber !== null && parsed.section !== ctx.sectionNumber) {
    ctx.mismatches.push(
      `${ctx.name}: ${kind} label ${label} does not belong to section ${ctx.sectionNumber}`
    );
  }
  if (parsed.n !== counted) {
    ctx.mismatches.push(
      `${ctx.name}: ${kind} ${label} is number ${counted} in sequence (print says ${parsed.n})`
    );
    // The label is authoritative; resynchronize the counter so one gap does not
    // cascade into a warning for every later item in the section.
    ctx.counters[kind] = parsed.n;
  }
  // Exercises are numbered within their section in print: \ref{exer:2.1.6}
  // typesets "6", and the section is named separately where it matters.
  return kind === 'exercise' ? String(parsed.n) : parsed.number;
}

function register(label, ctx, number, kind) {
  if (!label) return;
  const parsed = parseLabel(label);
  ctx.anchors.set(label, {
    url: ctx.page.url,
    id: anchorId(label),
    // `number` is what \ref typesets (a bare "23" for an exercise); `qualified`
    // is the fully-qualified print number, which the index uses so its entries
    // read "4.1.23" rather than "23".
    number,
    qualified: parsed ? parsed.number : number,
    kind,
  });
}

function walkBlocks(blocks, ctx) {
  for (const b of blocks) {
    switch (b.type) {
      case 'figure':
        for (const panel of b.panels) {
          if (panel.captionStarred) {
            // Exercise illustrations are unnumbered in print; their caption
            // carries the exercise number instead.
            panel.number = null;
            continue;
          }
          panel.number = assignNumber('figure', panel.label, ctx);
          register(panel.label, ctx, panel.number, 'figure');
        }
        break;
      case 'tableFloat':
        for (const panel of b.panels) {
          panel.number = assignNumber('table', panel.label, ctx);
          register(panel.label, ctx, panel.number, 'table');
        }
        if (b.children) walkBlocks(b.children, ctx);
        break;
      case 'example':
        b.number = assignNumber('example', b.label, ctx);
        register(b.label, ctx, b.number, 'example');
        walkBlocks(b.children, ctx);
        break;
      case 'theorem':
      case 'definition':
        b.number = assignNumber('theorem', b.label, ctx);
        register(b.label, ctx, b.number, b.type);
        walkBlocks(b.children, ctx);
        break;
      case 'exercises':
        for (const item of b.items) {
          if (item.note) {
            walkBlocks(item.children, ctx);
            continue;
          }
          const label = findLabel(item.children);
          item.label = label;
          item.number = assignNumber('exercise', label, ctx);
          register(label, ctx, item.number, 'exercise');
          walkBlocks(item.children, ctx);
        }
        break;
      case 'list':
        for (const item of b.items) walkBlocks(item.children ?? [], ctx);
        break;
      case 'callout':
      case 'center':
      case 'quote':
      case 'styled':
      case 'exerciseNote':
        walkBlocks(b.children, ctx);
        break;
      case 'counterReset':
        ctx.counters[b.counter] = b.value;
        break;
      case 'displayMath':
        annotateMathSpan(ctx.mathSpans[b.span], ctx);
        break;
      default:
        break;
    }
  }
}

/** The \label{exer:...} an exercise carries lives in its first paragraph. */
function findLabel(blocks) {
  for (const b of blocks) {
    const text = b.text ?? b.title ?? '';
    const [first] = findLabels(text, 'exer:');
    if (first) return first;
    if (b.children) {
      const nested = findLabel(b.children);
      if (nested) return nested;
    }
  }
  return null;
}

function annotateMathSpan(span, ctx) {
  if (span.kind !== 'env') return; // $$..$$ displays are unnumbered in this book

  const open = `\\begin{${span.env}}`;
  const close = `\\end{${span.env}}`;
  const body = span.tex.slice(open.length, span.tex.length - close.length);

  // eqnarray numbers every row; equation is a single numbered display. Starred
  // forms are unnumbered throughout.
  const starred = span.env.endsWith('*');
  const perRow = span.env.startsWith('eqnarray') || span.env.startsWith('align');
  const rowTexts = perRow ? splitRows(body) : [{ text: body, spacing: '' }];

  span.rows = [];
  const renderedRows = [];
  for (const { text: rowText, spacing } of rowTexts) {
    if (rowText.trim() === '') continue;
    const labels = findLabels(rowText);
    const suppressed = starred || /\\nonumber\b/.test(rowText) || /\\tag\*?\{/.test(rowText);
    const number = suppressed ? null : assignNumber('equation', labels[0] ?? null, ctx);
    for (const label of labels) {
      register(label, ctx, number ?? '?', 'equation');
      if (number === null) {
        ctx.warnings.push(`${ctx.name}: \\label{${label}} on an unnumbered display`);
      }
    }
    let cleaned = stripLabels(rowText)
      .replace(/\\nonumber\b/g, '')
      .replace(/[ \t]+$/gm, '');
    if (number !== null) cleaned = `${cleaned.trimEnd()} \\tag{${number}}`;
    span.rows.push({ labels, number });
    renderedRows.push({ text: cleaned, spacing });
  }

  // All equation anchors on a display resolve to the block; the first label ids it.
  span.anchorLabel = span.rows.flatMap(r => r.labels)[0] ?? null;
  // The row separator carries its own optional spacing argument (\\[6pt]); it
  // must stay welded to the \\ or MathJax typesets "[6pt]" as text.
  span.rendered =
    open +
    renderedRows
      .map((row, i) =>
        i === renderedRows.length - 1 ? row.text : `${row.text} \\\\${row.spacing}\n`
      )
      .join('') +
    close;
}

/** Remove every (brace-balanced) \label from a chunk of math source. */
function stripLabels(tex) {
  let out = tex;
  for (const label of findLabels(tex)) out = out.replace(`\\label{${label}}`, '');
  return out;
}

/**
 * Split an eqnarray/align body on \\ at zero brace/environment depth. Each row
 * carries the optional spacing argument that followed its terminating \\, so it
 * can be re-attached when the rows are joined back together.
 */
function splitRows(body) {
  const rows = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        const after = body.slice(i + 2);
        const opt = /^\s*(\[[^\]]*\])/.exec(after);
        rows.push({ text: body.slice(start, i), spacing: opt ? opt[1] : '' });
        start = i + 2 + (opt ? opt[0].length : 0);
        i = start;
        continue;
      }
      if (/^\\begin\{/.test(body.slice(i, i + 8))) depth++;
      if (/^\\end\{/.test(body.slice(i, i + 6))) depth--;
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }
  rows.push({ text: body.slice(start), spacing: '' });
  return rows;
}
