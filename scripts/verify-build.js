#!/usr/bin/env node

/**
 * verify-build.js — integrity assertions over the built site (_site).
 *
 * Checks:
 *   1. every page the model predicts was emitted (and a hard floor)
 *   2. every internal href resolves to an emitted file; every #fragment
 *      resolves to an id on the target page
 *   3. every referenced figure exists, except the ones the source
 *      distribution is known not to ship
 *   4. no LaTeX leakage outside math containers
 *   5. numbers on each section page belong to that section and increase
 *   6. no unresolved cross-references (.missing-ref)
 *   7. build report clean: no unknown LaTeX constructs, and no build warning
 *      beyond the known source defects listed in KNOWN_SOURCE_DEFECTS
 *   8. exercises are numbered and their answers attached
 *   9. search index present with >50 documents
 *  10. vendor files (MathJax, MiniSearch), sw.js, manifest, icons emitted
 *  11. book index page has A–Z structure and >=500 linked refs
 *
 * Exits non-zero on any failure. Run after `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'glob';
import * as cheerio from 'cheerio';
import { parseBook } from '../lib/parse/book.js';
import { parseAnswers } from '../lib/parse/answers.js';
import { buildModel } from '../lib/model/numbering.js';
import { figuresSrcDir } from '../lib/paths.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteDir = path.join(root, '_site');
const PREFIX = process.env.VERCEL ? '' : '/differentialEquations';
const CI = !!process.env.CI;

/**
 * Warnings the build is expected to emit, each a defect in the source
 * distribution that the build recovers from deliberately. Any warning that does
 * not match one of these is a regression and fails the check.
 */
const KNOWN_SOURCE_DEFECTS = [
  /^answers: duplicate answer for exercise 2\.1\.29/,
  /^answers: answer (7\.4\.9|8\.3\.35) ends with an unclosed group/,
  /^2\.5-body: unclosed \{/,
  /^table-of-integrals: unclosed \{/,
  /^4\.5-body: example without a \\label/,
  /^11\.2-body: \\begin\{example\} without \\end\{example\}/,
  /^11\.3-body: unbalanced \\end\{example\}/,
];

let failures = 0;
let checks = 0;
const fail = msg => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const pass = msg => {
  checks++;
  console.log(`  ✓ ${msg}`);
};
const note = msg => console.log(`  · ${msg}`);

if (!fs.existsSync(siteDir)) {
  console.error('_site not found — run `npm run build` first');
  process.exit(1);
}

// ---------- 1. page set ----------------------------------------------------
console.log('\npage set');
const structure = parseBook(root);
const { answers } = parseAnswers(structure.answersTex);
const model = buildModel(structure, answers);
let missingPages = 0;
for (const page of model.pages) {
  if (!fs.existsSync(path.join(siteDir, page.url, 'index.html'))) {
    fail(`missing page: ${page.url}`);
    missingPages++;
  }
}
if (missingPages === 0) pass(`all ${model.pages.length} model pages emitted`);
if (model.pages.length < 85) fail(`page floor: expected >=85 model pages, got ${model.pages.length}`);
else pass(`page count above floor (${model.pages.length} >= 85)`);
if (model.chapters.length !== 13) fail(`expected 13 chapters, got ${model.chapters.length}`);
else pass('13 chapters');

// ---------- load all HTML ---------------------------------------------------
const htmlFiles = (await glob('**/*.html', { cwd: siteDir })).filter(
  f => !f.startsWith('assets/')
);
const pages = new Map(); // site-relative path -> { $, ids:Set }
for (const file of htmlFiles) {
  const $ = cheerio.load(fs.readFileSync(path.join(siteDir, file), 'utf8'));
  const ids = new Set();
  $('[id]').each((_, el) => ids.add($(el).attr('id')));
  pages.set(file, { $, ids });
}

const resolveTarget = href => {
  // internal root-relative URL (with the deployment prefix) -> site file path
  let p = href;
  if (PREFIX && p.startsWith(PREFIX)) p = p.slice(PREFIX.length);
  if (p === '' || p === '/') p = '/index.html';
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '/index.html';
  return p.replace(/^\//, '');
};

// ---------- 2. link + fragment integrity ------------------------------------
console.log('\nlinks');
let badLinks = 0;
let badFragments = 0;
let linkCount = 0;
for (const [file, { $, ids }] of pages) {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (/^(https?:|mailto:|#)/.test(href)) {
      if (href.startsWith('#') && href.length > 1 && !ids.has(href.slice(1))) {
        fail(`${file}: dead same-page fragment ${href}`);
        badFragments++;
      }
      return;
    }
    if (!href.startsWith('/')) return; // relative links not produced by the build
    linkCount++;
    const [pathPart, fragment] = href.split('#');
    const target = resolveTarget(pathPart);
    const targetPage = pages.get(target);
    if (!targetPage && !fs.existsSync(path.join(siteDir, target))) {
      fail(`${file}: broken link ${href}`);
      badLinks++;
      return;
    }
    if (fragment && targetPage && !targetPage.ids.has(fragment)) {
      fail(`${file}: dead fragment ${href}`);
      badFragments++;
    }
  });
}
if (badLinks === 0) pass(`all ${linkCount} internal links resolve`);
if (badFragments === 0) pass('all fragments resolve');

// ---------- 3. figures -------------------------------------------------------
console.log('\nfigures');
const report = (() => {
  const p = path.join(root, 'generated', 'build-report.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
})();

const figureRefs = new Set();
for (const [, { $ }] of pages) {
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src.includes('/figures/')) figureRefs.add(src.slice(src.indexOf('/figures/') + 9));
  });
}
const figuresDir = path.join(siteDir, 'figures');
const missingImages = [...figureRefs].filter(
  ref => !fs.existsSync(path.join(figuresDir, ref))
);
if (missingImages.length > 0) {
  fail(`${missingImages.length} referenced figure files missing (e.g. ${missingImages[0]})`);
} else {
  pass(`all ${figureRefs.size} referenced figure files exist`);
}

