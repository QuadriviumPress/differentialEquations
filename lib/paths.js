import path from 'node:path';

// The pristine Trench source distribution. Nothing in the build may write into
// this directory; it is read-only ground truth.
export const SRC_ROOT = 'trench-distro';

// The boundary-value edition is a verified superset of TRENCH_DIFFEQ.tex:
// chapters 1-10 are identical, and it adds chapters 11-13 (Fourier expansions,
// Fourier solutions of PDEs, and boundary value problems).
export const BOOK_FILE = 'TRENCH_DIFFEQ_BV.tex';

export function srcRoot(root) {
  return path.join(root, SRC_ROOT);
}

export function bookFile(root) {
  return path.join(srcRoot(root), BOOK_FILE);
}

// EPS/ holds the complete figure set (the loose copies at the distribution root
// are a subset of it).
export function figuresSrcDir(root) {
  return path.join(srcRoot(root), 'EPS');
}

export function generatedFiguresDir(root) {
  return path.join(root, 'generated', 'figures');
}
