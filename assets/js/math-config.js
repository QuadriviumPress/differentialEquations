MathJax = {
  options: {
    // Skip processing elements with this class (for lazy loading)
    ignoreHtmlClass: 'mathjax-skip',
    enableMenu: true,
    menuOptions: {
      settings: {
        enrich: true,
        speech: true,
        braille: true,
        help: true,
        inTabOrder: true,
        assistiveMml: false,
      },
    },
    a11y: {
      subtitles: true,
      viewBraille: false,
      voicing: false,
    },
  },
  tex: {
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)'],
    ],
    displayMath: [
      ['$$', '$$'],
      ['\\[', '\\]'],
    ],
    processEscapes: true,
    processEnvironments: true,
    // Equation numbers are injected at build time as \tag{...} so they match
    // the print edition exactly; MathJax must not add its own.
    tags: 'none',
    // The book's own \newcommand definitions, extracted from wtrench.sty and
    // the preamble by the build (assets/js/tex-macros.js).
    macros: window.TrenchTeXMacros || {},
  },
  chtml: {
    displayOverflow: 'overflow',
    scale: 1.0,
    minScale: 0.5,
  },
};
