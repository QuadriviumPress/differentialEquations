#!/usr/bin/env node
/**
 * Chapter PDF generation.
 *
 * Prints the /print/<slug>/ concatenated chapter pages (built by
 * chapter-print.njk) with Playwright Chromium, waiting for MathJax to finish
 * typesetting. Reads generated/print-manifest.json (written by the build).
 *
 * Usage: node scripts/generate-pdf-parallel.js [--base-url http://localhost:4000/differentialEquations]
 * Output: pdf-output/<pdfName>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const baseDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(baseDir, 'pdf-output');

const argIdx = process.argv.indexOf('--base-url');
const baseUrl =
  argIdx !== -1
    ? process.argv[argIdx + 1].replace(/\/$/, '')
    : 'http://localhost:4000/differentialEquations';
const maxConcurrency = Number(process.env.MAX_CONCURRENCY || 4);

const manifestPath = path.join(baseDir, 'generated', 'print-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('generated/print-manifest.json not found — run `npm run build` first');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
fs.mkdirSync(outputDir, { recursive: true });

const pdfOptions = {
  format: 'Letter',
  printBackground: true,
  margin: { top: '0.75in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
  displayHeaderFooter: true,
  headerTemplate:
    '<div style="font-size: 9px; width: 100%; text-align: center; color: #666;"><span class="title"></span></div>',
  footerTemplate:
    '<div style="font-size: 9px; width: 100%; text-align: center; color: #666;">' +
    'Elementary Differential Equations (W.F. Trench) — CC BY-NC-SA 3.0 — Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
};

async function generateOne(browser, entry) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  try {
    const url = `${baseUrl}${entry.printUrl}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate(async () => {
      if (window.MathJax && window.MathJax.startup) await window.MathJax.startup.promise;
    });
    await page.waitForTimeout(500); // font settling
    await page.pdf({ ...pdfOptions, path: path.join(outputDir, entry.pdfName) });
    console.log(`  ✓ ${entry.pdfName} (${entry.title})`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${entry.pdfName}: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch();
let failed = 0;
const queue = [...manifest];
await Promise.all(
  Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
    let entry;
    while ((entry = queue.shift())) {
      const ok = await generateOne(browser, entry);
      if (!ok) failed++;
    }
  })
);
await browser.close();

console.log(`\n${manifest.length - failed}/${manifest.length} chapter PDFs generated`);
process.exit(failed > 0 ? 1 : 0);
