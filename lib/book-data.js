// buildBook(): parse → model → render orchestration.
//
//   parse/book.js       TRENCH_DIFFEQ_BV.tex → chapters/sections/back matter
//   parse/answers.js    "Answers to Selected Exercises" → answers by exercise
//   model/numbering.js  page URLs and print-style chapter/section numbers
//   parse/tokenizer.js  each unit of TeX → block list
//   model/content.js    equation/example/theorem/figure/table/exercise numbers
//                       and the anchors map
//   render/transform.js blocks → HTML
//
// A build report (warnings, numbering mismatches, unknown LaTeX constructs) is
// written to generated/build-report.json; verify-build.js fails CI on
// regressions.
import fs from 'node:fs';
import path from 'node:path';
import { parseBook } from './parse/book.js';
import { parseAnswers } from './parse/answers.js';
import { tokenize, protectMath } from './parse/tokenizer.js';
import { buildModel, ANSWERS_TITLE } from './model/numbering.js';
import { annotateContent, anchorId } from './model/content.js';
import { buildBookIndex } from './model/book-index.js';
import { extractMacros } from './model/macros.js';
import { renderUnit } from './render/transform.js';
import { renderInline, escapeHtml, texToPlain } from './render/inline.js';
import { generatedFiguresDir } from './paths.js';

const SITE_TITLE = 'Elementary Differential Equations with Boundary Value Problems';

/** Render a raw title (which may contain math) for use in a heading. */
function renderTitle(tex, baseCtx) {
  const { text, mathSpans } = protectMath(tex, baseCtx.warnings, 'title');
  return renderInline(text, { ...baseCtx, mathSpans, name: 'title' });
}

function sectionListHtml(chapter) {
  if (chapter.sections.length === 0) return '';
  const items = chapter.sections
    .map(s => `<li><a href="${s.url}">${escapeHtml(s.displayTitle)}</a></li>`)
    .join('\n');
  return `<nav class="chapter-sections" aria-label="Sections">\n<ul>\n${items}\n</ul>\n</nav>`;
}

