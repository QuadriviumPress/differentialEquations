// model/errata.js — corrections applied to the source distribution's own text.
//
// trench-distro/ is ground truth and is never edited, so the few places where
// the source contradicts itself are corrected here, in the open, and reported
// in generated/build-report.json.

/**
 * Two \chaptertitle arguments are truncated mid-phrase. The book's own table of
 * contents gives the full titles, and both chapters' running heads and cross
 * references use them.
 */
export const CHAPTER_TITLES = {
  7: {
    from: 'Series Solutions of Linear Second Equations',
    to: 'Series Solutions of Linear Second Order Equations',
    why: 'the table of contents reads "Series Solutions of Linear Second Order Equations"',
  },
  12: {
    from: 'Fourier Solutions of Partial Differential',
    to: 'Fourier Solutions of Partial Differential Equations',
    why: 'the table of contents reads "Fourier Solutions of Partial Differential Equations"',
  },
};

/**
 * Apply the chapter-title erratum for `number`, recording what was changed.
 * Titles that no longer match `from` are left alone and reported, so an updated
 * source distribution cannot be silently mis-corrected.
 */
export function correctChapterTitle(number, title, applied, warnings) {
  const fix = CHAPTER_TITLES[Number(number)];
  if (!fix) return title;
  if (title !== fix.from) {
    warnings.push(
      `errata: chapter ${number} title is "${title}", expected "${fix.from}" — erratum not applied`
    );
    return title;
  }
  applied.push({ chapter: Number(number), ...fix });
  return fix.to;
}
