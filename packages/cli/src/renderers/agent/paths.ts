import { isNoiseUrl } from '@lanterna-profiler/core';

const NON_EDITABLE_RUNTIME_FUNCTIONS = new Set(['init', 'runMicrotasks', 'writeBuffer']);

export function isEditableUserFile(value: string | undefined): value is string {
  if (!isNonEmpty(value)) return false;
  return (
    looksLikeFilePath(value) &&
    !isPseudoFile(value) &&
    !isDependencyOrRuntimePath(value) &&
    !isLanternaInstrumentationPath(value) &&
    !isVirtualSourcePath(value)
  );
}

// Lanterna's own injected code (the `/tmp/lanterna-preload-*.cjs` preload and the
// runtime-signals hooks) is real code on disk during a capture, so it slips past
// the dependency/runtime checks. It is never a patch target — defer to core's
// shared self-noise registry so this stays in sync with the capture-side
// classification instead of re-encoding the path patterns here.
export function isLanternaInstrumentationPath(file: string): boolean {
  return isNoiseUrl(file);
}

export function isGeneratedOutputPath(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.vite)(\/|$)/.test(normalized);
}

export function isPseudoFile(file: string): boolean {
  const trimmed = normalizeFrameLabel(file);
  return (
    isMissingFrameLabel(trimmed) ||
    isParenthesizedRuntimeLabel(trimmed) ||
    isAngleBracketRuntimeLabel(trimmed)
  );
}

export function isPseudoFrameFunction(value: string | undefined): boolean {
  const label = normalizeFrameLabel(value);
  if (isMissingFrameLabel(label)) return false;
  return isParenthesizedRuntimeLabel(label) || NON_EDITABLE_RUNTIME_FUNCTIONS.has(label);
}

export function isDependencyOrRuntimePath(file: string): boolean {
  return (
    isDependencyPath(file) ||
    file.startsWith('node:') ||
    file.startsWith('native ') ||
    file === 'native'
  );
}

export function isDependencyPath(file: string): boolean {
  return (
    file.includes('/node_modules/') ||
    file.includes('/pnpm-store/') ||
    file.includes('/.pnpm/') ||
    file.includes('/caches/pnpm-store/')
  );
}

export function isVirtualSourcePath(file: string): boolean {
  return (
    file.startsWith('webpack://') ||
    file.startsWith('vite:/') ||
    file.startsWith('vite://') ||
    file.startsWith('rollup://') ||
    file.startsWith('parcel://')
  );
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function looksLikeFilePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.includes('/') ||
    value.includes('\\') ||
    /\.[A-Za-z0-9]+$/.test(value)
  );
}

function normalizeFrameLabel(value: string | undefined): string {
  return value?.trim() ?? '';
}

function isMissingFrameLabel(value: string): boolean {
  return value.length === 0;
}

function isParenthesizedRuntimeLabel(value: string): boolean {
  return value.startsWith('(') && value.endsWith(')');
}

function isAngleBracketRuntimeLabel(value: string): boolean {
  return value.startsWith('<') && value.endsWith('>');
}
