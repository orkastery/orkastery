#!/usr/bin/env node
/**
 * Maintainer-only (not part of the package: core/package.json `files` has no scripts/). Re-records the real output of
 * every security-scan catalog tool, run through Docker exactly as the catalog says, against the deliberately vulnerable
 * fixtures in eval/fixtures/security-scan/<stack>/ and against a clean project per stack ("empty" case).
 *
 *   node core/scripts/gravar-saidas-security-scan.cjs [--tool <name>] [--stack js|python|go]
 *
 * Output: core/test/fixtures/security-scan/<report-name>.<stack|empty>.<ext>, see the README there. It is a mini
 * executor: the argv comes from core/assets/security-scan/tools.json, nothing is duplicated except the placeholders.
 * Needs Docker, the pinned images already pulled (or network), and git on the host. No tool ever runs on the host.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(ROOT, 'core', 'assets', 'security-scan');
const FIXTURES = path.join(ROOT, 'eval', 'fixtures', 'security-scan');
const DEST = path.join(ROOT, 'core', 'test', 'fixtures', 'security-scan');
const STACKS = ['js', 'python', 'go'];
const DEFAULT_CONFIG = { gitleaks: 'gitleaks.toml', eslint: 'eslint.config.mjs', ruff: 'ruff.toml', 'golangci-lint': '.golangci.yml' };
const WORKFLOW_PINNED = `name: ci
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          persist-credentials: false
      - run: echo ok
`;
/** Smallest project per stack that every tool of that stack reports nothing for. */
const CLEAN = {
  js: { 'package.json': '{\n  "name": "clean-js",\n  "version": "1.0.0",\n  "private": true,\n  "license": "MIT"\n}\n',
    'package-lock.json': '{\n  "name": "clean-js",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "clean-js",\n      "version": "1.0.0",\n      "license": "MIT"\n    }\n  }\n}\n',
    'tsconfig.json': '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["src/**/*.ts"] }\n',
    'src/index.ts': 'export const answer: number = 42;\n' },
  python: { 'requirements.txt': '# no dependencies\n', 'app/__init__.py': '', 'app/main.py': 'print("clean")\n' },
  go: { 'go.mod': 'module example.com/clean\n\ngo 1.22\n', 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("clean") }\n' },
};

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const onlyTool = flag('--tool');
const onlyStack = flag('--stack');
const tools = JSON.parse(fs.readFileSync(path.join(CATALOG, 'tools.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-secscan-'));
const uid = `${process.getuid()}:${process.getgid()}`;
const summary = [];

const sh = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const git = (cwd, ...argv) => {
  const r = sh('git', argv, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'f@example.invalid' } });
  if (r.status !== 0) throw new Error(`git ${argv.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

function writeTree(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
}

/** A clean tree per stack under tmp, with the pinned workflow (so the whole-tree tools also have a clean case). */
function cleanProject(stack) {
  const dir = path.join(tmp, `clean-${stack}`);
  writeTree(dir, { ...CLEAN[stack], '.github/workflows/ci.yml': WORKFLOW_PINNED });
  return dir;
}

/** Git repo whose base commit is the clean project and whose HEAD adds `headDir` (or a harmless note when null). */
function gitRepo(stack, headDir) {
  const dir = path.join(tmp, `git-${stack}-${headDir ? 'fixture' : 'empty'}`);
  fs.cpSync(cleanProject(stack), dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  if (headDir) {
    for (const entry of fs.readdirSync(dir)) if (entry !== '.git') fs.rmSync(path.join(dir, entry), { recursive: true });
    fs.cpSync(headDir, dir, { recursive: true });
  } else {
    fs.writeFileSync(path.join(dir, 'NOTES.txt'), 'harmless\n');
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base };
}

function expand(arg, ctx) {
  return arg.replace(/\{(src|out|base|config|install|stackDir)\}/g, (_, k) => ctx[k]);
}

/** Runs one argv of one tool in its container; returns { ok, why }. */
function run(tool, argv, ctx) {
  const bin = tool.containerBin ?? argv[0];
  const env = Object.entries(tool.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const cfg = DEFAULT_CONFIG[tool.name];
  const dockerArgs = ['run', '--rm', '--user', uid, ...(tool.network === 'none' ? ['--network', 'none'] : []),
    '--tmpfs', '/tmp:exec,mode=1777', '-v', `${ctx.srcHost}:/src:ro`, '-v', `${ctx.outHost}:/out`,
    '-v', `${CATALOG}/defaults:/config:ro`, '-w', '/src', ...env, '--entrypoint', bin, tool.image,
    ...argv.slice(1).map((a) => expand(a, { src: '/src', out: '/out', base: ctx.base ?? '', config: cfg ? `/config/${cfg}` : '',
      install: (tool.install ?? []).join(' '), stackDir: ctx.stackDir ?? '.' }))];
  const r = sh('timeout', [String(Math.ceil(tool.timeoutMs / 1000) + 30), 'docker', ...dockerArgs]);
  if (tool.stdoutFile && r.status === 0) fs.writeFileSync(path.join(ctx.outHost, tool.stdoutFile), r.stdout);
  return { status: r.status, stderr: (r.stderr || '').slice(-600) };
}

/** Counts findings in a recorded file with the shape knowledge of each tool (informational, for the summary). */
function count(name, file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (name === 'govulncheck') return (raw.match(/"finding": \{/g) || []).length;
  const j = JSON.parse(raw);
  if (Array.isArray(j)) {
    if (name === 'eslint') return j.reduce((n, f) => n + f.messages.length, 0);
    return j.length;
  }
  if (name === 'semgrep') return j.results.length;
  if (name === 'npm-audit') return Object.keys(j.vulnerabilities).length;
  if (name === 'pip-audit') return j.dependencies.reduce((n, d) => n + d.vulns.length, 0);
  if (name === 'golangci-lint') return (j.Issues || []).length;
  if (j.SchemaVersion) return (j.Results || []).reduce((n, r) => n + (r.Vulnerabilities || r.Misconfigurations || r.Licenses || []).length, 0);
  return -1;
}

/**
 * The two edits made to the recorded text. Advisory texts quoted by the tools carry U+2014, which the repo forbids; a
 * JSON-safe hyphen replaces it. Advisory credits and references carry real e-mail addresses (the reporter of a CVE, a
 * distribution mailing list), which the private-data barrier (RM-062) rejects in the public repository; each one outside
 * the reserved domains becomes the invented `pessoa@example.com`. No normalizer reads either field.
 */
const EMAIL = /(?<![A-Za-z0-9._%+\-\\@])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?![A-Za-z0-9-])/g;
/** Reserved for examples (RFC 2606 and RFC 6761), like the fixture commit author: kept as recorded. */
const RESERVED = /@(?:example\.(?:com|net|org)|(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+\.(?:example|invalid|test|localhost))$/i;
const sanitize = (text) => text.replaceAll('\u2014', '-').replace(EMAIL, (m) => (RESERVED.test(m) ? m : 'pessoa@example.com'));

function record(tool, argv, tag, ctx) {
  const outHost = fs.mkdtempSync(path.join(tmp, 'out-'));
  fs.chmodSync(outHost, 0o777);
  const r = run(tool, argv, { ...ctx, outHost });
  for (const name of tool.expect.files.filter((f) => argv.join(' ').includes(f) || tool.stdoutFile === f)) {
    const src = path.join(outHost, name);
    if (r.status !== 0 || !fs.existsSync(src)) {
      summary.push(`${tool.name} ${tag}: FAILED rc=${r.status} ${r.stderr.replace(/\s+/g, ' ')}`);
      continue;
    }
    const ext = path.extname(name);
    const dest = `${path.basename(name, ext)}.${tag}${ext}`;
    fs.writeFileSync(path.join(DEST, dest), sanitize(fs.readFileSync(src, 'utf8')));
    summary.push(`${dest}: ${count(tool.name, src)} findings`);
  }
}

/** The argv list of a tool for a stack: the main one plus `extraArgs` (Gitleaks git scan). */
const argvs = (tool, stack) => [tool.argsByStack?.[stack] ?? tool.args, ...(tool.extraArgs ?? [])];
const isGit = (argv) => argv.includes('git');

fs.mkdirSync(DEST, { recursive: true });
for (const tool of tools.filter((t) => !onlyTool || t.name === onlyTool)) {
  const applies = (s) => tool.stacks === 'all' || tool.stacks.includes(s);
  for (const stack of STACKS.filter((s) => applies(s) && (!onlyStack || s === onlyStack))) {
    for (const argv of argvs(tool, stack)) {
      if (isGit(argv)) {
        const { dir, base } = gitRepo(stack, path.join(FIXTURES, stack));
        record(tool, argv, stack, { srcHost: dir, base });
      } else record(tool, argv, stack, { srcHost: path.join(FIXTURES, stack) });
    }
  }
  // Empty case: the tool's own stack, or js for the tools that apply to every stack.
  const emptyStack = Array.isArray(tool.stacks) ? tool.stacks[0] : 'js';
  if (onlyStack && onlyStack !== emptyStack) continue;
  for (const argv of argvs(tool, emptyStack)) {
    if (isGit(argv)) {
      const { dir, base } = gitRepo(emptyStack, null);
      record(tool, argv, 'empty', { srcHost: dir, base });
    } else record(tool, argv, 'empty', { srcHost: cleanProject(emptyStack) });
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(summary.join('\n'));
process.exitCode = summary.some((l) => l.includes('FAILED')) ? 1 : 0;
