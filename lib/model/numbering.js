// model/numbering.js — turn the parsed book into chapters, sections and the
// site's page list in reading order.
//
// Page kinds:
//   preface   — the author's preface (the printed table of contents is dropped;
//               the site has its own navigation)
//   chapter   — landing page: the chapter opener plus its section list
//   section   — one \newsection == one page, carrying the section prose and,
//               below it, that section's exercise set
//   answers   — one back-matter page per chapter of "Answers to Selected
//               Exercises", grouped by section
//   Numbering matches the print edition: chapters 1..13, sections C.k.
import { slugify } from './slugs.js';
import { correctChapterTitle } from './errata.js';

export const ANSWERS_TITLE = 'Answers to Selected Exercises';

export function buildModel(structure, answers) {
  const warnings = [];
  const errataApplied = [];
  const chapters = [];
  const pages = [];

  if (structure.prefaceTex) {
    pages.push({
      kind: 'preface',
      permalink: '/preface/index.html',
      url: '/preface/',
      title: 'Preface',
      displayTitle: 'Preface',
      number: null,
      chapter: null,
      units: [{ name: 'preface', tex: structure.prefaceTex, role: 'preface' }],
    });
  }

  for (const src of structure.chapters) {
    const number = src.number;
    const title = correctChapterTitle(number, src.title, errataApplied, warnings);
    const slug = slugify(title);
    const url = `/${number}-${slug}/`;

    const chapter = {
      number,
      title,
      plainTitle: title,
      displayTitle: `${number} ${title}`,
      slug,
      url,
      sections: [],
      // Print-page slug and PDF name for the /print/ route.
      printSlug: `chapter-${number}`,
      pdfName: `trench-de-chapter-${number}.pdf`,
    };

    for (const s of src.sections) {
      const sSlug = slugify(s.title);
      chapter.sections.push({
        number: s.number,
        title: s.title,
        plainTitle: s.title,
        displayTitle: `${s.number} ${s.title}`,
        url: `/${number}-${s.numberInChapter}-${sSlug}/`,
        bodyTex: s.bodyTex,
        exercisesTex: s.exercisesTex,
      });
    }
    chapters.push(chapter);

    pages.push({
      kind: 'chapter',
      permalink: `${url}index.html`,
      url,
      title,
      displayTitle: chapter.displayTitle,
      number,
      chapter,
      units: [{ name: `ch${number}-intro`, tex: src.introTex, role: 'intro' }],
    });

    for (const s of chapter.sections) {
      const units = [{ name: `${s.number}-body`, tex: s.bodyTex, role: 'body' }];
      if (s.exercisesTex) {
        units.push({ name: `${s.number}-exercises`, tex: s.exercisesTex, role: 'exercises' });
      }
      pages.push({
        kind: 'section',
        permalink: `${s.url}index.html`,
        url: s.url,
        title: s.title,
        displayTitle: s.displayTitle,
        number: s.number,
        chapter,
        section: s,
        units,
      });
    }
  }

  if (structure.integralsTex) {
    pages.push({
      kind: 'appendix',
      permalink: '/table-of-integrals/index.html',
      url: '/table-of-integrals/',
      title: 'A Brief Table of Integrals',
      displayTitle: 'A Brief Table of Integrals',
      number: null,
      chapter: null,
      units: [{ name: 'table-of-integrals', tex: structure.integralsTex, role: 'appendix' }],
    });
  }

  // ---- answers back matter, one page per chapter ---------------------------
  const answerPages = [];
  for (const chapter of chapters) {
    const groups = [];
    for (const s of chapter.sections) {
      const entries = [...answers.keys()]
        .filter(k => k.startsWith(`${s.number}.`))
        .sort(compareExerciseKeys)
        .map(key => ({ key, tex: answers.get(key) }));
      if (entries.length > 0) groups.push({ section: s, entries });
    }
    if (groups.length === 0) continue;

    const url = `/answers/${chapter.number}-${chapter.slug}/`;
    const page = {
      kind: 'answers',
      permalink: `${url}index.html`,
      url,
      title: `${ANSWERS_TITLE}: Chapter ${chapter.number}`,
      displayTitle: `Chapter ${chapter.number} ${chapter.title}`,
      number: null,
      chapter,
      units: [],
      answerGroups: groups,
    };
    chapter.answersUrl = url;
    answerPages.push(page);
  }
  pages.push(...answerPages);

  return { chapters, pages, answerPages, warnings, errataApplied };
}

/** "2.1.9" sorts before "2.1.10". */
function compareExerciseKeys(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
