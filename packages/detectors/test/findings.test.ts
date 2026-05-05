import assert from 'node:assert/strict';
import {
  buildLanternaReport,
  type CaptureBundle,
  createCpuProfileKind,
  LANTERNA_VERSION,
  type LanternaReport,
  type RawCpuProfile,
  serializeReport,
} from '@lanterna-profiler/core';
import { describe, it } from 'vitest';
import { analyzeCapture } from '../src/analyze-capture.js';
import { CWD, loadProfile, makeRaw } from './helpers.js';

function buildCpuKinds(opts: { sampleIntervalMicros: number; deep: boolean }) {
  return [
    createCpuProfileKind({
      readStderrSoFar: () => '',
      sampleIntervalMicros: opts.sampleIntervalMicros,
      deep: opts.deep,
    }),
  ];
}

function makeReport(profileName: string, overrides: Partial<CaptureBundle> = {}): LanternaReport {
  const profile = loadProfile(profileName);
  const raw = makeRaw(profile, overrides);
  return createReport(raw, {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });
}

function createReport(
  raw: CaptureBundle,
  options: { sampleIntervalMicros: number; deep: boolean; command: string[] },
): LanternaReport {
  const kinds = buildCpuKinds(options);
  const analysisOptions = { command: options.command };
  return buildLanternaReport(
    raw,
    analyzeCapture(raw, analysisOptions, kinds),
    kinds,
    analysisOptions,
  );
}

const cpuKinds = buildCpuKinds({ sampleIntervalMicros: 1000, deep: false });

function findFindingOrFail(
  report: LanternaReport,
  predicate: (finding: LanternaReport['findings'][number]) => boolean,
  description: string,
) {
  const finding = report.findings.find(predicate);
  assert.ok(
    finding,
    `Expected ${description}. findings = ${JSON.stringify(report.findings.map((entry) => entry.id))}`,
  );
  return finding;
}

function getCpuProfile(report: LanternaReport) {
  const cpuProfile = report.profiles.cpu;
  assert.ok(cpuProfile, 'Expected cpu profile in report');
  return cpuProfile;
}

describe('findings – sync-crypto-on-hot-path', () => {
  const report = makeReport('sync-crypto');

  it('detects sync-crypto finding', () => {
    findFindingOrFail(report, (f) => f.id === 'sync-crypto-on-hot-path', 'sync-crypto finding');
  });

  it('finding has severity warning or critical', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'sync-crypto-on-hot-path',
      'sync-crypto finding',
    );
    assert.ok(f.severity === 'warning' || f.severity === 'critical');
  });

  it('finding has a non-empty suggestion', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'sync-crypto-on-hot-path',
      'sync-crypto finding',
    );
    assert.ok(f.suggestion.length > 10);
  });

  it('finding evidence points to user caller, not node internals', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'sync-crypto-on-hot-path',
      'sync-crypto finding',
    );
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

