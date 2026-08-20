# Elementary Differential Equations — Web Edition

Eleventy build of *Elementary Differential Equations with Boundary Value
Problems* by William F. Trench (Free Edition 1.01, December 2013), rendering the
original LaTeX source to a searchable, offline-capable web textbook.

- **Live site:** https://quadriviumpress.github.io/differentialEquations/
- **Author's edition of record:** https://digitalcommons.trinity.edu/mono/9/
- **License:** [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/)

## How it works

The verbatim Trench source distribution lives in `trench-distro/` — it is ground
truth and is never modified. Everything else is build tooling:

```
trench-distro/       LaTeX source: TRENCH_DIFFEQ_BV.tex (62k lines),
                     wtrench.sty, and EPS/ figures
lib/parse/           the monolithic .tex → chapters/sections/back matter
                     (book.js), answers by exercise (answers.js), and the
                     block tokenizer (math protected first, then
                     comment-stripping, environment-stack blocks)
lib/model/           print-faithful numbering driven by the source's own
                     labels, the anchors map, the back-of-book index, the
                     TeX macro table, and the errata list
lib/render/          blocks → HTML; math passes through raw to MathJax
_data/book.js        exposes the rendered book to Eleventy
pages.njk            paginates every page to its own URL
scripts/             figure conversion (dvisvgm), search index (MiniSearch),
                     verify-build integrity checks, chapter PDF generation
assets/              viewer JS (sidebar TOC, prev/next, dark mode), CSS,
                     self-hosted MathJax v4 + MiniSearch (git-ignored,
                     populated by `npm run update:vendor`)
```

Unknown LaTeX constructs are never silently dropped: they land in
`generated/build-report.json` and fail CI.

### Structure comes from `wtrench.sty`, not `\chapter`

The source has no `\chapter` or `\section` at all. Chapters start at
`\chaptertitle{...}` (numbered by the preceding `\setcounter{chapter}{N}`),
sections at `\newsection{k}{chapter}{title}`, and `\exercises` separates a
section's prose from its exercise set. Back matter is delimited by its PDF
bookmarks. The build produces 13 chapters, 63 sections, 2041 exercises and
1723 answers.

### Numbering matches the print edition

Trench's labels already carry the print number — `\label{eq:2.1.15}` *is*
equation 2.1.15, `\label{example:7.1.1}` is Example 7.1.1 — so the label is
authoritative and a per-section counter runs alongside it purely as a check.
Disagreements are reported in the build report rather than silently accepted
(there are two, both gaps in the source's own numbering). Equation numbers are
injected as `\tag{...}` at build time and MathJax runs with `tags: 'none'`, so
displayed tags, `\eqref` link text and the print edition always agree.

### Two things the web edition does better than print

- **Answers are attached to their exercises.** `\answer{2.1.7}` keys match
  `\label{exer:2.1.7}` exactly, so each answer renders behind a "Show answer"
  disclosure on the exercise itself, as well as on its own back-matter page.
  In print the reader has to turn to p. 583.
- **The index links to what it indexes.** Its page references were written as
  `\pageref{...}` to labels, so every entry links to the exact equation,
  theorem, example or exercise rather than to a page number.

### The book's own TeX macros

`wtrench.sty` and the preamble define macros used inside math (`\twobytwo`,
`\matfunc`, `\dst`, `\lims`, …). `lib/model/macros.js` extracts them at build
time and hands them to MathJax as `tex.macros`, so math typesets exactly as
LaTeX sets it and stays correct if the source distribution is updated.

## Known gaps in the source distribution

These are defects in the imported source, not in the build. All are listed in
`generated/build-report.json`, and `npm run verify` fails if any *new* one
appears.

- **Figure sources restored.** The complete EPS set from the author's 2013
  LaTeX distribution is now in `trench-distro/EPS/`; all 197 referenced book
  figures convert and render locally.
- Two `\chaptertitle` arguments are truncated mid-phrase (chapters 7 and 12);
  the book's own table of contents gives the full titles, and `lib/model/errata.js`
  applies exactly those two corrections, in the open.
- Chapter 11 drops an `\end{example}` and chapter 13 carries a stray one;
  §2.5 and the table of integrals each leave a brace group unclosed; exercise
  2.1.29 is answered twice; two answers end with an unclosed `{\bf`; §4.5 has
  an unlabeled example. The build recovers from each deliberately and says so.

## Developing

Requires Node ≥ 22. For figure conversion also install ghostscript + dvisvgm +
mupdf-tools (`sudo apt-get install ghostscript dvisvgm mupdf-tools
texlive-binaries`); without them the site builds with figures missing.

```sh
npm ci
npm run update:vendor   # populate self-hosted MathJax + MiniSearch (once)
npm run build           # figures -> Eleventy -> search index
npm run verify          # integrity checks over _site
npm run serve           # dev server at http://localhost:4000/differentialEquations/
```

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`: build → verify →
per-chapter PDFs (Playwright printing the `/print/<chapter>/` pages) → rebuild
with the PDF download links → deploy to GitHub Pages. Pull requests run the same
build + verify via `ci.yml`.

## Attribution

Content © 2013 William F. Trench, licensed under the Creative Commons
Attribution-NonCommercial-ShareAlike 3.0 Unported license. This repository
redistributes the book source and derived HTML under the same license. The book
was published previously by Brooks/Cole Thomson Learning (2001) and was judged
to meet the evaluation criteria of the American Institute of Mathematics' Open
Textbook Initiative.