// Figures the distribution does not carry render as a placeholder, never as a
// broken image — but the count must not grow silently.
const epsAvailable = fs.readdirSync(figuresSrcDir(root)).filter(f => f.endsWith('.eps')).length;
const missingFromSource = report ? report.figures.missing.length : 0;
if (missingFromSource > 0) {
  const placeholders = [...pages.values()].reduce(
    (n, { $ }) => n + $('.figure-missing').length,
    0
  );
  note(
    `${missingFromSource} figures are absent from trench-distro/EPS (${epsAvailable} EPS present); ` +
      `${placeholders} placeholders rendered`
  );
  if (missingFromSource > 110) fail(`missing-figure count grew to ${missingFromSource}`);
  else pass('missing-figure count within the known baseline (<=110)');
}

// ---------- 4. LaTeX leakage -------------------------------------------------
console.log('\nlatex leakage');
let leaks = 0;
for (const [file, { $ }] of pages) {
  const clone = cheerio.load($.html());
  clone('.equation-block, script, style').remove();
  const text = clone('body').text().replace(/\\\((?:[^\\]|\\[^)])*\\\)/g, ' ');
  const m = text.match(
    /\\(emph|index|input|begin|ref|eqref|label|href|hyperref|caption|includegraphics|item|newsection|boxit)\{/
  );
  if (m) {
    fail(`${file}: LaTeX leakage "${m[0]}"`);
    leaks++;
  }
}
if (leaks === 0) pass('no LaTeX commands outside math containers');

// ---------- 5. numbering belongs to its section ------------------------------
console.log('\nnumbering');
let numberingErrors = 0;
for (const page of model.pages) {
  if (page.kind !== 'section') continue;
  const file = path.join(siteDir, page.url, 'index.html');
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');

  const groups = { Figure: [], Table: [], Equation: [] };
  for (const m of html.matchAll(
    /<span class="(?:figure|table)-number">(Figure|Table) ([0-9.]+)\.<\/span>/g
  )) {
    groups[m[1]].push(m[2]);
  }
  for (const m of html.matchAll(/\\tag\{([0-9.]+)\}/g)) groups.Equation.push(m[1]);

  // Trench restarts the equation counter inside a few exercise sets
  // (\setcounter{equation}{0}), exactly as the print edition does, so allow one
  // restart per such directive in this section's source and no more.
  const sectionTex = `${page.section.bodyTex}${page.section.exercisesTex ?? ''}`;
  const allowedRestarts = {
    Equation: (sectionTex.match(/\\setcounter\{equation\}/g) ?? []).length,
    Figure: (sectionTex.match(/\\setcounter\{figure\}/g) ?? []).length,
    Table: (sectionTex.match(/\\setcounter\{table\}/g) ?? []).length,
  };

  for (const [kind, numbers] of Object.entries(groups)) {
    let previous = 0;
    let restarts = 0;
    for (const num of numbers) {
      const parts = num.split('.');
      const section = parts.slice(0, 2).join('.');
      const n = Number(parts[2]);
      if (section !== page.number) {
        fail(`${page.url}: ${kind} ${num} does not belong to section ${page.number}`);
        numberingErrors++;
      } else if (!(n > previous)) {
        restarts++;
        if (restarts > allowedRestarts[kind]) {
          fail(
            `${page.url}: ${kind} ${num} is out of order (after ${previous}); ` +
              `only ${allowedRestarts[kind]} counter restart(s) declared in the source`
          );
          numberingErrors++;
        }
      }
      previous = n;
    }
  }
}
if (numberingErrors === 0) {
  pass('figure/table/equation numbers belong to their section and increase');
}

