// parse/tokenizer.js — one book unit (section body, exercise set, chapter
// intro, preface, answer group) → structured block list.
//
// Order is load-bearing:
//   1. Comments are stripped line-by-line (safe before math protection: the
//      corpus has no literal % inside \url/\href arguments).
//   2. Math is protected FIRST: every math span is replaced by a private-use
//      placeholder and stored verbatim, so math backslashes, &, _, \\ are
//      invisible to every later stage (block segmentation, tabular cell
//      splitting, inline rendering).
//   3. Block segmentation walks the placeholder-bearing text with an
//      environment stack; unknown structure warns loudly and recovers.
import { stripLineComment, extractBraceGroup } from './tex-utils.js';

export const PH_OPEN = '\uE000';
export const PH_CLOSE = '\uE001';
const PH_RE = /\uE000(\d+)\uE001/g;

// Numbered/starred display environments protected verbatim as math. eqnarray is
// this book's workhorse for multi-line derivations.
const MATH_ENV_RE = /^\\begin\{(equation|eqnarray|align|multline|gather|flalign)(\*?)\}/;

// Text-level environments handled as blocks. Everything else is either math
// (already protected) or inline content.
const TEXT_ENVS = new Set([
  'figure',
  'figure*',
  'center',
  'quote',
  'quotation',
  'itemize',
  'enumerate',
  'description',
  'example',
  'theorem',
  'definition',
  'exerciselist',
  'alist',
  'Alist',
  'rmlist',
  'numberlist',
  'list',
  'trivlist',
  'tabular',
  'newtable',
  'minipage',
  'table',
]);

// wtrench.sty's custom list environments and the counter style of their labels.
const CUSTOM_LISTS = {
  alist: 'alpha',
  Alist: 'Alpha',
  rmlist: 'roman',
  numberlist: 'decimal',
};

// Block-level commands taking one brace group that is itself block content.
const BLOCK_BOX_COMMANDS = {
  remark: 'remark',
  bigbox: 'framed',
  blankbox: 'plain',
};

export function tokenize(source, { name = 'unit' } = {}) {
  const warnings = [];
  const notices = [];
  const stripped = stripComments(normalizeEnvSpacing(source));
  const { text, mathSpans } = protectMath(stripped, warnings, name);
  const ctx = { warnings, notices, name, mathSpans };
  const blocks = parseBlocks(text, ctx);
  return { blocks, mathSpans, warnings, notices };
}

/**
 * `\begin {example}` (with a space) is valid LaTeX and occurs in the source, but
 * every downstream scan matches `\begin{env}` literally. Normalize once.
 */
function normalizeEnvSpacing(source) {
  return source.replace(/\\(begin|end)\s+\{/g, '\\$1{');
}

function stripComments(source) {
  const out = [];
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('%')) continue; // pure comment: no blank line left behind
    out.push(stripLineComment(line));
  }
  return out.join('\n');
}

/**
 * Plain TeX's \eqno{X} is not MathJax input; \tag is its LaTeX equivalent and
 * renders in the same right-hand-margin position. These are the book's
 * hand-lettered (A)/(B) tags, never the numbered-equation sequence — and since
 * the author writes the parentheses himself, the starred form is the right one
 * (\tag would add a second pair, giving "((A))").
 */
function rewriteEqno(tex) {
  return tex.replace(/\\eqno\s*/g, '\\tag*');
}

/**
 * `\\[2\jot]` row spacing: \jot is a LaTeX length register (3pt by default)
 * that MathJax does not define, and MathJax cannot multiply it either. Resolve
 * the arithmetic here.
 */
function rewriteJot(tex) {
  return tex
    .replace(/\[\s*(\d*(?:\.\d+)?)\s*\\jot\s*\]/g, (_, n) => `[${(n === '' ? 1 : Number(n)) * 3}pt]`)
    .replace(/\\jot\b/g, '3pt');
}

// Font and colour switches. The source wraps whole passages in them — a blue
// italic restatement of a theorem, a small table — in either of two forms:
// `{\small ...}` (switch inside the group) or `\small{...}` (switch outside).
const SWITCH_NAMES =
  'small|footnotesize|scriptsize|tiny|normalsize|large|Large|LARGE|huge|Huge|bf|it|em|rm|sc';
