import { isAbsolute, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FrameCategory } from '../../report/types.js';

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

export function classifyFrame(functionName: string, url: string, cwd: string): ClassifiedFrame {
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

  const fileSystemPath = url.startsWith('file://') ? fromFileUrl(url) : url;
  const lanternaArtifact = lanternaArtifactLabel(fileSystemPath);
  if (lanternaArtifact) {
    return { category: 'lanterna', file: lanternaArtifact };
  }

  if (!isAbsolute(fileSystemPath)) {
    // Likely a relative URL from V8 or an eval; treat as user code relative to cwd
    return { category: 'user', file: fileSystemPath };
  }

  const relativePath = toPosix(relative(cwd, fileSystemPath));
  const nodeModulesPackage = extractNodeModulesPackage(relativePath);
  if (nodeModulesPackage) {
    if (isLanternaPackage(nodeModulesPackage)) {
      return { category: 'lanterna', file: `lanterna:${nodeModulesPackage}` };
    }
    return { category: 'node_modules', file: relativePath, package: nodeModulesPackage };
  }
  if (relativePath.startsWith('..')) {
    // File outside cwd — still could be user's monorepo; keep it as user with absolute path
    return { category: 'user', file: toPosix(fileSystemPath) };
  }
  return { category: 'user', file: relativePath };
}

function fromFileUrl(fileUrl: string): string {
  try {
    return fileURLToPath(fileUrl);
  } catch {
    return fileUrl;
  }
}

function toPosix(pathValue: string): string {
  return sep === posix.sep ? pathValue : pathValue.split(sep).join(posix.sep);
}

/**
 * Returns a stable short label when the path belongs to Lanterna's own
 * profiler instrumentation (preload script, runtime-signals hooks, etc.),
 * or `undefined` otherwise. Used by `classifyFrame` to assign a `'lanterna'`
 * category so these frames can be excluded from public reports.
 */
export function lanternaArtifactLabel(pathOrUrl: string): string | undefined {
  const normalized = toPosix(pathOrUrl);

  // Spawn-injected preload tmpfile (see capture/spawn/index.ts).
  if (/(^|\/)lanterna-preload-[^/]+\.cjs$/.test(normalized)) {
    return 'lanterna:preload';
  }

  // Any runtime-signals hook source (event-loop-hook, framework, installers/*).
  const hookMatch = normalized.match(
    /(^|\/)(?:src|dist|dist-test)\/runtime-signals\/(?:hooks\/)?(?:installers\/)?([^/]+?)\.(?:cjs|js|mjs|ts|cts|mts)$/,
  );
  if (hookMatch) {
    return `lanterna:${hookMatch[2]}`;
  }

  return undefined;
}

export function isLanternaPackage(packageName: string): boolean {
  return (
    packageName === 'lanterna' ||
    packageName.startsWith('@lanterna/') ||
    packageName === '@lanterna/core' ||
    packageName === '@lanterna/cli' ||
    packageName === '@lanterna/detectors'
  );
}

function extractNodeModulesPackage(relativePath: string): string | undefined {
  const nodeModulesIndex = relativePath.lastIndexOf('node_modules/');
  if (nodeModulesIndex < 0) return undefined;
  const afterNodeModules = relativePath.slice(nodeModulesIndex + 'node_modules/'.length);
  // Handle pnpm layout: .pnpm/<pkg>@<ver>/node_modules/<pkg>/...
  if (afterNodeModules.startsWith('.pnpm/')) {
    const pathSegments = afterNodeModules.split('/');
    const nestedNodeModulesIndex = pathSegments.indexOf('node_modules', 1);
    if (nestedNodeModulesIndex >= 0 && pathSegments[nestedNodeModulesIndex + 1]) {
      return packageNameFromParts(pathSegments, nestedNodeModulesIndex + 1);
    }
  }
  const pathSegments = afterNodeModules.split('/');
  return packageNameFromParts(pathSegments, 0);
}

function packageNameFromParts(pathSegments: string[], startIndex: number): string | undefined {
  const packageHead = pathSegments[startIndex];
  if (!packageHead) return undefined;
  if (packageHead.startsWith('@') && pathSegments[startIndex + 1]) {
    return `${packageHead}/${pathSegments[startIndex + 1]}`;
  }
  return packageHead;
}
