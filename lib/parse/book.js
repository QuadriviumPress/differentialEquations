// parse/book.js — the monolithic TRENCH_DIFFEQ_BV.tex → book structure.
//
// Unlike a driver file with \input modules, this book is one 62k-line .tex with
// no \chapter or \section at all: structure comes from the wtrench.sty macros.
//
//   \setcounter{chapter}{N}          chapter number (authoritative)
//   \chaptertitle{Title}             chapter starts; text until the first
//                                    \newsection is the chapter introduction
//   \newsection{k}{chapter}{title}   section k of the current chapter
//   \exercises                       splits a section body from its exercise set
//
// Back matter is delimited by its pdf bookmarks: "Answers to Selected" runs to
// the "Index" bookmark, and the index itself is a \begin{tindex} environment.
//
// Slices are returned as raw TeX; tokenizing happens in parse/unit.js.
import fs from 'node:fs';
import { bookFile } from '../paths.js';
import { extractBraceGroup } from './tex-utils.js';

const CHAPTER_RE = /\\chaptertitle\s*\{/g;
const SECTION_RE = /\\newsection\s*\{/g;
const ANSWERS_RE = /\\pdfbookmark\[0\]\{Answers to Selected\}/;
const INDEX_RE = /\\pdfbookmark\[0\]\{Index\}/;
const PREFACE_RE = /\\pdfbookmark\[0\]\{Preface\}/;
// A short appendix sits between the last section and the answers.
const INTEGRALS_RE = /\\currentpdfbookmark\{A Brief Table of Integrals\}/;

/** Collapse the whitespace a title may carry across source line breaks. */
function tidyTitle(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Find every `\marker{...}` in text, returning the match start, the first brace
 * group's value, and the offset just past that group.
 */
function findAll(text, re, warnings, what) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const braceAt = text.indexOf('{', m.index);
    const group = extractBraceGroup(text, braceAt);
    if (!group) {
      warnings.push(`book: unbalanced ${what} at offset ${m.index}`);
      continue;
    }
    hits.push({ start: m.index, value: group.value, end: group.end });
    re.lastIndex = group.end;
  }
  return hits;
}

/** The N of the \setcounter{chapter}{N} that most closely precedes `at`. */
function chapterNumberBefore(text, at, warnings) {
  const window = text.slice(Math.max(0, at - 400), at);
  const matches = [...window.matchAll(/\\setcounter\{chapter\}\{(\d+)\}/g)];
  if (matches.length === 0) {
    warnings.push(`book: \\chaptertitle at offset ${at} has no \\setcounter{chapter}`);
    return null;
  }
  return matches[matches.length - 1][1];
}

/**
 * \newsection{k}{chapter running head}{section title} — read the second and
 * third groups after the first.
 */
function sectionParts(text, hit, warnings) {
  const g2 = extractBraceGroup(text, skipWs(text, hit.end));
  const g3 = g2 && extractBraceGroup(text, skipWs(text, g2.end));
  if (!g2 || !g3) {
    warnings.push(`book: \\newsection{${hit.value}} is missing its title arguments`);
    return { title: null, end: hit.end };
  }
  return { title: tidyTitle(g3.value), end: g3.end };
}

function skipWs(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/** Split a section body at \exercises: prose first, exercise set second. */
function splitExercises(tex) {
  const at = tex.search(/\\exercises\b/);
  if (at === -1) return { bodyTex: tex, exercisesTex: null };
  return {
    bodyTex: tex.slice(0, at),
    exercisesTex: tex.slice(at + '\\exercises'.length),
  };
}

export function parseBook(root) {
  // The distribution is CRLF; normalize once so every downstream offset, regex
  // and paragraph split sees plain \n.
  const tex = fs.readFileSync(bookFile(root), 'utf8').replace(/\r\n/g, '\n');
  const bodyStart = tex.indexOf('\\begin{document}');
  const bodyEnd = tex.lastIndexOf('\\end{document}');
  const body = tex.slice(bodyStart + '\\begin{document}'.length, bodyEnd);

  const warnings = [];

  // ---- back matter boundaries (everything before them is chapter content) ---
  const answersAt = body.search(ANSWERS_RE);
  const indexAt = body.search(INDEX_RE);
  if (answersAt === -1) warnings.push('book: no "Answers to Selected" bookmark found');
  if (indexAt === -1) warnings.push('book: no "Index" bookmark found');
  const backMatterAt = answersAt !== -1 ? answersAt : indexAt !== -1 ? indexAt : body.length;

  // "A Brief Table of Integrals" is its own back-matter page, not a tail of the
  // last section.
  const integralsAt = body.search(INTEGRALS_RE);
  // The answers section redefines \newsection before its bookmark; that setup
  // belongs to the answers, not to the table of integrals.
  const integralsEnd = (() => {
    if (integralsAt === -1 || integralsAt > backMatterAt) return -1;
    const setup = body.indexOf('\\renewcommand{\\newsection}', integralsAt);
    return setup !== -1 && setup < backMatterAt ? setup : backMatterAt;
  })();
  const integralsTex = integralsEnd === -1 ? null : body.slice(integralsAt, integralsEnd);
  const chapterLimit =
    integralsTex === null ? backMatterAt : Math.min(integralsAt, backMatterAt);

  const answersTex =
    answersAt === -1 ? null : body.slice(answersAt, indexAt === -1 ? body.length : indexAt);

  let indexTex = null;
  if (indexAt !== -1) {
    const open = body.indexOf('\\begin{tindex}', indexAt);
    const close = body.indexOf('\\end{tindex}', open);
    if (open === -1 || close === -1) warnings.push('book: index bookmark without a tindex environment');
    else indexTex = body.slice(open + '\\begin{tindex}'.length, close);
  }

  // ---- front matter --------------------------------------------------------
  const chapterHits = findAll(body, CHAPTER_RE, warnings, '\\chaptertitle').filter(
    h => h.start < chapterLimit
  );
  if (chapterHits.length === 0) warnings.push('book: no chapters found');

  const prefaceAt = body.search(PREFACE_RE);
  const firstChapterAt = chapterHits.length > 0 ? chapterHits[0].start : chapterLimit;
  // The printed table of contents is replaced by the site's own navigation, so
  // only the preface is carried over from the front matter.
  const prefaceTex =
    prefaceAt === -1 || prefaceAt > firstChapterAt
      ? null
      : body.slice(prefaceAt, firstChapterAt);
  if (prefaceTex === null) warnings.push('book: no preface found in the front matter');

  // ---- chapters and sections ----------------------------------------------
  const sectionHits = findAll(body, SECTION_RE, warnings, '\\newsection').filter(
    h => h.start < chapterLimit
  );

  const chapters = [];
  chapterHits.forEach((hit, ci) => {
    const chapterEnd = ci + 1 < chapterHits.length ? chapterHits[ci + 1].start : chapterLimit;
    const number = chapterNumberBefore(body, hit.start, warnings);
    const own = sectionHits.filter(s => s.start > hit.end && s.start < chapterEnd);

    const chapter = {
      number,
      title: tidyTitle(hit.value),
      // Trench's chapter openers ("IN THIS CHAPTER ... SECTION 1.1 presents ...")
      // run from the title to the first section.
      introTex: body.slice(hit.end, own.length > 0 ? own[0].start : chapterEnd),
      sections: [],
    };

    own.forEach((s, si) => {
      const parts = sectionParts(body, s, warnings);
      const sectionEnd = si + 1 < own.length ? own[si + 1].start : chapterEnd;
      const sectionTex = body.slice(parts.end, sectionEnd);
      const { bodyTex, exercisesTex } = splitExercises(sectionTex);
      const numberInChapter = Number(s.value.trim());
      if (!Number.isInteger(numberInChapter)) {
        warnings.push(`book: \\newsection with non-numeric index "${s.value}"`);
      }
      if (numberInChapter !== si + 1) {
        warnings.push(
          `book: chapter ${number} section ${si + 1} declares \\newsection{${s.value}}`
        );
      }
      chapter.sections.push({
        number: number === null ? null : `${number}.${numberInChapter}`,
        numberInChapter,
        title: parts.title ?? `Section ${numberInChapter}`,
        bodyTex,
        exercisesTex,
      });
    });

    if (chapter.sections.length === 0) {
      warnings.push(`book: chapter ${number} (${chapter.title}) has no sections`);
    }
    chapters.push(chapter);
  });

  return { prefaceTex, chapters, integralsTex, answersTex, indexTex, warnings };
}