export function buildBook({ root }) {
  const structure = parseBook(root);
  const { answers, warnings: answerWarnings } = parseAnswers(structure.answersTex);
  const model = buildModel(structure, answers);

  const warnings = [...structure.warnings, ...answerWarnings, ...model.warnings];
  const notices = [];

  // ---- tokenize every unit -------------------------------------------------
  const tokenized = new Map();
  for (const page of model.pages) {
    for (const unit of page.units) {
      const mod = tokenize(unit.tex, { name: unit.name });
      warnings.push(...mod.warnings);
      notices.push(...mod.notices);
      tokenized.set(unit.name, { ...mod, name: unit.name });
    }
  }

  const { anchors, mismatches } = annotateContent(model, tokenized, warnings, notices);

  // ---- shared render context ----------------------------------------------
  const unknownConstructs = new Map(); // command -> Set of unit names

  // Figures are SVG (line art) or PNG (whatever dvisvgm cannot vectorize) —
  // convert-figures.js decides per file; pick whichever exists.
  //
  // Returns null when the figure is unavailable, which happens two ways: the
  // converter has not run (a dev machine without dvisvgm — then every figure is
  // absent), or the source distribution never carried that EPS. The renderer
  // shows a labelled placeholder rather than a broken image, and both cases are
  // reported below.
  const figuresDir = generatedFiguresDir(root);
  const convertedAny = fs.existsSync(figuresDir) && fs.readdirSync(figuresDir).length > 0;
  const missingFigures = new Set();
  const figureFile = epsName => {
    for (const ext of ['.svg', '.png']) {
      const candidate = epsName.replace(/\.eps$/, ext);
      if (fs.existsSync(path.join(figuresDir, candidate))) return candidate;
    }
    missingFigures.add(epsName);
    return null;
  };

  const makeCtx = (page, extra = {}) => {
    const ctx = {
      page,
      anchors,
      warnings,
      notices,
      unknown: cmd => {
        if (!unknownConstructs.has(cmd)) unknownConstructs.set(cmd, new Set());
        unknownConstructs.get(cmd).add(ctx.name ?? page?.url ?? 'unknown');
      },
      mathSpans: [],
      name: page?.url ?? 'unit',
      figureFile,
      ...extra,
    };
    return ctx;
  };

  // ---- answers, rendered once and reused inline and in the back matter -----
  // Rendered before the section pages so exercises can embed them.
  const answerHtmlByKey = new Map();
  for (const [key, tex] of answers) {
    const name = `answer-${key}`;
    const mod = tokenize(tex, { name });
    warnings.push(...mod.warnings);
    const ctx = makeCtx(null, { name });
    // Answers live on their exercise's page as well as on the answers page, so
    // links inside them must be absolute rather than same-page fragments.
    ctx.page = null;
    answerHtmlByKey.set(key, renderUnit({ ...mod, name }, ctx));
  }

  // ---- pages ---------------------------------------------------------------
  for (const page of model.pages) {
    const ctx = makeCtx(page, {
      answerHtml: key => answerHtmlByKey.get(key) ?? null,
    });

    const parts = [];

    if (page.kind === 'answers') {
      parts.push(renderAnswersPage(page, answerHtmlByKey, anchors));
    } else {
      for (const unit of page.units) {
        const mod = tokenized.get(unit.name);
        if (!mod) continue;
        if (unit.role === 'exercises') {
          parts.push(`<h2 class="exercises-heading" id="exercises">${page.number} Exercises</h2>`);
        }
        parts.push(renderUnit(mod, ctx));
      }
    }

    if (page.kind === 'chapter') {
      parts.push(sectionListHtml(page.chapter));
      // The chapter PDF link is emitted only when the PDF exists on disk: the
      // deploy workflow generates PDFs after a first build, copies them into
      // assets/pdf/, and rebuilds — so links never 404.
      if (fs.existsSync(path.join(root, 'assets', 'pdf', page.chapter.pdfName))) {
        parts.push(
          `<p class="chapter-pdf"><a href="/assets/pdf/${page.chapter.pdfName}" download>` +
            `Download this chapter as PDF</a></p>`
        );
      }
      if (page.chapter.answersUrl) {
        parts.push(
          `<p class="chapter-answers"><a href="${page.chapter.answersUrl}">` +
            `Answers to selected exercises in this chapter</a></p>`
        );
      }
    }

    page.htmlTitle =
      page.kind === 'section' || page.kind === 'chapter'
        ? `${page.number} ${renderTitle(page.title, ctx)}`
        : escapeHtml(page.displayTitle);
    page.html = `<article>\n${parts.join('\n')}\n</article>`;
  }

  // ---- back-of-book index --------------------------------------------------
  const { groups: indexGroups, warnings: indexWarnings } = buildBookIndex(structure.indexTex);
  warnings.push(...indexWarnings);
  const bookIndex = renderBookIndex(indexGroups, makeCtx(null, { name: 'index' }));

  // ---- per-chapter print pages --------------------------------------------
  const printManifest = [];
  for (const chapter of model.chapters) {
    const chapterPages = model.pages.filter(p => p.chapter === chapter);
    chapter.printHtml = chapterPages
      .map(p => `<section class="print-section">\n<h2>${p.htmlTitle}</h2>\n${p.html}\n</section>`)
      .join('\n');
    printManifest.push({
      printUrl: `/print/${chapter.printSlug}/`,
      pdfName: chapter.pdfName,
      title: chapter.displayTitle,
    });
  }

  // ---- TeX macros for MathJax ---------------------------------------------
  const { macros, skipped: skippedMacros } = extractMacros(root);

  // ---- build report --------------------------------------------------------
  const unknownReport = [...unknownConstructs.entries()]
    .map(([command, units]) => ({ command, units: [...units].sort().slice(0, 20) }))
    .sort((a, b) => a.command.localeCompare(b.command));

  const report = {
    source: 'trench-distro/TRENCH_DIFFEQ_BV.tex',
    chapters: model.chapters.length,
    sections: model.chapters.reduce((n, c) => n + c.sections.length, 0),
    pages: model.pages.length,
    exercises: countExercises(model, tokenized),
    answers: answers.size,
    errata: model.errataApplied,
    figures: {
      converted: convertedAny,
      missing: [...missingFigures].sort(),
    },
    texMacros: { shipped: Object.keys(macros).sort(), skipped: skippedMacros },
    numberingMismatches: mismatches,
    warnings,
    notices,
    unknownConstructs: unknownReport,
  };
  fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'generated', 'build-report.json'),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(root, 'generated', 'print-manifest.json'),
    JSON.stringify(printManifest, null, 2)
  );

  console.log(
    `[book] ${report.chapters} chapters, ${report.sections} sections, ` +
      `${report.exercises} exercises, ${report.answers} answers`
  );
  if (missingFigures.size > 0) {
    console.warn(
      convertedAny
        ? `[book] ${missingFigures.size} figures have no EPS in ${'trench-distro/EPS'} ` +
            '(see generated/build-report.json); placeholders rendered'
        : `[book] no converted figures found — run npm run build (needs dvisvgm)`
    );
  }
  if (notices.length > 0) {
    console.log(`[book] ${notices.length} notices (see generated/build-report.json)`);
  }
  for (const m of mismatches.slice(0, 10)) console.warn(`[book] NUMBERING: ${m}`);
  if (mismatches.length > 10) {
    console.warn(`[book] ...and ${mismatches.length - 10} more numbering mismatches`);
  }
  for (const w of warnings.slice(0, 30)) console.warn(`[book] WARNING: ${w}`);
  if (warnings.length > 30) console.warn(`[book] ...and ${warnings.length - 30} more warnings`);
  for (const u of unknownReport) {
    console.warn(`[book] UNKNOWN CONSTRUCT ${u.command} in ${u.units.join(', ')}`);
  }

  const summaryJson = JSON.stringify(
    {
      title: SITE_TITLE,
      chapters: model.chapters.map(ch => ({
        number: ch.number,
        title: ch.plainTitle,
        url: ch.url,
        sections: ch.sections.map(s => ({ number: s.number, title: s.plainTitle, url: s.url })),
        answersUrl: ch.answersUrl ?? null,
      })),
    },
    null,
    2
  );

  return {
    pages: model.pages,
    chapters: model.chapters,
    answerPages: model.answerPages,
    answersTitle: ANSWERS_TITLE,
    bookIndex,
    macrosJson: JSON.stringify(macros, null, 2),
    summaryJson,
    warningCount: warnings.length,
  };
}

