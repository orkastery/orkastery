/**
 * Stack detection for `ork security-scan` and `ork init` (spec section 7). Looks at the repository root and its
 * first-level subfolders only, skipping vendored or generated folders.
 *
 * Markers: JS/TS by `package.json`; Python by `pyproject.toml`, `requirements*.txt`, `uv.lock`, `poetry.lock` or
 * `Pipfile.lock`; Go by `go.mod`. One entry per (stack, dir).
 *
 * Order of the result is deterministic: the root first, then subfolders in byte order of the name; within a
 * directory, the order js, python, go.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Stack } from './types';

export interface StackDir { stack: Stack; dir: string }

const IGNORED_DIRS = new Set(['node_modules', '.git', '.orkastery', 'vendor', 'dist']);
const PYTHON_FILES = new Set(['pyproject.toml', 'uv.lock', 'poetry.lock', 'Pipfile.lock']);
const STACK_ORDER: Stack[] = ['js', 'python', 'go'];

function stacksIn(absDir: string): Stack[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = new Set<Stack>();
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (e.name === 'package.json') found.add('js');
    else if (e.name === 'go.mod') found.add('go');
    else if (PYTHON_FILES.has(e.name) || /^requirements.*\.txt$/.test(e.name)) found.add('python');
  }
  return STACK_ORDER.filter((s) => found.has(s));
}

export function detectStacks(root: string): StackDir[] {
  const result: StackDir[] = [];
  for (const stack of stacksIn(root)) result.push({ stack, dir: '.' });
  let subdirs: string[] = [];
  try {
    subdirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return result;
  }
  for (const name of subdirs) {
    for (const stack of stacksIn(path.join(root, name))) result.push({ stack, dir: name });
  }
  return result;
}
