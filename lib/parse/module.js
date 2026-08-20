// parse/module.js — module .tex loader with an mtime-keyed cache so dev-server
// rebuilds only re-tokenize modules whose source changed.
import fs from 'node:fs';
import path from 'node:path';
import { modulesDir } from '../paths.js';
import { tokenize } from './tokenizer.js';

const cache = new Map(); // name -> { mtimeMs, data }

export function loadModule(root, name) {
  const file = path.join(modulesDir(root), `${name}.tex`);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null; // missing module -> placeholder page upstream
  }
  const cached = cache.get(name);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
  const source = fs.readFileSync(file, 'utf8');
  const data = tokenize(source, { name });
  cache.set(name, { mtimeMs: stat.mtimeMs, data });
  return data;
}
