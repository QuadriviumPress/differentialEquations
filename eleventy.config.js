// GitHub Pages serves this project site under /differentialEquations/. Vercel serves
// it at a domain root, so it must build with no path prefix — detected via the VERCEL
// env var that Vercel sets automatically.
const PATH_PREFIX = process.env.VERCEL ? '/' : '/differentialEquations/';

export default function (eleventyConfig) {
  // Input is the repo root (which is primarily LaTeX content, not templates), so drive
  // input exclusions explicitly from .eleventyignore rather than .gitignore.
  eleventyConfig.setUseGitIgnore(false);

  // The LaTeX source is not part of Eleventy's template graph (it is read by
  // _data/book.js), so watch it manually for dev-server rebuilds.
  eleventyConfig.addWatchTarget('./trench-distro/');
  eleventyConfig.addWatchTarget('./lib/');

  // Root-relative asset/link URLs get the pathPrefix at build time. Narrow regex
  // transform (same approach as the sibling book sites): prefixes ONLY single-slash
  // root-relative href/src and leaves ./ ../ # http(s) verbatim.
  eleventyConfig.addTransform('pathPrefix', function (content) {
    const out = this.page && this.page.outputPath;
    if (typeof out !== 'string' || !out.endsWith('.html')) return content;
    const prefix = PATH_PREFIX.replace(/\/+$/, '');
    if (!prefix) return content; // root-hosted (Vercel): nothing to add
    return content.replace(
      /(\s(?:href|src)=)"(\/(?!\/)[^"]*)"/g,
      (_, pre, url) => `${pre}"${prefix}${url}"`
    );
  });

  // window.Book.rootUrl/baseHref must have NO trailing slash (they concatenate
  // with /SUMMARY.html etc.).
  eleventyConfig.addFilter('trimSlash', v => String(v).replace(/\/+$/, ''));

  // Passthrough paths are relative to the project root. Figures are SVGs generated
  // from the distro EPS files by scripts/convert-figures.js (prebuild).
  eleventyConfig.addPassthroughCopy({ assets: 'assets' });
  eleventyConfig.addPassthroughCopy({ 'generated/figures': 'figures' });

  // Dev server: serve passthrough files from their source location instead of
  // copying them into _site on every serve.
  eleventyConfig.setServerPassthroughCopyBehavior('passthrough');

  return {
    dir: {
      input: '.',
      includes: '_includes',
      layouts: '_includes/layouts',
      data: '_data',
    },
    templateFormats: ['njk'], // content comes from LaTeX via _data/book.js, not files
    htmlTemplateEngine: 'njk',
    pathPrefix: PATH_PREFIX,
  };
}