function countExercises(model, tokenized) {
  let n = 0;
  for (const page of model.pages) {
    for (const unit of page.units) {
      const mod = tokenized.get(unit.name);
      if (!mod) continue;
      const walk = blocks => {
        for (const b of blocks) {
          if (b.type === 'exercises') n += b.items.filter(i => !i.note).length;
          if (b.children) walk(b.children);
          if (b.items) for (const it of b.items) if (it.children) walk(it.children);
        }
      };
      walk(mod.blocks);
    }
  }
  return n;
}

/** One chapter of the answers back matter, grouped by section. */
function renderAnswersPage(page, answerHtmlByKey, anchors) {
  const sections = page.answerGroups.map(group => {
    const entries = group.entries
      .map(entry => {
        const html = answerHtmlByKey.get(entry.key) ?? '';
        const exercise = anchors.get(`exer:${entry.key}`);
        const number = entry.key.split('.')[2];
        const back = exercise
          ? `<a class="answer-number" href="${exercise.url}#${exercise.id}">${escapeHtml(number)}</a>`
          : `<span class="answer-number">${escapeHtml(number)}</span>`;
        return (
          `<li id="${escapeHtml(anchorId(`answer:${entry.key}`))}" value="${escapeHtml(number)}">` +
          `${back}${html}</li>`
        );
      })
      .join('\n');
    return (
      `<section class="answer-group">\n` +
      `<h2><a href="${group.section.url}">${escapeHtml(group.section.displayTitle)}</a></h2>\n` +
      `<ol class="answer-list">\n${entries}\n</ol>\n</section>`
    );
  });
  return sections.join('\n');
}

/** Index groups with each entry's TeX rendered (which resolves its \pageref links). */
function renderBookIndex(groups, ctx) {
  const renderEntry = entry => {
    // Index terms carry inline math ("Bessel's equation, $y''+xy=0$"), so each
    // entry needs the same math protection a content unit gets.
    const { text, mathSpans } = protectMath(entry.tex, ctx.warnings, 'index');
    return {
      html: renderInline(text, { ...ctx, mathSpans }),
      plain: texToPlain(text, mathSpans),
      subs: entry.subs.map(renderEntry),
    };
  };
  return groups.map(group => ({
    letter: group.letter,
    entries: group.entries.map(renderEntry),
  }));
}