describe('findings – sync-crypto aggregate regression', () => {
  const cryptoNodes = Array.from({ length: 10 }, (_, index) => {
    const userId = 2 + index * 2;
    const cryptoId = userId + 1;
    return {
      user: {
        id: userId,
        callFrame: {
          functionName: `route${index}`,
          scriptId: '1',
          url: `file://${CWD}/src/routes.js`,
          lineNumber: 10 + index,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [cryptoId],
      },
      crypto: {
        id: cryptoId,
        callFrame: {
          functionName: 'randomBytesSync',
          scriptId: '0',
          url: 'node:crypto',
          lineNumber: index,
          columnNumber: 0,
        },
        hitCount: 8,
        children: [],
      },
    };
  });
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
        children: cryptoNodes.map(({ user }) => user.id).concat([99]),
      },
      ...cryptoNodes.flatMap(({ user, crypto }) => [user, crypto]),
      {
        id: 99,
        callFrame: {
          functionName: '(idle)',
          scriptId: '0',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
        hitCount: 20,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: cryptoNodes
      .flatMap(({ crypto }) => Array(8).fill(crypto.id))
      .concat(Array(20).fill(99)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('emits sync-crypto when only the API family total crosses threshold', () => {
    const findings = report.findings.filter((f) => f.id === 'sync-crypto-on-hot-path');
    assert.ok(findings.length > 0);
    assert.ok(
      findings.every(
        (finding) =>
          ((finding.evidence.extra as Record<string, unknown>).calleeTotalPct as number) < 10,
      ),
    );
    assert.ok(
      findings.some(
        (finding) =>
          ((finding.evidence.extra as Record<string, unknown>).categoryTotalPct as number) >= 3,
      ),
    );
  });
});

describe('capture integrity – attach mode clean regression', () => {
  const report = makeReport('sync-crypto', {
    captureIntegrity: {
      controlChannel: false,
      controlChannelExpected: false,
      eventLoopTimed: true,
      gcTimed: false,
      gcObserverAvailable: true,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    },
  });

  it('treats an absent control channel as clean when attach mode did not expect it', () => {
    assert.equal(report.meta.captureIntegrity.controlChannel, false);
    assert.equal(report.meta.captureIntegrity.controlChannelExpected, false);
    assert.equal(report.meta.captureIntegrity.controlChannelWriteErrors, 0);
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
    findFindingOrFail(report, (f) => f.id === 'excessive-gc', 'excessive-gc finding');
  });

  it('excessive-gc finding has suggestion', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'excessive-gc',
      'excessive-gc finding',
    );
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
        controlChannelExpected: true,
        eventLoopTimed: false,
        gcTimed: false,
        gcObserverAvailable: true,
        controlChannelWriteErrors: 0,
        gcObserverSetupFailed: 0,
        heartbeatDropped: 0,
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
      controlChannelExpected: true,
      eventLoopTimed: true,
      gcTimed: false,
      gcObserverAvailable: true,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    },
  });

  it('detects event-loop-stall when max lag > 200ms', () => {
    findFindingOrFail(report, (f) => f.id === 'event-loop-stall', 'event-loop-stall finding');
  });

  it('derives real stall intervals from timed heartbeats', () => {
    assert.deepEqual(getCpuProfile(report).eventLoop.stallIntervals, [
      { startMs: 20, endMs: 320, maxLagMs: 300 },
      { startMs: 340, endMs: 1000, maxLagMs: 660 },
    ]);
  });

  it('includes correlated hotspot candidates in event-loop evidence', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'event-loop-stall',
      'event-loop-stall finding',
    );
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
      controlChannelExpected: true,
      eventLoopTimed: false,
      gcTimed: false,
      gcObserverAvailable: true,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    },
  });

  it('does not claim event-loop availability without heartbeats or histogram', () => {
    const cpuProfile = getCpuProfile(report);
    assert.equal(cpuProfile.eventLoop.available, false);
    assert.equal(cpuProfile.eventLoop.measurementBasis, 'none');
    assert.equal(cpuProfile.eventLoop.confidence, 'none');
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
    findFindingOrFail(report, (f) => f.id.startsWith('blocking-io'), 'blocking-io finding');
  });

  it('blocking-io evidence points to user caller, not node:fs internal', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id.startsWith('blocking-io'),
      'blocking-io finding',
    );
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
    findFindingOrFail(report, (f) => f.id.startsWith('deopt-loop:'), 'deopt-loop finding');
  });

  it('deopt-loop finding has warning severity for count 5-20', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id.startsWith('deopt-loop:'),
      'deopt-loop finding',
    );
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
    const f = findFindingOrFail(
      heavyReport,
      (finding) => finding.id.startsWith('deopt-loop:'),
      'deopt-loop finding',
    );
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
    findFindingOrFail(report, (f) => f.id === 'require-in-hot-path', 'require-in-hot-path finding');
  });

  it('require-in-hot-path evidence points to the Module._load frame', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'require-in-hot-path',
      'require-in-hot-path finding',
    );
    assert.match(f.evidence.function, /handleRequest/);
  });

  it('require-in-hot-path keeps the builtin callee in evidence.extra', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'require-in-hot-path',
      'require-in-hot-path finding',
    );
    assert.match(String((f.evidence.extra as Record<string, unknown>)?.callee), /_load/);
  });

  it('require-in-hot-path is at least info severity', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id === 'require-in-hot-path',
      'require-in-hot-path finding',
    );
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
    findFindingOrFail(
      report,
      (f) => f.id.startsWith('json-on-hot-path:'),
      'json-on-hot-path finding',
    );
  });

  it('attributes json-on-hot-path to the user caller', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id.startsWith('json-on-hot-path:'),
      'json-on-hot-path finding',
    );
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
    findFindingOrFail(
      report,
      (f) => f.id.startsWith('node-modules-hotspot:'),
      'node-modules-hotspot finding',
    );
  });

  it('reports the dependency package and user caller', () => {
    const f = findFindingOrFail(
      report,
      (finding) => finding.id.startsWith('node-modules-hotspot:'),
      'node-modules-hotspot finding',
    );
    assert.match(f.evidence.function, /renderPage/);
    assert.equal((f.evidence.extra as Record<string, unknown>)?.package, 'markdown-it');
    assert.equal((f.evidence.extra as Record<string, unknown>)?.proofLevel, 'attributed-caller');
    const hotspot = report.profiles.cpu?.hotspots.find((entry) => entry.function === 'compile');
    assert.equal(hotspot?.userCaller?.function, 'renderPage');
    assert.equal(hotspot?.userCaller?.basis, 'cpu-sample-path');
    assert.equal(hotspot?.userCaller?.confidence, 'high');
  });

  it('serializes even when the dependency callee location is unavailable', () => {
    const finding = report.findings.find((candidate) =>
      candidate.id.startsWith('node-modules-hotspot:'),
    );
    assert.ok(finding, 'Expected node-modules-hotspot finding');
    const extra = finding.evidence.extra as Record<string, unknown>;
    delete extra.calleeFile;
    delete extra.calleeLine;

    assert.doesNotThrow(() => serializeReport(report, { pretty: false, kinds: cpuKinds }));
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
    const f = findFindingOrFail(
      report,
      (candidate) => candidate.id.startsWith('node-modules-hotspot:'),
      'node-modules-hotspot finding',
    );
    assert.equal((f.evidence.extra as Record<string, unknown>)?.package, 'react-dom');
  });
});

