import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { RawCpuProfile } from '../src/collector/source.js';
import { enrichCpuTree, aggregateHotspots } from '../src/enricher/hotspots.js';
import { classifyFrame } from '../src/enricher/classify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profilesDir = resolve(__dirname, 'fixtures-profiles');
const CWD = '/app';

function loadProfile(name: string): RawCpuProfile {
  return JSON.parse(
    readFileSync(resolve(profilesDir, `${name}.cpuprofile.json`), 'utf8'),
  ) as RawCpuProfile;
}

describe('classifyFrame', () => {
  it('classifies node: builtins', () => {
    const r = classifyFrame('pbkdf2Sync', 'node:crypto', CWD);
    assert.equal(r.category, 'node:builtin');
  });

  it('classifies user code inside cwd', () => {
    const r = classifyFrame('hashPassword', `file://${CWD}/src/auth.js`, CWD);
    assert.equal(r.category, 'user');
    assert.equal(r.file, 'src/auth.js');
  });

  it('classifies node_modules by package name', () => {
    const r = classifyFrame('parse', `file://${CWD}/node_modules/fast-json-parse/index.js`, CWD);
    assert.equal(r.category, 'node_modules');
    assert.equal(r.package, 'fast-json-parse');
  });

  it('classifies scoped packages', () => {
    const r = classifyFrame('fn', `file://${CWD}/node_modules/@fastify/router/index.js`, CWD);
    assert.equal(r.category, 'node_modules');
    assert.equal(r.package, '@fastify/router');
  });

  it('classifies pnpm virtual store paths', () => {
    const r = classifyFrame(
      'fn',
      `file://${CWD}/node_modules/.pnpm/express@4.18.2/node_modules/express/index.js`,
      CWD,
    );
    assert.equal(r.category, 'node_modules');
    assert.equal(r.package, 'express');
  });

  it('classifies garbage collector', () => {
    const r = classifyFrame('(garbage collector)', '', CWD);
    assert.equal(r.category, 'gc');
  });

  it('classifies idle', () => {
    const r = classifyFrame('(idle)', '', CWD);
    assert.equal(r.category, 'idle');
  });

  it('classifies native (no url)', () => {
    const r = classifyFrame('Array.from', '', CWD);
    assert.equal(r.category, 'native');
  });

  it('classifies the Lanterna preload hook as native', () => {
    const r = classifyFrame('hook', `file://${CWD}/dist/collector/measures/event-loop-hook.cjs`, CWD);
    assert.equal(r.category, 'native');
    assert.equal(r.file, 'lanterna:event-loop-hook');
  });
});

describe('enrichCpuTree – sync-crypto profile', () => {
  const profile = loadProfile('sync-crypto');
  const tree = enrichCpuTree(profile, CWD, 1000);

  it('counts total samples from nodes hitCount', () => {
    assert.ok(tree.totalSamples > 0, 'totalSamples should be > 0');
  });

  it('finds pbkdf2Sync node classified as node:builtin', () => {
    const nodes = Array.from(tree.nodes.values());
    const pbkdf2 = nodes.find((n) => n.function === 'pbkdf2Sync');
    assert.ok(pbkdf2, 'pbkdf2Sync node should exist');
    assert.equal(pbkdf2.category, 'node:builtin');
  });

  it('finds hashPassword node classified as user', () => {
    const nodes = Array.from(tree.nodes.values());
    const hp = nodes.find((n) => n.function === 'hashPassword');
    assert.ok(hp, 'hashPassword node should exist');
    assert.equal(hp.category, 'user');
  });
});

describe('aggregateHotspots – sync-crypto profile', () => {
  const profile = loadProfile('sync-crypto');
  const tree = enrichCpuTree(profile, CWD, 1000);
  const hotspots = aggregateHotspots(profile, tree).publicHotspots;

  it('returns hotspots sorted by selfPct descending', () => {
    for (let i = 1; i < hotspots.length; i++) {
      assert.ok(hotspots[i - 1]!.selfPct >= hotspots[i]!.selfPct);
    }
  });

  it('pbkdf2Sync is the top hotspot with high selfPct', () => {
    const top = hotspots[0];
    assert.ok(top, 'at least one hotspot');
    assert.equal(top.function, 'pbkdf2Sync');
    assert.ok(top.selfPct > 50, `selfPct ${top.selfPct} should be > 50`);
  });

  it('hotspot has callers populated', () => {
    const top = hotspots[0];
    assert.ok(top, 'top hotspot exists');
    assert.ok(top.callers.length > 0, 'pbkdf2Sync should have at least one caller');
    assert.ok(top.callers[0]!.pct > 0);
  });
});

describe('enrichCpuTree – gc-pressure profile', () => {
  const profile = loadProfile('gc-pressure');
  const tree = enrichCpuTree(profile, CWD, 1000);

  it('gc node is classified as gc', () => {
    const nodes = Array.from(tree.nodes.values());
    const gc = nodes.find((n) => n.function === '(garbage collector)');
    assert.ok(gc, 'GC node should exist');
    assert.equal(gc.category, 'gc');
  });
});
