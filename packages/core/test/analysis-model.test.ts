import { describe, expect, it } from 'vitest';
import { classifyFrame } from '../src/analysis/model/classify.js';
import { buildHotspotAnalysis, enrichCpuTree } from '../src/analysis/model/hotspots.js';
import { CWD, loadProfile } from './helpers.js';

describe('classifyFrame', () => {
  it.each([
    {
      label: 'Node builtins',
      input: ['pbkdf2Sync', 'node:crypto', CWD] as const,
      expected: { category: 'node:builtin', file: 'node:crypto' },
    },
    {
      label: 'user files inside cwd',
      input: ['hashPassword', `file://${CWD}/src/auth.js`, CWD] as const,
      expected: { category: 'user', file: 'src/auth.js' },
    },
    {
      label: 'regular node_modules packages',
      input: ['parse', `file://${CWD}/node_modules/fast-json-parse/index.js`, CWD] as const,
      expected: {
        category: 'node_modules',
        file: 'node_modules/fast-json-parse/index.js',
        package: 'fast-json-parse',
      },
    },
    {
      label: 'scoped packages',
      input: ['fn', `file://${CWD}/node_modules/@fastify/router/index.js`, CWD] as const,
      expected: {
        category: 'node_modules',
        file: 'node_modules/@fastify/router/index.js',
        package: '@fastify/router',
      },
    },
    {
      label: 'pnpm virtual store packages',
      input: [
        'fn',
        `file://${CWD}/node_modules/.pnpm/express@4.18.2/node_modules/express/index.js`,
        CWD,
      ] as const,
      expected: {
        category: 'node_modules',
        file: 'node_modules/.pnpm/express@4.18.2/node_modules/express/index.js',
        package: 'express',
      },
    },
    {
      label: 'garbage collector pseudo frames',
      input: ['(garbage collector)', '', CWD] as const,
      expected: { category: 'gc', file: '(garbage collector)' },
    },
    {
      label: 'idle pseudo frames',
      input: ['(idle)', '', CWD] as const,
      expected: { category: 'idle', file: '(idle)' },
    },
    {
      label: 'native frames without file urls',
      input: ['Array.from', '', CWD] as const,
      expected: { category: 'native', file: 'Array.from' },
    },
    {
      label: 'Lanterna preload hook artifacts',
      input: ['hook', `file://${CWD}/dist/runtime-signals/hooks/event-loop-hook.cjs`, CWD] as const,
      expected: { category: 'lanterna', file: 'lanterna:event-loop-hook' },
    },
    {
      label: 'Lanterna spawn-injected preload tmpfile',
      input: ['preload', 'file:///tmp/lanterna-preload-12345-1700000000000-abc.cjs', CWD] as const,
      expected: { category: 'lanterna', file: 'lanterna:preload' },
    },
    {
      label: 'Lanterna runtime-signals installer sources',
      input: [
        'installMemoryUsage',
        `file://${CWD}/src/runtime-signals/hooks/installers/memory-usage.ts`,
        CWD,
      ] as const,
      expected: { category: 'lanterna', file: 'lanterna:memory-usage' },
    },
    {
      label: 'Lanterna runtime-signals framework source',
      input: [
        'composePreloadScript',
        `file://${CWD}/src/runtime-signals/hooks/framework.ts`,
        CWD,
      ] as const,
      expected: { category: 'lanterna', file: 'lanterna:framework' },
    },
    {
      label: 'Lanterna installed as a node_modules dep in user project',
      input: ['capture', `file://${CWD}/node_modules/@lanterna/core/dist/index.js`, CWD] as const,
      expected: { category: 'lanterna', file: 'lanterna:@lanterna/core' },
    },
    {
      label: 'absolute paths outside cwd',
      input: ['workspaceHelper', 'file:///tmp/shared/helper.js', CWD] as const,
      expected: { category: 'user', file: '/tmp/shared/helper.js' },
    },
  ])('classifies $label', ({ input, expected }) => {
    expect(classifyFrame(...input)).toEqual(expected);
  });
});

describe('enrichCpuTree', () => {
  it('keeps real sample volume and classifies dominant sync-crypto frames correctly', () => {
    const tree = enrichCpuTree(loadProfile('sync-crypto'), CWD, 1000);
    const nodes = Array.from(tree.nodes.values());
    const pbkdf2 = nodes.find((node) => node.function === 'pbkdf2Sync');
    const hashPassword = nodes.find((node) => node.function === 'hashPassword');

    expect(tree.totalSamples).toBeGreaterThan(0);
    expect(pbkdf2).toMatchObject({ function: 'pbkdf2Sync', category: 'node:builtin' });
    expect(hashPassword).toMatchObject({ function: 'hashPassword', category: 'user' });
  });

  it('classifies the GC node distinctly in the gc-pressure fixture', () => {
    const tree = enrichCpuTree(loadProfile('gc-pressure'), CWD, 1000);
    const gcNode = Array.from(tree.nodes.values()).find(
      (node) => node.function === '(garbage collector)',
    );

    expect(gcNode).toMatchObject({ function: '(garbage collector)', category: 'gc' });
  });
});

describe('buildHotspotAnalysis', () => {
  it('surfaces the synchronous crypto call as the dominant hotspot with caller attribution', () => {
    const tree = enrichCpuTree(loadProfile('sync-crypto'), CWD, 1000);
    const hotspots = buildHotspotAnalysis(loadProfile('sync-crypto'), tree).publicHotspots;
    const topHotspot = hotspots[0];

    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots.map((hotspot) => hotspot.selfPct)).toEqual(
      [...hotspots.map((hotspot) => hotspot.selfPct)].sort((left, right) => right - left),
    );
    expect(topHotspot).toMatchObject({
      function: 'pbkdf2Sync',
    });
    expect(topHotspot?.selfPct).toBeGreaterThan(50);
    expect(topHotspot?.callers[0]?.pct).toBeGreaterThan(0);
  });
});