describe('summary – topUserHotspot', () => {
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

  it('exposes a dominant user-code hotspot in summary instead of findings', () => {
    const cpuProfile = getCpuProfile(report);
    assert.equal(
      report.findings.some((f) => f.id.startsWith('cpu-bound-user-hotspot:')),
      false,
    );
    assert.match(cpuProfile.summary.topUserHotspot?.function ?? '', /computeRanking/);
    assert.equal(cpuProfile.summary.topUserHotspot?.totalPct, 100);
  });
});

describe('summary – topUserHotspot selection uses inclusive cost', () => {
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
    assert.match(getCpuProfile(report).summary.topUserHotspot?.function ?? '', /broadPath/);
  });
});

describe('findings – cpu-bound-user-hotspot suppression', () => {
  const report = makeReport('sync-crypto');

  it('does not emit cpu-bound-user-hotspot when a more specific detector explains the work', () => {
    assert.equal(
      report.findings.some((f) => f.id.startsWith('cpu-bound-user-hotspot:')),
      false,
    );
    assert.equal(getCpuProfile(report).summary.topUserHotspot, undefined);
  });
});

describe('findings – triple-hotspot regression', () => {
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
        children: [2, 4, 6],
      },
      {
        id: 2,
        callFrame: {
          functionName: 'hashPassword',
          scriptId: '1',
          url: `file://${CWD}/src/auth.js`,
          lineNumber: 10,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [3],
      },
      {
        id: 3,
        callFrame: {
          functionName: 'pbkdf2Sync',
          scriptId: '0',
          url: 'node:crypto',
          lineNumber: 0,
          columnNumber: 0,
        },
        hitCount: 35,
        children: [],
      },
      {
        id: 4,
        callFrame: {
          functionName: 'loadConfig',
          scriptId: '2',
          url: `file://${CWD}/src/config.js`,
          lineNumber: 4,
          columnNumber: 0,
        },
        hitCount: 0,
        children: [5],
      },
      {
        id: 5,
        callFrame: {
          functionName: 'readFileSync',
          scriptId: '0',
          url: 'node:fs',
          lineNumber: 0,
          columnNumber: 0,
        },
        hitCount: 30,
        children: [],
      },
      {
        id: 6,
        callFrame: {
          functionName: 'renderDashboard',
          scriptId: '3',
          url: `file://${CWD}/src/dashboard.js`,
          lineNumber: 30,
          columnNumber: 0,
        },
        hitCount: 35,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(35).fill(3).concat(Array(30).fill(5), Array(35).fill(6)),
    timeDeltas: [],
  };

  const report = createReport(makeRaw(profile), {
    sampleIntervalMicros: 1000,
    deep: false,
    command: ['node', 'app.js'],
  });

  it('keeps specific findings and does not emit the old generic cpu-bound finding', () => {
    const cpuProfile = getCpuProfile(report);
    assert.ok(report.findings.some((f) => f.category === 'sync-crypto'));
    assert.ok(report.findings.some((f) => f.category === 'blocking-io'));
    assert.equal(
      report.findings.some((f) => f.category === 'cpu-bound-user-hotspot'),
      false,
    );
    assert.match(cpuProfile.summary.topUserHotspot?.function ?? '', /renderDashboard/);
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
    assert.ok((report.meta.kinds.cpu as { samplesTotal: number }).samplesTotal > 0);
    assert.ok(report.meta.cwd === CWD);
    assert.equal(report.meta.lanternaVersion, LANTERNA_VERSION);
    assert.equal(report.meta.mode, 'spawn');
    assert.equal(report.meta.captureIntegrity.controlChannel, true);
  });

  it('summary ratios sum to ~1', () => {
    const s = getCpuProfile(report).summary;
    const sum = s.userCodeRatio + s.nodeModulesRatio + s.builtinRatio + s.nativeRatio + s.gcRatio;
    assert.ok(Math.abs(sum - 1) < 0.01, `ratio sum ${sum} should be ~1 (on-CPU basis)`);
  });

  it('summary exposes dominant blocking kind when available', () => {
    assert.equal(getCpuProfile(report).summary.dominantBlockingKind, 'sync-crypto');
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
    assert.deepEqual(getCpuProfile(report).gc.pausesOver10ms, [
      { atMs: 123, kind: 'scavenge', durationMs: 12 },
      { atMs: 456, kind: 'markSweep', durationMs: 34 },
    ]);
  });
});