const SWITCH_CLASSES = {
  small: 'tex-small',
  footnotesize: 'tex-small',
  scriptsize: 'tex-small',
  tiny: 'tex-small',
  large: 'tex-large',
  Large: 'tex-large',
  LARGE: 'tex-large',
  huge: 'tex-huge',
  Huge: 'tex-huge',
  bf: 'tex-bold',
  it: 'tex-italic',
  em: 'tex-italic',
  sc: 'smallcaps',
  normalsize: null,
  rm: null,
};
const LEADING_SWITCH = new RegExp(`^\\s*\\\\(?:(${SWITCH_NAMES})|color\\{([a-zA-Z]+)\\})\\s*`);
const SWITCH_BEFORE_GROUP = new RegExp(`^\\\\(?:${SWITCH_NAMES})\\s*(?=\\{)`);

/**
 * Match a style-wrapped group at `pos`, in either source form, and return the
 * CSS classes it implies together with its content. Returns null when `pos` does
 * not begin such a group.
 */
function matchStyleGroup(text, pos, ctx) {
  let group = null;
  if (text[pos] === '{') {
    // Any group is a candidate: the source also brace-wraps passages with no
    // switch at all ({\centerline{...} ... \begin{description}...}), and those
    // must become blocks too or their braces orphan.
    group = extractBraceGroup(text, pos);
    if (!group) {
      // The source leaves a few groups unclosed (\S2.5 and two answers). TeX
      // runs them to the end of the enclosing scope; do the same and say so.
      const rest = text.slice(pos + 1);
      if (!hasBlockContent(rest, ctx)) return null;
      ctx.warnings.push(`${ctx.name}: unclosed { (source defect; extended to end of unit)`);
      group = { value: rest, end: text.length };
    }
  } else {
    const before = SWITCH_BEFORE_GROUP.exec(text.slice(pos));
    if (!before) return null;
    group = extractBraceGroup(text, pos + before[0].length);
    if (!group) return null;
    const name = before[0].replace(/[\\\s{]/g, '');
    return {
      classes: [SWITCH_CLASSES[name]].filter(Boolean),
      inner: group.value,
      end: group.end,
    };
  }

  // Strip every leading switch, collecting the classes they imply.
  const classes = [];
  let inner = group.value;
  let m;
  while ((m = LEADING_SWITCH.exec(inner))) {
    const cls = m[1] ? SWITCH_CLASSES[m[1]] : `tex-color-${m[2]}`;
    if (cls) classes.push(cls);
    inner = inner.slice(m[0].length);
  }
  return { classes, inner, end: group.end };
}

export function protectMath(text, warnings, name) {
  const mathSpans = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const m = MATH_ENV_RE.exec(text.slice(i, i + 30));
      if (m) {
        const env = m[1] + m[2];
        const close = `\\end{${env}}`;
        const end = text.indexOf(close, i);
        if (end === -1) {
          warnings.push(`${name}: unterminated \\begin{${env}}`);
          out += ch;
          i++;
          continue;
        }
        const spanEnd = end + close.length;
        mathSpans.push({ kind: 'env', env, tex: rewriteJot(rewriteEqno(text.slice(i, spanEnd))) });
        out += PH_OPEN + (mathSpans.length - 1) + PH_CLOSE;
        i = spanEnd;
        continue;
      }
      out += text.slice(i, i + 2); // escaped char (incl. \$) stays verbatim
      i += 2;
      continue;
    }
    if (ch === '$') {
      const isDisplay = text[i + 1] === '$';
      const delimLen = isDisplay ? 2 : 1;
      let j = i + delimLen;
      let found = -1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '$' && (!isDisplay || text[j + 1] === '$')) {
          found = j;
          break;
        }
        j++;
      }
      if (found === -1) {
        warnings.push(`${name}: unterminated ${isDisplay ? '$$' : '$'} math`);
        out += ch;
        i++;
        continue;
      }
      mathSpans.push({
        kind: isDisplay ? 'display' : 'inline',
        tex: rewriteJot(rewriteEqno(text.slice(i + delimLen, found))),
      });
      out += PH_OPEN + (mathSpans.length - 1) + PH_CLOSE;
      i = found + delimLen;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, mathSpans };
}

