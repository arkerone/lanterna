import assert from 'node:assert/strict';
import {
  buildLanternaReport,
  LANTERNA_VERSION,
  type LanternaReport,
  type RawCapture,
  type RawCpuProfile,
  serializeReport,
} from '@lanterna/core';
import { describe, it } from 'vitest';
import { analyzeCapture } from '../src/analyze-capture.js';
import { CWD, loadProfile, makeRaw } from './helpers.js';

function makeReport(profileName: string, overrides: Partial<RawCapture> = {}): LanternaReport {
  const profile = loadProfile(profileName);
  const raw = makeRaw(profile, overrides);
  return createReport(raw, {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });
}

function createReport(
  raw: RawCapture,
  options: { sampleIntervalMicros: number; deep: boolean; command: string[] },
): LanternaReport {
  return buildLanternaReport(raw, analyzeCapture(raw, options), options);
}

describe('findings – sync-crypto-on-hot-path', () => {
  const report = makeReport('sync-crypto');

  it('detects sync-crypto finding', () => {
    const f = report.findings.find((f) => f.id === 'sync-crypto-on-hot-path');
    assert.ok(
      f,
      `Expected sync-crypto finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('finding has severity warning or critical', () => {
    const f = report.findings.find((f) => f.id === 'sync-crypto-on-hot-path')!;
    assert.ok(f.severity === 'warning' || f.severity === 'critical');
  });

  it('finding has a non-empty suggestion', () => {
    const f = report.findings.find((f) => f.id === 'sync-crypto-on-hot-path')!;
    assert.ok(f.suggestion.length > 10);
  });

  it('finding evidence points to user caller, not node internals', () => {
    const f = report.findings.find((f) => f.id === 'sync-crypto-on-hot-path')!;
    // Evidence should point to the user-code caller (hashPassword), not the node:crypto internal.
    // The callee is exposed in evidence.extra.callee for reference.
    assert.match(f.evidence.function, /hashPassword/);
    assert.ok(
      (f.evidence.extra as Record<string, unknown>)?.callee?.toString().includes('pbkdf2Sync'),
    );
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'attributed-caller');
  });
});

describe('findings – sync-crypto false positive suppression', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'pbkdf2Sync',
          scriptId: '1',
          url: `file://${CWD}/src/crypto-like.js`,
          lineNumber: 3,
          columnNumber: 0,
        },
        hitCount: 100,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(100).fill(2),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('does not emit sync-crypto for a user-defined function with a colliding name', () => {
    assert.equal(
      report.findings.some((f) => f.id === 'sync-crypto-on-hot-path'),
      false,
    );
  });
});

describe('findings – excessive-gc', () => {
  const report = makeReport('gc-pressure', {
    gcEvents: [
      { atMs: 100, kind: 'scavenge', durationMs: 120 },
      { atMs: 300, kind: 'markSweep', durationMs: 250 },
    ],
  });

  it('detects excessive-gc finding when longest pause > 100ms', () => {
    const f = report.findings.find((f) => f.id === 'excessive-gc');
    assert.ok(
      f,
      `Expected excessive-gc finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('excessive-gc finding has suggestion', () => {
    const f = report.findings.find((f) => f.id === 'excessive-gc')!;
    assert.ok(f.suggestion.length > 10);
  });
});

describe('findings – excessive-gc confidence gating', () => {
  const shortGcHeavyProfile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: '(garbage collector)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 40,
        children: [],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'compute',
          scriptId: '1',
          url: `file://${CWD}/src/app.js`,
          lineNumber: 1,
          columnNumber: 0,
        },
        hitCount: 10,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 1050000,
    samples: Array(40).fill(2).concat(Array(10).fill(3)),
    timeDeltas: [],
  };

  const report = createReport(
    makeRaw(shortGcHeavyProfile, {
      durationMs: 50,
      captureIntegrity: {
        controlChannel: true,
        eventLoopTimed: false,
        gcTimed: false,
        cpuSamplesTimed: true,
      },
    }),
    { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'] },
  );

  it('suppresses ratio-only GC findings on very short captures without timed GC evidence', () => {
    assert.equal(
      report.findings.some((f) => f.id === 'excessive-gc'),
      false,
    );
  });
});

describe('findings – event-loop-stall', () => {
  const report = makeReport('sync-crypto', {
    durationMs: 1000,
    eventLoopSamples: [{ atMs: 320, lagMs: 300 }],
    eventLoopResolutionMs: 20,
    eventLoopAvailable: true,
    captureIntegrity: {
      controlChannel: true,
      eventLoopTimed: true,
      gcTimed: false,
      cpuSamplesTimed: true,
    },
  });

  it('detects event-loop-stall when max lag > 200ms', () => {
    const f = report.findings.find((f) => f.id === 'event-loop-stall');
    assert.ok(
      f,
      `Expected event-loop-stall finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('derives real stall intervals from timed heartbeats', () => {
    assert.deepEqual(report.eventLoop.stallIntervals, [
      { startMs: 20, endMs: 320, maxLagMs: 300 },
      { startMs: 340, endMs: 1000, maxLagMs: 660 },
    ]);
  });

  it('includes correlated hotspot candidates in event-loop evidence', () => {
    const f = report.findings.find((f) => f.id === 'event-loop-stall')!;
    const candidates = (f.evidence.extra as Record<string, unknown>).candidateHotspots as Array<
      Record<string, unknown>
    >;
    assert.ok(candidates.length > 0);
    assert.match(String(candidates[0]?.function), /hashPassword/);
    assert.equal((f.evidence.extra as Record<string, unknown>).proofLevel, 'aggregate-correlation');
  });
});

describe('event loop report – hook without usable timing signal', () => {
  const report = makeReport('sync-crypto', {
    eventLoopAvailable: true,
    eventLoopSamples: [],
    eventLoopHistogram: undefined,
    captureIntegrity: {
      controlChannel: true,
      eventLoopTimed: false,
      gcTimed: false,
      cpuSamplesTimed: true,
    },
  });

  it('does not claim event-loop availability without heartbeats or histogram', () => {
    assert.equal(report.eventLoop.available, false);
    assert.equal(report.eventLoop.measurementBasis, 'none');
    assert.equal(report.eventLoop.confidence, 'none');
  });
});

describe('findings – blocking-io', () => {
  // Build a synthetic profile with readFileSync on hot path
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'processRequest',
          scriptId: '1',
          url: `file://${CWD}/src/handler.js`,
          lineNumber: 10,
          columnNumber: 0,
        },
        hitCount: 5,
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'readFileSync',
          scriptId: '0',
          url: 'node:fs',
          lineNumber: 0,
          columnNumber: 0,
        },
        hitCount: 95,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(95).fill(3).concat(Array(5).fill(2)),
    timeDeltas: [],
  };

  const raw = makeRaw(profile);
  const report = createReport(raw, {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('detects blocking-io finding', () => {
    const f = report.findings.find((f) => f.id.startsWith('blocking-io'));
    assert.ok(
      f,
      `Expected blocking-io finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('blocking-io evidence points to user caller, not node:fs internal', () => {
    const f = report.findings.find((f) => f.id.startsWith('blocking-io'))!;
    // Evidence should point to the user-code caller (processRequest), not node:fs.
    assert.match(f.evidence.function, /processRequest/);
    assert.ok(
      (f.evidence.extra as Record<string, unknown>)?.api?.toString().includes('readFileSync'),
    );
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'attributed-caller');
  });
});

describe('findings – blocking-io false positive suppression', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'readFileSync',
          scriptId: '1',
          url: `file://${CWD}/src/fs-like.js`,
          lineNumber: 4,
          columnNumber: 0,
        },
        hitCount: 100,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(100).fill(2),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('does not emit blocking-io for a user-defined function with a colliding name', () => {
    assert.equal(
      report.findings.some((f) => f.id.startsWith('blocking-io')),
      false,
    );
  });
});

describe('findings – deopt-loop', () => {
  const report = createReport(
    makeRaw(
      {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [2],
          },
          {
            id: 2,
            callFrame: {
              functionName: 'compute',
              scriptId: '1',
              url: `file://${CWD}/src/app.js`,
              lineNumber: 10,
              columnNumber: 0,
            },
            hitCount: 100,
            children: [],
          },
        ],
        startTime: 1000000,
        endTime: 2000000,
        samples: Array(100).fill(2),
        timeDeltas: [],
      },
      {
        deopts: [
          {
            function: 'compute',
            file: `${CWD}/src/app.js`,
            line: 10,
            reason: 'wrong map',
            bailoutType: 'soft',
            count: 6,
          },
        ],
      },
    ),
    { sampleIntervalMicros: 1000, deep: true, command: ['node', 'app.js'] },
  );

  it('detects deopt-loop when same function deoptimised ≥ 5 times in deep mode', () => {
    const f = report.findings.find((f) => f.id.startsWith('deopt-loop:'));
    assert.ok(
      f,
      `Expected deopt-loop finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('deopt-loop finding has warning severity for count 5-20', () => {
    const f = report.findings.find((f) => f.id.startsWith('deopt-loop:'))!;
    assert.equal(f.severity, 'warning');
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'deopt-trace-only');
  });

  it('deopt-loop finding has critical severity when count > 20', () => {
    const heavyDeopts = [
      {
        function: 'hotFn',
        file: `${CWD}/src/hot.js`,
        line: 5,
        reason: 'type mismatch',
        bailoutType: 'soft',
        count: 21,
      },
    ];
    const heavyReport = createReport(
      makeRaw(
        {
          nodes: [
            {
              id: 1,
              callFrame: {
                functionName: '(root)',
                scriptId: '0',
                url: '',
                lineNumber: -1,
                columnNumber: -1,
              },
              hitCount: 0,
              children: [2],
            },
            {
              id: 2,
              callFrame: {
                functionName: 'hotFn',
                scriptId: '1',
                url: `file://${CWD}/src/hot.js`,
                lineNumber: 5,
                columnNumber: 0,
              },
              hitCount: 100,
              children: [],
            },
          ],
          startTime: 1000000,
          endTime: 2000000,
          samples: Array(100).fill(2),
          timeDeltas: [],
        },
        { deopts: heavyDeopts },
      ),
      { sampleIntervalMicros: 1000, deep: true, command: ['node', 'hot.js'] },
    );
    const f = heavyReport.findings.find((f) => f.id.startsWith('deopt-loop:'))!;
    assert.equal(f.severity, 'critical');
  });

  it('does not emit deopt-loop without --deep mode', () => {
    const noDeepReport = createReport(
      makeRaw(
        {
          nodes: [
            {
              id: 1,
              callFrame: {
                functionName: '(root)',
                scriptId: '0',
                url: '',
                lineNumber: -1,
                columnNumber: -1,
              },
              hitCount: 0,
              children: [],
            },
          ],
          startTime: 1000000,
          endTime: 2000000,
          samples: [],
          timeDeltas: [],
        },
        {
          deopts: [
            {
              function: 'fn',
              file: `${CWD}/src/app.js`,
              line: 1,
              reason: 'soft',
              bailoutType: 'soft',
              count: 10,
            },
          ],
        },
      ),
      { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'] },
    );
    assert.equal(
      noDeepReport.findings.some((f) => f.id.startsWith('deopt-loop:')),
      false,
    );
  });
});

describe('findings – deopt-loop cold function suppression', () => {
  const report = createReport(
    makeRaw(
      {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [2, 3],
          },
          {
            id: 2,
            callFrame: {
              functionName: 'hotFn',
              scriptId: '1',
              url: `file://${CWD}/src/hot.js`,
              lineNumber: 8,
              columnNumber: 0,
            },
            hitCount: 99,
            children: [],
          },
          {
            id: 3,
            callFrame: {
              functionName: 'coldFn',
              scriptId: '2',
              url: `file://${CWD}/src/cold.js`,
              lineNumber: 5,
              columnNumber: 0,
            },
            hitCount: 1,
            children: [],
          },
        ],
        startTime: 1000000,
        endTime: 2000000,
        samples: Array(99).fill(2).concat([3]),
        timeDeltas: [],
      },
      {
        deopts: [
          {
            function: 'coldFn',
            file: `${CWD}/src/cold.js`,
            line: 5,
            reason: 'wrong map',
            bailoutType: 'soft',
            count: 10,
          },
        ],
      },
    ),
    { sampleIntervalMicros: 1000, deep: true, command: ['node', 'app.js'] },
  );

  it('does not emit deopt-loop for cold functions', () => {
    assert.equal(
      report.findings.some((f) => f.id.startsWith('deopt-loop:')),
      false,
    );
  });
});

