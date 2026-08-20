// render/transform.js — block-level dispatch: tokenized unit → HTML.
//
// Numbers and the anchors map are assigned by the model pass
// (lib/model/content.js) before rendering.
import { renderInline, mathSpanHtml, escapeHtml, texToPlain } from './inline.js';
import { renderTabular } from './tabular.js';
import { anchorId } from '../model/content.js';

export function renderUnit(mod, ctx) {
  ctx.mathSpans = mod.mathSpans;
  ctx.name = mod.name;
  return renderBlocks(mod.blocks, ctx);
}

export function renderBlocks(blocks, ctx) {
  return blocks
    .map(b => renderBlock(b, ctx))
    .filter(Boolean)
    .join('\n');
}

function renderBlock(b, ctx) {
  switch (b.type) {
    case 'p':
      return `<p>${renderInline(b.text, ctx)}</p>`;
    case 'displayMath':
      return renderDisplayMath(ctx.mathSpans[b.span], ctx);
    case 'figure':
      return renderFigure(b, ctx);
    case 'tableFloat':
      return renderTableFloat(b, ctx);
    case 'tabular':
      return renderTabular(b, ctx);
    case 'center':
      return `<div class="center">\n${renderBlocks(b.children, ctx)}\n</div>`;
    case 'quote':
      return `<blockquote>\n${renderBlocks(b.children, ctx)}\n</blockquote>`;
    case 'centerline':
      return `<div class="centerline">${renderInline(b.text, ctx)}</div>`;
    case 'rule':
      return '<hr class="rule" />';
    case 'styled': {
      const cls = b.classes.length ? ` class="${escapeHtml(b.classes.join(' '))}"` : '';
      return `<div${cls}>\n${renderBlocks(b.children, ctx)}\n</div>`;
    }
    case 'counterReset':
      return ''; // consumed by the numbering pass; nothing to show
    case 'list':
      return renderList(b, ctx);
    case 'exercises':
      return renderExercises(b, ctx);
    case 'exerciseNote':
      return `<div class="exercise-note">\n${renderBlocks(b.children, ctx)}\n</div>`;
    case 'example':
    case 'theorem':
    case 'definition':
      return renderTheoremLike(b, ctx);
    case 'callout':
      return renderCallout(b, ctx);
    case 'subheading': {
      const cls = b.variant ? ` class="${escapeHtml(b.variant)}"` : '';
      return `<h2${cls} id="${escapeHtml(headingId(b, ctx))}">${renderInline(b.title, ctx)}</h2>`;
    }
    default:
      ctx.warnings.push(`${ctx.name}: unrendered block type ${b.type}`);
      return '';
  }
}

function headingId(b, ctx) {
  if (!b.htmlId) {
    b.htmlId = `h-${anchorId(texToPlain(b.title, ctx.mathSpans).toLowerCase()).slice(0, 60)}`;
  }
  return b.htmlId;
}

function renderDisplayMath(span, ctx) {
  if (span.kind !== 'env') {
    return `<div class="equation-block">${mathSpanHtml({ ...span, kind: 'display' })}</div>`;
  }
  const labels = (span.rows ?? []).flatMap(r => r.labels ?? []);
  const id = labels.length ? ` id="${escapeHtml(anchorId(labels[0]))}"` : '';
  const stubs = labels
    .slice(1)
    .map(l => `<span id="${escapeHtml(anchorId(l))}" class="label-anchor"></span>`)
    .join('');
  return `<div class="equation-block"${id}>${stubs}${mathSpanHtml(span)}</div>`;
}

const LIST_TAG = {
  bullet: ['ul', null],
  decimal: ['ol', '1'],
  alpha: ['ol', 'a'],
  Alpha: ['ol', 'A'],
  roman: ['ol', 'i'],
  none: ['ul', null],
};

function renderList(b, ctx) {
  const [tag, type] = LIST_TAG[b.style] ?? LIST_TAG.bullet;
  const attrs =
    (type ? ` type="${type}"` : '') + (b.style === 'none' ? ' class="plain-list"' : '');
  const items = b.items
    .map(item => {
      const label = item.label
        ? `<span class="item-label">${renderInline(item.label, ctx)}</span> `
        : '';
      return `<li>${label}${renderBlocks(item.children, ctx)}</li>`;
    })
    .join('\n');
  return `<${tag}${attrs}>\n${items}\n</${tag}>`;
}

/**
 * An exercise set. Each exercise keeps its print number and, where the book
 * answers it, carries that answer inline behind a disclosure — the print
 * edition sends the reader to the back of the book instead.
 */