function parseBlocks(text, ctx) {
  const blocks = [];
  let buf = '';
  const flush = () => {
    if (buf) blocks.push(...paragraphBlocks(buf, ctx));
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    // A style-wrapped passage that spans block content (a display or an
    // environment) cannot stay inline: the paragraph splitter would break the
    // group across two <p> elements and orphan its braces. Emit it as a block
    // that carries the styling instead.
    const styled = matchStyleGroup(text, i, ctx);
    if (styled && hasBlockContent(styled.inner, ctx)) {
      flush();
      blocks.push({
        type: 'styled',
        classes: styled.classes,
        children: parseBlocks(styled.inner, ctx),
      });
      i = styled.end;
      continue;
    }

    if (text[i] === '\\') {
      const begin = /^\\begin\{([a-zA-Z*]+)\}/.exec(text.slice(i, i + 24));
      if (begin && TEXT_ENVS.has(begin[1])) {
        flush();
        const env = begin[1];
        const { inner, end } = extractEnv(text, i, env, ctx);
        const block = envBlock(env, inner, ctx);
        if (block) blocks.push(block);
        i = end;
        continue;
      }

      // \boxit{...}: the book's run-in topic headings (127 of them). They are
      // the only sub-section structure the source has, so they drive the
      // on-page outline.
      if (text.startsWith('\\boxit', i)) {
        const group = getGroupAt(text, i + '\\boxit'.length, ctx, 'boxit');
        if (group) {
          flush();
          blocks.push({ type: 'subheading', title: group.value });
          i = group.end;
          continue;
        }
      }

      // A \hint whose argument contains a display keeps its own block; short
      // hints stay inline with the exercise text they follow.
      if (text.startsWith('\\hint', i)) {
        const group = getGroupAt(text, i + '\\hint'.length, ctx, 'hint');
        if (group && hasDisplayMath(group.value, ctx)) {
          flush();
          blocks.push({
            type: 'callout',
            variant: 'hint',
            children: parseBlocks(group.value, ctx),
          });
          i = group.end;
          continue;
        }
      }

      const boxCmd = /^\\(remark|bigbox|blankbox)\b/.exec(text.slice(i, i + 12));
      if (boxCmd) {
        const group = getGroupAt(text, i + boxCmd[0].length, ctx, boxCmd[1]);
        if (group) {
          flush();
          blocks.push({
            type: 'callout',
            variant: BLOCK_BOX_COMMANDS[boxCmd[1]],
            children: parseBlocks(group.value, ctx),
          });
          i = group.end;
          continue;
        }
      }

      // \setcounter{equation}{0} inside an exercise set restarts the display
      // numbering, exactly as it does in print; carry it to the model pass.
      const counterReset = /^\\setcounter\{(equation|table|figure|example|theorem)\}\{(\d+)\}/.exec(
        text.slice(i, i + 48)
      );
      if (counterReset) {
        flush();
        blocks.push({
          type: 'counterReset',
          counter: counterReset[1] === 'theorem' ? 'theorem' : counterReset[1],
          value: Number(counterReset[2]),
        });
        i += counterReset[0].length;
        continue;
      }

      if (text.startsWith('\\technology', i)) {
        flush();
        blocks.push({ type: 'subheading', title: 'Using Technology', variant: 'technology' });
        i += '\\technology'.length;
        continue;
      }

      if (text.startsWith('\\exercisetext', i)) {
        const group = getGroupAt(text, i + '\\exercisetext'.length, ctx, 'exercisetext');
        if (group) {
          flush();
          // The note can carry a display ("In Exercises 26-28 solve $$...$$"),
          // so it is block content, not an inline run.
          blocks.push({ type: 'exerciseNote', children: parseBlocks(group.value, ctx) });
          i = group.end;
          continue;
        }
      }

      if (text.startsWith('\\centerline', i)) {
        const group = getGroupAt(text, i + '\\centerline'.length, ctx, 'centerline');
        if (group) {
          flush();
          blocks.push({ type: 'centerline', text: group.value });
          i = group.end;
          continue;
        }
      }

      // \eqline{X}: a centred display whose argument is raw math (the macro
      // wraps it in $\displaystyle...$), so it never passed through protectMath.
      if (text.startsWith('\\eqline', i)) {
        const group = getGroupAt(text, i + '\\eqline'.length, ctx, 'eqline');
        if (group) {
          flush();
          ctx.mathSpans.push({ kind: 'display', tex: `\\displaystyle ${group.value}` });
          blocks.push({ type: 'displayMath', span: ctx.mathSpans.length - 1 });
          i = group.end;
          continue;
        }
      }

      if (text.startsWith('\\place', i) && !/[a-zA-Z]/.test(text[i + 6] ?? '')) {
        flush();
        blocks.push({ type: 'rule' });
        i += '\\place'.length;
        continue;
      }

      // A stray \end{...} here means the environment stack is out of balance:
      // warn and skip the token rather than crashing or looping.
      const strayEnd = /^\\end\{([a-zA-Z*]+)\}/.exec(text.slice(i, i + 24));
      if (strayEnd && TEXT_ENVS.has(strayEnd[1])) {
        ctx.warnings.push(`${ctx.name}: unbalanced \\end{${strayEnd[1]}}`);
        i += strayEnd[0].length;
        continue;
      }
      buf += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    buf += text[i];
    i++;
  }
  flush();
  return blocks;
}

// example/theorem/definition never nest in this book, so a second \begin before
// the matching \end means the source dropped an \end (chapter 11 does this).
const NON_NESTING = new Set(['example', 'theorem', 'definition']);

function extractEnv(text, start, env, ctx) {
  const open = `\\begin{${env}}`;
  const close = `\\end{${env}}`;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith(open, i)) {
      if (depth === 1 && NON_NESTING.has(env)) {
        ctx.warnings.push(
          `${ctx.name}: \\begin{${env}} without \\end{${env}} (source defect; ` +
            `closed at the next \\begin{${env}})`
        );
        return { inner: text.slice(start + open.length, i), end: i };
      }
      depth++;
      i += open.length;
      continue;
    }
    if (text.startsWith(close, i)) {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(start + open.length, i), end: i + close.length };
      }
      i += close.length;
      continue;
    }
    i++;
  }
  ctx.warnings.push(`${ctx.name}: unbalanced \\begin{${env}} (recovered at end of unit)`);
  return { inner: text.slice(start + open.length), end: text.length };
}