// ---------- 6. unresolved refs ------------------------------------------------
console.log('\nreferences');
let missingRefs = 0;
for (const [, { $ }] of pages) missingRefs += $('.missing-ref').length;
if (missingRefs === 0) pass('no unresolved cross-references');
else fail(`${missingRefs} unresolved cross-references (.missing-ref)`);

// ---------- 7. build report ----------------------------------------------------
console.log('\nbuild report');
if (!report) {
  fail('generated/build-report.json missing');
} else {
  const unexpected = report.warnings.filter(w => !KNOWN_SOURCE_DEFECTS.some(re => re.test(w)));
  if (unexpected.length === 0) {
    pass(`only known source-defect warnings (${report.warnings.length})`);
  } else {
    fail(`${unexpected.length} unexpected build warnings (first: ${unexpected[0]})`);
  }
  if (report.unknownConstructs.length === 0) pass('zero unknown LaTeX constructs');
  else
    fail(`unknown LaTeX constructs: ${report.unknownConstructs.map(u => u.command).join(', ')}`);

  if (report.numberingMismatches.length <= 2) {
    pass(`${report.numberingMismatches.length} numbering mismatches (source gaps)`);
  } else {
    fail(`${report.numberingMismatches.length} numbering mismatches (expected <=2)`);
  }
  if (report.notices.length > 0) note(`${report.notices.length} notices (non-fatal source quirks)`);
  if (report.texMacros.shipped.length >= 20) {
    pass(`${report.texMacros.shipped.length} TeX macros shipped to MathJax`);
  } else {
    fail(`only ${report.texMacros.shipped.length} TeX macros extracted`);
  }
}

// ---------- 8. exercises and answers --------------------------------------------
console.log('\nexercises');
if (report) {
  if (report.exercises === 2041) pass(`${report.exercises} exercises`);
  else fail(`expected 2041 exercises, got ${report.exercises}`);
  if (report.answers === 1723) pass(`${report.answers} answers`);
  else fail(`expected 1723 answers, got ${report.answers}`);
}
let inlineAnswers = 0;
let unnumbered = 0;
for (const [, { $ }] of pages) {
  inlineAnswers += $('details.exercise-answer').length;
  $('li.tex-exercise').each((_, el) => {
    if (!$(el).attr('value')) unnumbered++;
  });
}
if (unnumbered === 0) pass('every exercise carries its print number');
else fail(`${unnumbered} exercises without a number`);
// Each answer appears twice: inline on the exercise and on the answers page.
if (inlineAnswers >= 1700) pass(`${inlineAnswers} answers rendered inline with their exercise`);
else fail(`only ${inlineAnswers} inline answers`);

// ---------- 9. search index -----------------------------------------------------
console.log('\nsearch');
const indexPath = path.join(siteDir, 'search_index.json');
if (!fs.existsSync(indexPath)) {
  fail('search_index.json missing (postbuild not run?)');
} else {
  const docs = JSON.parse(fs.readFileSync(indexPath, 'utf8')).documents;
  if (docs.length > 50) pass(`search index: ${docs.length} documents`);
  else fail(`search index too small: ${docs.length} documents`);
}

// ---------- 10. shell files -------------------------------------------------------
console.log('\napp shell');
for (const file of [
  'sw.js',
  'manifest.webmanifest',
  'SUMMARY.html',
  'summary.json',
  'assets/js/tex-macros.js',
  'assets/js/mathjax/tex-chtml.js',
  'assets/js/vendor/minisearch.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
]) {
  if (fs.existsSync(path.join(siteDir, file))) pass(file);
  else fail(`missing: ${file}`);
}

// ---------- 11. book index --------------------------------------------------------
console.log('\nbook index');
const bookIndexFile = pages.get('book-index.html');
if (!bookIndexFile) {
  fail('book-index.html missing');
} else {
  const letters = bookIndexFile.$('.book-index h2').length;
  const refs = bookIndexFile.$('.index-entries a').length;
  if (letters >= 20) pass(`${letters} letter sections`);
  else fail(`only ${letters} letter sections`);
  if (refs >= 500) pass(`${refs} linked index references`);
  else fail(`only ${refs} linked index references`);
}

// ---------- result ----------------------------------------------------------------
console.log(`\n${checks} checks passed, ${failures} failures`);
process.exit(failures > 0 ? 1 : 0);