function renderExercises(b, ctx) {
  const parts = [];
  let open = false;
  const closeList = () => {
    if (open) parts.push('</ol>');
    open = false;
  };

  for (const item of b.items) {
    if (item.note) {
      closeList();
      parts.push(`<div class="exercise-note">\n${renderBlocks(item.children, ctx)}\n</div>`);
      continue;
    }
    if (!open) {
      parts.push('<ol class="exercise-list">');
      open = true;
    }
    const id = item.label ? ` id="${escapeHtml(anchorId(item.label))}"` : '';
    const value = item.number ? ` value="${escapeHtml(item.number)}"` : '';
    const answer = renderAnswer(item, ctx);
    const previous = ctx.suppressLabel;
    ctx.suppressLabel = item.label;
    const body = renderBlocks(item.children, ctx);
    ctx.suppressLabel = previous;
    parts.push(`<li class="tex-exercise"${id}${value}>\n${body}\n${answer}</li>`);
  }
  closeList();
  return parts.join('\n');
}

function renderAnswer(item, ctx) {
  if (!item.label || !ctx.answerHtml) return '';
  const key = item.label.replace(/^exer:/, '');
  const html = ctx.answerHtml(key);
  if (!html) return '';
  return (
    `<details class="exercise-answer">\n` +
    `<summary>Show answer</summary>\n<div class="answer-body">${html}</div>\n</details>\n`
  );
}

const THEOREM_LABELS = {
  example: 'Example',
  theorem: 'Theorem',
  definition: 'Definition',
};

function renderTheoremLike(b, ctx) {
  const id = b.label ? ` id="${escapeHtml(anchorId(b.label))}"` : '';
  const name = THEOREM_LABELS[b.type];
  const number = b.number ? ` ${escapeHtml(b.number)}` : '';
  const title = b.title ? ` <span class="callout-name">(${renderInline(b.title, ctx)})</span>` : '';
  return (
    // The `tex-` prefix keeps these clear of the inherited theme's own
    // .example / .exercise rules, which inject their own counters and badges.
    `<div class="tex-${b.type}"${id}>\n` +
    `<p class="callout-title">${name}${number}${title}</p>\n` +
    `${renderBlocks(b.children, ctx)}\n</div>`
  );
}

const CALLOUT_TITLES = { remark: 'Remark', hint: 'Hint' };

function renderCallout(b, ctx) {
  const title = CALLOUT_TITLES[b.variant];
  const label = title ? `<p class="callout-title">${title}</p>\n` : '';
  return `<div class="callout callout-${escapeHtml(b.variant)}">\n${label}${renderBlocks(b.children, ctx)}\n</div>`;
}

function renderFigure(b, ctx) {
  return b.panels.map(panel => renderFigurePanel(panel, ctx, 'figure')).join('\n');
}

function renderFigurePanel(panel, ctx, kind) {
  const id = panel.label ? ` id="${escapeHtml(anchorId(panel.label))}"` : '';
  const images = panel.images
    .map(img => {
      const file = ctx.figureFile(img.file);
      const style = img.widthIn ? ` style="max-width: ${Math.round(img.widthIn * 96)}px"` : '';
      if (!file) {
        // The figure is not in the source distribution: say so plainly rather
        // than emitting an image that 404s.
        return (
          `<p class="figure-missing" role="note">Figure not available: the source ` +
          `distribution does not include <code>${escapeHtml(img.file)}</code>.</p>`
        );
      }
      // The source has no alt text; the caption is the best available
      // description, and repeating it verbatim would be read out twice.
      const alt = panel.caption ? escapeHtml(texToPlain(panel.caption, ctx.mathSpans)) : '';
      return `<img src="/figures/${escapeHtml(file)}" alt="${alt}" loading="lazy"${style} />`;
    })
    .join('\n');
  const number = panel.number
    ? `<span class="figure-number">${kind === 'table' ? 'Table' : 'Figure'} ${escapeHtml(panel.number)}.</span> `
    : '';
  const caption = panel.caption ? renderInline(panel.caption, ctx) : '';
  const figcaption = number || caption ? `<figcaption>${number}${caption}</figcaption>\n` : '';
  const body = kind === 'table' ? '' : `${images}\n`;
  return `<figure class="${kind}"${id}>\n${body}${figcaption}</figure>`;
}

function renderTableFloat(b, ctx) {
  const panel = b.panels[0];
  const id = panel && panel.label ? ` id="${escapeHtml(anchorId(panel.label))}"` : '';
  const number = panel && panel.number
    ? `<span class="table-number">Table ${escapeHtml(panel.number)}.</span> `
    : '';
  const caption = panel && panel.caption ? renderInline(panel.caption, ctx) : '';
  const figcaption = number || caption ? `<figcaption>${number}${caption}</figcaption>\n` : '';
  const body = b.children ? renderBlocks(b.children, ctx) : '';
  return `<figure class="table-float"${id}>\n${figcaption}${body}\n</figure>`;
}