/** Drop a leading [ ... ] optional-argument group (float placement, minipage alignment). */
function skipOptionalArg(inner) {
  const trimmed = inner.replace(/^\s+/, '');
  if (!trimmed.startsWith('[')) return inner;
  const end = trimmed.indexOf(']');
  if (end === -1) return inner;
  return trimmed.slice(end + 1);
}

/** Pull the leading \label{...} out of an environment body. */
function takeLabel(inner) {
  // The label usually opens the environment, but \rm, \color and whitespace
  // may precede it (\begin{example}\label{..} \rm and \begin{example}\rm\label{..}
  // both occur), so search a short prefix and cut the label out of it.
  const m = /^[\s\S]{0,80}?\\label\{([^}]+)\}/.exec(inner);
  if (!m) return { label: null, rest: inner };
  return { label: m[1], rest: inner.slice(0, m.index) + inner.slice(m.index + m[0].length - `\\label{${m[1]}}`.length + `\\label{${m[1]}}`.length) };
}

function getGroupAt(text, pos, ctx, cmd) {
  let i = pos;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return null;
  const group = extractBraceGroup(text, i);
  if (!group) {
    ctx.warnings.push(`${ctx.name}: unbalanced argument of \\${cmd}`);
    return null;
  }
  return group;
}

function envBlock(env, inner, ctx) {
  switch (env) {
    case 'figure':
    case 'figure*':
    case 'table':
      return parseFigure(skipOptionalArg(inner), ctx, env === 'table');
    case 'center':
      return { type: 'center', children: parseBlocks(inner, ctx) };
    case 'quote':
    case 'quotation':
      return { type: 'quote', children: parseBlocks(inner, ctx) };
    case 'minipage':
      // Standalone minipage (outside a figure): just a container.
      return { type: 'center', children: parseBlocks(stripMinipageWidth(inner), ctx) };
    case 'itemize':
      return { type: 'list', style: 'bullet', items: parseListItems(inner, ctx) };
    case 'enumerate':
      return { type: 'list', style: 'decimal', items: parseListItems(inner, ctx) };
    case 'description':
    case 'list':
    case 'trivlist':
      return { type: 'list', style: 'none', items: parseListItems(inner, ctx) };
    case 'alist':
    case 'Alist':
    case 'rmlist':
    case 'numberlist':
      return { type: 'list', style: CUSTOM_LISTS[env], items: parseListItems(inner, ctx) };
    case 'exerciselist':
      return { type: 'exercises', items: parseListItems(inner, ctx) };
    case 'example':
    case 'theorem': {
      // \begin{example}[Gibbs Phenomenon] — an optional titling argument.
      const titled = /^\s*\[([^\]]*)\]/.exec(inner);
      const body = titled ? inner.slice(titled[0].length) : inner;
      const { label, rest } = takeLabel(body);
      if (!label) {
        ctx.warnings.push(`${ctx.name}: ${env} without a \\label (source defect)`);
      }
      return {
        type: env,
        label,
        title: titled ? titled[1].trim() : null,
        children: parseBlocks(rest, ctx),
      };
    }
    case 'definition': {
      // \begin{definition}{...} takes the definition text as its argument.
      const arg = getGroupAt(inner, 0, ctx, 'definition');
      const body = arg ? arg.value + inner.slice(arg.end) : inner;
      const { label, rest } = takeLabel(body);
      return { type: 'definition', label, children: parseBlocks(rest, ctx) };
    }
    case 'tabular':
      return parseTabular(inner, ctx);
    case 'newtable':
      return parseNewTable(inner, ctx);
    default:
      ctx.warnings.push(`${ctx.name}: unhandled environment ${env}`);
      return { type: 'p', text: inner };
  }
}

