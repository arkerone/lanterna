import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { blockingIoDetector } from '../../../src/detectors/cpu/blocking-io.js';
import { jsonOnHotPathDetector } from '../../../src/detectors/cpu/json-on-hot-path.js';
import { nodeModulesHotspotDetector } from '../../../src/detectors/cpu/node-modules-hotspot.js';
import { requireInHotPathDetector } from '../../../src/detectors/cpu/require-in-hot-path.js';
import { syncCryptoDetector } from '../../../src/detectors/cpu/sync-crypto.js';
import { makeCpuDetectorInput, userCaller } from '../../helpers/cpu-detector-input.js';

// Exercises detectors through their real `detect()` interface via the synthetic
// kind-view builder — no capture→report pipeline, no on-disk cpuprofile fixtures.
// (Pipeline-level coverage over real fixtures stays in findings.test.ts.)

describe('detect() seam – sync-crypto', () => {
  it('emits a warning once a sync crypto API crosses the total gate', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: 'pbkdf2Sync', category: 'node:builtin', totalPct: 5 }],
    });
    const findings = syncCryptoDetector.detect(input.kinds, input.shared);
    assert.equal(findings.length, 1);
    const finding = findings[0];
    assert.ok(finding);
    assert.equal(finding.id, 'sync-crypto-on-hot-path');
    assert.equal(finding.category, 'sync-crypto');
    assert.equal(finding.severity, 'warning');
    assert.equal(finding.measurements?.observed.totalPct, 5);
  });

  it('escalates to critical past the critical threshold', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: 'scryptSync', category: 'node:builtin', totalPct: 15 }],
    });
    const finding = syncCryptoDetector.detect(input.kinds, input.shared)[0];
    assert.equal(finding?.severity, 'critical');
  });

  it('stays silent below the gate', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: 'pbkdf2Sync', category: 'node:builtin', totalPct: 0.5 }],
    });
    assert.equal(syncCryptoDetector.detect(input.kinds, input.shared).length, 0);
  });
});

describe('detect() seam – blocking-io', () => {
  it('flags a blocking fs API and names the async replacement', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: 'readFileSync', category: 'node:builtin', selfPct: 5, totalPct: 5 }],
    });
    const finding = blockingIoDetector.detect(input.kinds, input.shared)[0];
    assert.ok(finding);
    assert.equal(finding.id, 'blocking-io:fs.readFileSync');
    assert.equal((finding.evidence.extra as { api: string }).api, 'fs.readFileSync');
    assert.equal(finding.remediation?.with, 'readFile');
  });

  it('fires on a family total even when no single frame crosses the per-frame gate', () => {
    const input = makeCpuDetectorInput({
      hotspots: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        function: 'statSync',
        category: 'node:builtin' as const,
        selfPct: 0.2,
        totalPct: 0.9,
      })),
    });
    const findings = blockingIoDetector.detect(input.kinds, input.shared);
    assert.equal(findings.length, 4);
    assert.ok(findings.every((finding) => finding.category === 'blocking-io'));
  });

  it('infers the zlib sync API by reading the caller source', () => {
    const input = makeCpuDetectorInput({
      hotspots: [
        {
          function: 'processChunkSync',
          file: 'node:zlib',
          category: 'node:builtin',
          selfPct: 5,
          totalPct: 5,
          candidateCallers: [userCaller({ function: 'compress', file: 'service.js', line: 2 })],
        },
      ],
      sourceFiles: { 'service.js': 'function compress(buffer) {\n  return gzipSync(buffer);\n}\n' },
    });
    try {
      const finding = blockingIoDetector.detect(input.kinds, input.shared)[0];
      assert.ok(finding);
      assert.equal(finding.id, 'blocking-io:zlib.gzipSync');
      assert.equal((finding.evidence.extra as { api: string }).api, 'zlib.gzipSync');
    } finally {
      input.cleanup();
    }
  });
});

describe('detect() seam – node-modules-hotspot', () => {
  it('keeps the top dependency and lists runner-ups as alternatives', () => {
    const input = makeCpuDetectorInput({
      hotspots: [
        {
          function: 'render',
          package: 'react-dom',
          category: 'node_modules',
          selfPct: 10,
          totalPct: 20,
        },
        {
          function: 'diff',
          package: 'react-dom',
          category: 'node_modules',
          selfPct: 5,
          totalPct: 18,
        },
        { function: 'pad', package: 'left-pad', category: 'node_modules', selfPct: 1, totalPct: 2 },
      ],
    });
    const findings = nodeModulesHotspotDetector.detect(input.kinds, input.shared);
    assert.equal(findings.length, 1);
    const finding = findings[0];
    assert.ok(finding);
    assert.equal(finding.id, 'node-modules-hotspot:react-dom');
    const extra = finding.evidence.extra as { alternativeHotspots?: unknown[] };
    assert.equal(extra.alternativeHotspots?.length, 1);
  });
});

describe('detect() seam – require-in-hot-path', () => {
  it('reports module loading as info below the warning self threshold', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: '_load', category: 'node:builtin', selfPct: 1, totalPct: 2 }],
    });
    const finding = requireInHotPathDetector.detect(input.kinds, input.shared)[0];
    assert.ok(finding);
    assert.equal(finding.id, 'require-in-hot-path');
    assert.equal(finding.severity, 'info');
  });

  it('escalates to warning when the resolver self cost is high', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: '_load', category: 'node:builtin', selfPct: 5, totalPct: 6 }],
    });
    const finding = requireInHotPathDetector.detect(input.kinds, input.shared)[0];
    assert.equal(finding?.severity, 'warning');
  });
});

describe('detect() seam – json-on-hot-path', () => {
  it('detects a builtin JSON API on the hot path', () => {
    const input = makeCpuDetectorInput({
      hotspots: [{ function: 'JSON.parse', category: 'node:builtin', selfPct: 4, totalPct: 5 }],
    });
    const finding = jsonOnHotPathDetector.detect(input.kinds, input.shared)[0];
    assert.ok(finding);
    assert.equal(finding.id, 'json-on-hot-path:JSON.parse');
  });

  it('dedupes a user-inlined JSON call against the builtin frame of the same API', () => {
    const input = makeCpuDetectorInput({
      hotspots: [
        {
          id: 'builtin',
          function: 'JSON.stringify',
          category: 'node:builtin',
          selfPct: 1,
          totalPct: 5,
        },
        {
          id: 'user',
          function: 'serialize',
          category: 'user',
          file: 'api.js',
          line: 2,
          selfPct: 8,
          totalPct: 9,
        },
      ],
      sourceFiles: {
        'api.js': 'function serialize(value) {\n  return JSON.stringify(value);\n}\n',
      },
    });
    try {
      const findings = jsonOnHotPathDetector.detect(input.kinds, input.shared);
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.id, 'json-on-hot-path:JSON.stringify');
    } finally {
      input.cleanup();
    }
  });
});
