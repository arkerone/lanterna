import { relative, isAbsolute, sep, posix } from 'node:path';
import type { FrameCategory } from '../report/types.js';

export interface ClassifiedFrame {
  category: FrameCategory;
  file: string;
  package?: string;
}

const NATIVE_PSEUDO_FUNCTIONS = new Set([
  '(idle)',
  '(program)',
  '(garbage collector)',
  '(root)',
  '(logging)',
  '(unresolved function)',
]);

export function classifyFrame(
  functionName: string,
  url: string,
  cwd: string,
): ClassifiedFrame {
  if (NATIVE_PSEUDO_FUNCTIONS.has(functionName)) {
    if (functionName === '(garbage collector)') return { category: 'gc', file: functionName };
    if (functionName === '(idle)') return { category: 'idle', file: functionName };
    if (functionName === '(program)') return { category: 'program', file: functionName };
    return { category: 'native', file: functionName };
  }

  if (!url || url === '') {
    return { category: 'native', file: functionName || '(anonymous)' };
  }

  if (url.startsWith('node:')) {
    return { category: 'node:builtin', file: url };
  }

  // V8 sometimes emits URLs like "extensions::..." or "native array.js"
  if (url.startsWith('extensions::') || url.startsWith('native ')) {
    return { category: 'native', file: url };
  }

  const fsPath = url.startsWith('file://') ? fromFileUrl(url) : url;
  if (isLanternaProfilerArtifact(fsPath)) {
    return { category: 'native', file: 'lanterna:event-loop-hook' };
  }

  if (!isAbsolute(fsPath)) {
    // Likely a relative URL from V8 or an eval; treat as user code relative to cwd
    return { category: 'user', file: fsPath };
  }

  const rel = toPosix(relative(cwd, fsPath));
  const nodeModulesInfo = extractNodeModulesPackage(rel);
  if (nodeModulesInfo) {
    return { category: 'node_modules', file: rel, package: nodeModulesInfo };
  }
  if (rel.startsWith('..')) {
    // File outside cwd — still could be user's monorepo; keep it as user with absolute path
    return { category: 'user', file: toPosix(fsPath) };
  }
  return { category: 'user', file: rel };
}

function fromFileUrl(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

function toPosix(p: string): string {
  return sep === posix.sep ? p : p.split(sep).join(posix.sep);
}

function isLanternaProfilerArtifact(pathOrUrl: string): boolean {
  const normalized = toPosix(pathOrUrl);
  return /(^|\/)(src|dist|dist-test)\/collector\/measures\/event-loop-hook\.(cjs|js)$/.test(normalized);
}

function extractNodeModulesPackage(rel: string): string | undefined {
  const idx = rel.lastIndexOf('node_modules/');
  if (idx < 0) return undefined;
  const after = rel.slice(idx + 'node_modules/'.length);
  // Handle pnpm layout: .pnpm/<pkg>@<ver>/node_modules/<pkg>/...
  if (after.startsWith('.pnpm/')) {
    const parts = after.split('/');
    const nmIdx = parts.indexOf('node_modules', 1);
    if (nmIdx >= 0 && parts[nmIdx + 1]) {
      return pkgName(parts, nmIdx + 1);
    }
  }
  const parts = after.split('/');
  return pkgName(parts, 0);
}

function pkgName(parts: string[], offset: number): string | undefined {
  const first = parts[offset];
  if (!first) return undefined;
  if (first.startsWith('@') && parts[offset + 1]) {
    return `${first}/${parts[offset + 1]}`;
  }
  return first;
}