function stripMinipageWidth(inner) {
  // \begin{minipage}[b]{0.5\linewidth} — drop the width group left by
  // skipOptionalArg's caller.
  const withoutOpt = skipOptionalArg(inner);
  const g = extractBraceGroup(withoutOpt, skipWs(withoutOpt, 0));
  return g ? withoutOpt.slice(g.end) : withoutOpt;
}

/** True when a chunk holds a display or a block-level environment. */
function hasBlockContent(text, ctx) {
  if (hasDisplayMath(text, ctx)) return true;
  for (const m of text.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)) {
    if (TEXT_ENVS.has(m[1])) return true;
  }
  return false;
}

/** True when a chunk of placeholder-bearing text holds a display-math span. */
function hasDisplayMath(text, ctx) {
  PH_RE.lastIndex = 0;
  let m;
  while ((m = PH_RE.exec(text))) {
    if (ctx.mathSpans[Number(m[1])].kind !== 'inline') return true;
  }
  return false;
}

function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/**
 * Items of any list environment. Labels come from \item[...] (LaTeX standard);
 * this book's own lists number themselves from the environment's counter, and
 * exercises carry \label{exer:C.S.N} which the model pass turns into the print
 * exercise number.
 */
/**
 * Trench lays exercises out two or three per row inside a `tabular` to save
 * paper: `\begin{tabular}...\item ... & \item ... \end{tabular}` nested in the
 * exerciselist. That grid is print layout, not structure — on the web the
 * exercises flow as one list — so a tabular that contains \item is unwrapped
 * (cell and row separators become paragraph breaks) before items are split.
 * Tabulars without \item are real data tables and are left alone.
 */
function flattenLayoutTabulars(inner, ctx) {
  let out = '';
  let i = 0;
  while (i < inner.length) {
    if (inner.startsWith('\\begin{tabular}', i)) {
      const { inner: tInner, end } = extractEnv(inner, i, 'tabular', ctx);
      if (!/\\item\b/.test(tInner)) {
        out += inner.slice(i, end);
        i = end;
        continue;
      }
      const afterOpt = skipOptionalArg(tInner);
      const spec = extractBraceGroup(afterOpt, skipWs(afterOpt, 0));
      const body = spec ? afterOpt.slice(spec.end) : afterOpt;
      out += splitTopLevel(body, '&')
        .join('\n\n')
        .replace(/\\\\(\s*\[[^\]]*\])?/g, '\n\n');
      i = end;
      continue;
    }
    if (inner[i] === '\\') {
      out += inner.slice(i, i + 2);
      i += 2;
      continue;
    }
    out += inner[i];
    i++;
  }
  return out;
}