describe('findings – require-in-hot-path', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'handleRequest',
          scriptId: '1',
          url: `file://${CWD}/src/handler.js`,
          lineNumber: 8,
          columnNumber: 0,
        },
        hitCount: 5,
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'Module._load',
          scriptId: '0',
          url: 'node:internal/modules/cjs/loader',
          lineNumber: 0,
          columnNumber: 0,
        },
        hitCount: 95,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(95).fill(3).concat(Array(5).fill(2)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('detects require-in-hot-path when Module._load is on the hot path', () => {
    const f = report.findings.find((f) => f.id === 'require-in-hot-path');
    assert.ok(
      f,
      `Expected require-in-hot-path finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('require-in-hot-path evidence points to the Module._load frame', () => {
    const f = report.findings.find((f) => f.id === 'require-in-hot-path')!;
    assert.match(f.evidence.function, /handleRequest/);
  });

  it('require-in-hot-path keeps the builtin callee in evidence.extra', () => {
    const f = report.findings.find((f) => f.id === 'require-in-hot-path')!;
    assert.match(String((f.evidence.extra as Record<string, unknown>)?.callee), /_load/);
  });

  it('require-in-hot-path is at least info severity', () => {
    const f = report.findings.find((f) => f.id === 'require-in-hot-path')!;
    assert.ok(f.severity === 'info' || f.severity === 'warning' || f.severity === 'critical');
  });
});

describe('findings – json-on-hot-path', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'serializeResponse',
          scriptId: '1',
          url: `file://${CWD}/src/http.js`,
          lineNumber: 12,
          columnNumber: 0,
        },
        hitCount: 15,
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'JSON.stringify',
          scriptId: '0',
          url: 'node:internal/json',
          lineNumber: 0,
          columnNumber: 0,
        },
        hitCount: 85,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(85).fill(3).concat(Array(15).fill(2)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('detects json-on-hot-path', () => {
    const f = report.findings.find((f) => f.id.startsWith('json-on-hot-path:'));
    assert.ok(
      f,
      `Expected json-on-hot-path finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('attributes json-on-hot-path to the user caller', () => {
    const f = report.findings.find((f) => f.id.startsWith('json-on-hot-path:'))!;
    assert.match(f.evidence.function, /serializeResponse/);
    assert.match(String((f.evidence.extra as Record<string, unknown>)?.callee), /JSON\.stringify/);
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'attributed-caller');
  });
});

describe('findings – node-modules-hotspot', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'renderPage',
          scriptId: '1',
          url: `file://${CWD}/src/server.js`,
          lineNumber: 3,
          columnNumber: 0,
        },
        hitCount: 15,
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'compile',
          scriptId: '2',
          url: `file://${CWD}/node_modules/markdown-it/index.js`,
          lineNumber: 41,
          columnNumber: 0,
        },
        hitCount: 85,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(85).fill(3).concat(Array(15).fill(2)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('detects node-modules-hotspot', () => {
    const f = report.findings.find((f) => f.id.startsWith('node-modules-hotspot:'));
    assert.ok(
      f,
      `Expected node-modules-hotspot finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
  });

  it('reports the dependency package and user caller', () => {
    const f = report.findings.find((f) => f.id.startsWith('node-modules-hotspot:'))!;
    assert.match(f.evidence.function, /renderPage/);
    assert.equal((f.evidence.extra as Record<string, unknown>)?.package, 'markdown-it');
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'attributed-caller');
  });

  it('serializes even when the dependency callee location is unavailable', () => {
    const finding = report.findings.find((candidate) =>
      candidate.id.startsWith('node-modules-hotspot:'),
    );
    assert.ok(finding, 'Expected node-modules-hotspot finding');
    const extra = finding.evidence.extra as Record<string, unknown>;
    delete extra.calleeFile;
    delete extra.calleeLine;

    assert.doesNotThrow(() => serializeReport(report, { pretty: false }));
  });
});

describe('findings – node-modules-hotspot selection uses inclusive cost', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2, 3],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'renderA',
          scriptId: '1',
          url: `file://${CWD}/src/server-a.js`,
          lineNumber: 3,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [4],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'renderB',
          scriptId: '2',
          url: `file://${CWD}/src/server-b.js`,
          lineNumber: 7,
          columnNumber: 0,
        },
        hitCount: 30,
        children: [5],
      },
      {
        id: 4,
        callFrame: {
          functionName: 'compile',
          scriptId: '3',
          url: `file://${CWD}/node_modules/markdown-it/index.js`,
          lineNumber: 41,
          columnNumber: 0,
        },
        hitCount: 60,
        children: [],
      },
      {
        id: 5,
        callFrame: {
          functionName: 'render',
          scriptId: '4',
          url: `file://${CWD}/node_modules/react-dom/index.js`,
          lineNumber: 12,
          columnNumber: 0,
        },
        hitCount: 10,
        children: [6],
      },
      {
        id: 6,
        callFrame: {
          functionName: 'diff',
          scriptId: '5',
          url: `file://${CWD}/node_modules/react-dom/index.js`,
          lineNumber: 18,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(20).fill(4).concat(Array(80).fill(5)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('prefers the dependency with the highest totalPct', () => {
    const f = report.findings.find((candidate) =>
      candidate.id.startsWith('node-modules-hotspot:'),
    )!;
    assert.equal((f.evidence.extra as Record<string, unknown>)?.package, 'react-dom');
  });
});

describe('findings – cpu-bound-user-hotspot', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'computeRanking',
          scriptId: '1',
          url: `file://${CWD}/src/ranking.js`,
          lineNumber: 27,
          columnNumber: 0,
        },
        hitCount: 100,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(100).fill(2),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('detects a dominant user-code hotspot', () => {
    const f = report.findings.find((f) => f.id.startsWith('cpu-bound-user-hotspot:'));
    assert.ok(
      f,
      `Expected cpu-bound-user-hotspot finding. findings = ${JSON.stringify(report.findings.map((f) => f.id))}`,
    );
    assert.match(f.evidence.function, /computeRanking/);
    assert.equal(
      (f?.evidence.extra as Record<string, unknown>)?.proofLevel,
      'aggregate-correlation',
    );
  });
});

describe('findings – cpu-bound-user-hotspot selection uses inclusive cost', () => {
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2, 3],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'expensiveLeaf',
          scriptId: '1',
          url: `file://${CWD}/src/a.js`,
          lineNumber: 4,
          columnNumber: 0,
        },
        hitCount: 35,
        children: [],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'broadPath',
          scriptId: '2',
          url: `file://${CWD}/src/b.js`,
          lineNumber: 9,
          columnNumber: 0,
        },
        hitCount: 5,
        children: [4],
      },
      {
        id: 4,
        callFrame: {
          functionName: 'broadChild',
          scriptId: '3',
          url: `file://${CWD}/src/b.js`,
          lineNumber: 15,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(35).fill(2).concat(Array(65).fill(4)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('prefers the user hotspot with the highest totalPct', () => {
    const f = report.findings.find((candidate) =>
      candidate.id.startsWith('cpu-bound-user-hotspot:'),
    )!;
    assert.match(f.evidence.function, /broadPath/);
  });
});

describe('findings – cpu-bound-user-hotspot suppression', () => {
  const report = makeReport('sync-crypto');

  it('does not emit cpu-bound-user-hotspot when a more specific detector explains the work', () => {
    assert.equal(
      report.findings.some((f) => f.id.startsWith('cpu-bound-user-hotspot:')),
      false,
    );
  });
});

describe('findings – no false positives on clean profile', () => {
  // A profile where a user function does simple computation — no known anti-patterns
  const profile: RawCpuProfile = {
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 0,
        children: [2, 3],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'computeFibonacci',
          scriptId: '1',
          url: `file://${CWD}/src/fib.js`,
          lineNumber: 5,
          columnNumber: 0,
        },
        hitCount: 4,
        children: [],
      },
      {
        id: 3,
        callFrame: {
          functionName: '(idle)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 96,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(4).fill(2).concat(Array(96).fill(3)),
    timeDeltas: [],
  };

  const raw = makeRaw(profile);
  const report = createReport(raw, {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'fib.js'],
  });

  it('does not emit false positive findings', () => {
    const bad = report.findings.filter(
      (f) => f.id !== 'event-loop-stall' && f.id !== 'excessive-gc',
    );
    assert.equal(bad.length, 0, `Unexpected findings: ${JSON.stringify(bad.map((f) => f.id))}`);
  });
});

describe('report structure – meta is complete', () => {
  const report = makeReport('sync-crypto');

  it('meta has required fields', () => {
    assert.ok(report.meta.nodeVersion.startsWith('v'));
    assert.ok(report.meta.durationMs > 0);
    assert.ok(report.meta.totalSamples > 0);
    assert.ok(report.meta.cwd === CWD);
    assert.equal(report.meta.lanternaVersion, LANTERNA_VERSION);
    assert.equal(report.meta.mode, 'spawn');
    assert.equal(report.meta.captureIntegrity.controlChannel, true);
  });

  it('summary ratios sum to ~1', () => {
    const s = report.summary;
    const sum = s.userCodeRatio + s.nodeModulesRatio + s.builtinRatio + s.nativeRatio + s.gcRatio;
    assert.ok(Math.abs(sum - 1) < 0.01, `ratio sum ${sum} should be ~1 (on-CPU basis)`);
  });

  it('summary exposes dominant blocking kind when available', () => {
    assert.equal(report.summary.dominantBlockingKind, 'sync-crypto');
  });
});

describe('report structure – timed GC events are preserved', () => {
  const report = makeReport('gc-pressure', {
    gcEvents: [
      { atMs: 123, kind: 'scavenge', durationMs: 12 },
      { atMs: 456, kind: 'markSweep', durationMs: 34 },
    ],
  });

  it('keeps GC timestamps in pausesOver10ms', () => {
    assert.deepEqual(report.gc.pausesOver10ms, [
      { atMs: 123, kind: 'scavenge', durationMs: 12 },
      { atMs: 456, kind: 'markSweep', durationMs: 34 },
    ]);
  });
});