function parseListItems(rawInner, ctx) {
  const inner = flattenLayoutTabulars(rawInner, ctx);
  const items = [];
  let current = null;
  let depth = 0;
  let i = 0;
  const pushCurrent = end => {
    if (current === null) return;
    const body = inner.slice(current.bodyStart, end);
    items.push({ label: current.label, children: parseBlocks(body, ctx) });
  };
  while (i < inner.length) {
    if (inner[i] === '\\') {
      // \exercisetext expands to \end{exerciselist}<text>\begin{exerciselist},
      // so in the source it sits between items: emit it as a separator, not as
      // trailing content of the exercise above it.
      if (depth === 0 && inner.startsWith('\\exercisetext', i)) {
        const group = getGroupAt(inner, i + '\\exercisetext'.length, ctx, 'exercisetext');
        if (group) {
          pushCurrent(i);
          current = null;
          items.push({ note: true, children: parseBlocks(group.value, ctx) });
          i = group.end;
          continue;
        }
      }
      if (depth === 0 && inner.startsWith('\\item', i) && !/[a-zA-Z]/.test(inner[i + 5] ?? '')) {
        pushCurrent(i);
        let bodyStart = i + '\\item'.length;
        let label = null;
        const rest = inner.slice(bodyStart);
        const optMatch = rest.match(/^\s*\[/);
        if (optMatch) {
          const open = bodyStart + optMatch[0].length - 1;
          const closeIdx = inner.indexOf(']', open);
          if (closeIdx !== -1) {
            label = inner.slice(open + 1, closeIdx);
            bodyStart = closeIdx + 1;
          }
        }
        current = { label, bodyStart };
        i = bodyStart;
        continue;
      }
      if (/^\\begin\{/.test(inner.slice(i, i + 8))) depth++;
      if (/^\\end\{/.test(inner.slice(i, i + 6))) depth--;
      i += 2;
      continue;
    }
    i++;
  }
  pushCurrent(inner.length);
  if (items.length === 0) {
    // \exercisetext closes and reopens exerciselist, so an empty tail segment
    // is normal; only a wholly item-less list is worth reporting.
    if (inner.trim() !== '') ctx.notices.push(`${ctx.name}: list environment without \\item`);
  }
  return items;
}

/**
 * Figures. Trench's pattern is
 *   \begin{figure}[h] \centering \includegraphics[...]{figCCSSNN}
 *   \caption{...} \label{figure:C.S.N} \end{figure}
 * with multi-panel figures nesting one \begin{minipage} per panel, each with
 * its own caption and label — so one float can hold several numbered figures.
 */
function parseFigure(inner, ctx, isTableFloat = false) {
  const panels = [];
  const minipageRe = /\\begin\{minipage\}/;
  if (minipageRe.test(inner)) {
    let rest = inner;
    while (true) {
      const at = rest.search(minipageRe);
      if (at === -1) break;
      const { inner: pInner, end } = extractEnv(rest, at, 'minipage', ctx);
      panels.push(parseFigurePanel(stripMinipageWidth(pInner), ctx));
      rest = rest.slice(end);
    }
  } else {
    panels.push(parseFigurePanel(inner, ctx));
  }

  const withImages = panels.filter(p => p.images.length > 0 || p.caption !== null);
  if (withImages.length === 0) {
    ctx.warnings.push(`${ctx.name}: figure float with neither image nor caption`);
    return null;
  }
  return { type: isTableFloat ? 'tableFloat' : 'figure', panels: withImages };
}

function parseFigurePanel(inner, ctx) {
  const images = [];
  let caption = null;
  let captionStarred = false;
  let label = null;

  let i = 0;
  let text = '';
  while (i < inner.length) {
    if (inner.startsWith('\\includegraphics', i)) {
      const m = inner.slice(i).match(/^\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/);
      if (m) {
        const widthMatch = (m[1] || '').match(/width\s*=\s*([\d.]+)\s*in/);
        images.push({
          file: `${m[2].trim()}.eps`,
          widthIn: widthMatch ? parseFloat(widthMatch[1]) : null,
        });
        i += m[0].length;
        continue;
      }
    }
    const capMatch = inner.startsWith('\\caption', i)
      ? /^\\caption(\*?)/.exec(inner.slice(i))
      : null;
    if (capMatch) {
      const group = getGroupAt(inner, i + capMatch[0].length, ctx, 'caption');
      if (group) {
        let value = group.value;
        const labelMatch = value.match(/\\label\{([^}]+)\}/);
        if (labelMatch) {
          label = labelMatch[1];
          value = value.replace(labelMatch[0], '');
        }
        caption = value.trim();
        captionStarred = capMatch[1] === '*';
        i = group.end;
        continue;
      }
    }
    if (inner.startsWith('\\label{', i)) {
      const group = extractBraceGroup(inner, i + '\\label'.length);
      if (group) {
        if (!label) label = group.value;
        i = group.end;
        continue;
      }
    }
    text += inner[i];
    i++;
  }

  if (images.length === 0 && caption === null) return { images, caption, label, text };
  if (images.length === 0) ctx.notices.push(`${ctx.name}: figure panel without \\includegraphics`);
  // Starred captions are the book's unnumbered exercise illustrations, which
  // carry their exercise number in the caption text itself.
  if (!label && !captionStarred) ctx.notices.push(`${ctx.name}: figure panel without a \\label`);
  return { images, caption, label, captionStarred, text };
}

/**
 * \begin{newtable}{caption} ... \end{newtable} — wtrench.sty's table float. The
 * \label conventionally precedes the caption argument.
 */
function parseNewTable(inner, ctx) {
  const { label, rest } = takeLabel(inner);
  const arg = getGroupAt(rest, 0, ctx, 'newtable');
  const caption = arg ? arg.value.trim() : null;
  const body = arg ? rest.slice(arg.end) : rest;
  if (!caption) ctx.warnings.push(`${ctx.name}: newtable without a caption argument`);
  return {
    type: 'tableFloat',
    panels: [{ images: [], caption, label }],
    children: parseBlocks(body, ctx),
  };
}

function parseTabular(inner, ctx) {
  const afterOpt = skipOptionalArg(inner);
  const specGroup = extractBraceGroup(afterOpt, skipWs(afterOpt, 0));
  if (!specGroup) {
    ctx.warnings.push(`${ctx.name}: tabular without column spec`);
    return { type: 'p', text: inner };
  }
  const columns = [];
  for (const ch of specGroup.value.replace(/[@p]\{[^}]*\}/g, 'l')) {
    if (ch === 'l') columns.push('left');
    else if (ch === 'c') columns.push('center');
    else if (ch === 'r') columns.push('right');
    // | borders and spacing are handled by site CSS, not per-column rules.
  }

  const body = afterOpt.slice(specGroup.end);
  const rows = [];
  let depth = 0;
  let start = 0;
  let hlineForNext = 0;
  const pushRow = end => {
    let text = body.slice(start, end);
    let hlines = hlineForNext;
    hlineForNext = 0;
    let m;
    while ((m = text.match(/^\s*\\hline/))) {
      hlines++;
      text = text.slice(m[0].length);
    }
    const trailing = text.match(/(\\hline\s*)+$/);
    if (trailing) {
      hlineForNext = (trailing[0].match(/\\hline/g) || []).length;
      text = text.slice(0, trailing.index);
    }
    if (text.trim() === '') {
      hlineForNext = hlines;
      return;
    }
    const cells = splitTopLevel(text, '&').map(c => c.trim());
    rows.push({ cells, topline: hlines > 0 });
  };
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        pushRow(i);
        // A row break may carry a spacing option: \\[9pt]
        let after = i + 2;
        const opt = body.slice(after).match(/^\s*\[[^\]]*\]/);
        if (opt) after += opt[0].length;
        start = after;
        i = after;
        continue;
      }
      if (/^\\begin\{/.test(body.slice(i, i + 8))) depth++;
      if (/^\\end\{/.test(body.slice(i, i + 6))) depth--;
      i += 2;
      continue;
    }
    if (body[i] === '{') depth++;
    if (body[i] === '}') depth--;
    i++;
  }
  pushRow(body.length);
  return { type: 'tabular', columns, rows, bottomline: hlineForNext > 0 };
}

function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function paragraphBlocks(buf, ctx) {
  const blocks = [];
  for (const para of buf.split(/\n\s*\n/)) {
    // Split the paragraph around display-math placeholders: HTML <p> cannot
    // contain block-level math containers.
    let last = 0;
    const pieces = [];
    PH_RE.lastIndex = 0;
    let m;
    while ((m = PH_RE.exec(para))) {
      const span = ctx.mathSpans[Number(m[1])];
      if (span.kind === 'inline') continue;
      pieces.push({ text: para.slice(last, m.index) });
      pieces.push({ math: Number(m[1]) });
      last = m.index + m[0].length;
    }
    pieces.push({ text: para.slice(last) });
    for (const piece of pieces) {
      if (piece.math !== undefined) {
        blocks.push({ type: 'displayMath', span: piece.math });
      } else if (piece.text && piece.text.trim() !== '') {
        blocks.push({ type: 'p', text: piece.text.trim() });
      }
    }
  }
  return blocks;
}
