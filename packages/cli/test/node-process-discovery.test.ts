import { afterEach, describe, expect, it, vi } from 'vitest';

type PsEntry = {
  pid: number;
  name: string;
  cmd?: string;
  path?: string;
  startTime?: Date;
  cpu?: number;
  memory?: number;
};

const mocks = vi.hoisted(() => ({
  psList: vi.fn<() => Promise<PsEntry[]>>(),
  readInspectableTargetsByPid:
    vi.fn<() => Promise<Map<number, { webSocketDebuggerUrl: string }>>>(),
}));

vi.mock('ps-list', () => ({
  default: mocks.psList,
}));

vi.mock('@lanterna-profiler/core', () => ({
  readInspectableTargetsByPid: mocks.readInspectableTargetsByPid,
}));

const { listRunningNodeProcesses } = await import('../src/node-process-discovery.js');

function processEntry(overrides: Partial<PsEntry>): PsEntry {
  return {
    pid: 1000,
    name: 'node',
    cmd: 'node server.js',
    path: '/usr/bin/node',
    ...overrides,
  };
}

describe('listRunningNodeProcesses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.psList.mockReset();
    mocks.readInspectableTargetsByPid.mockReset();
  });

  it('lists live node and nodejs runtimes, excluding other launchers', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    mocks.psList.mockResolvedValue([
      processEntry({
        pid: 2001,
        cmd: 'node server.js',
        cpu: 1,
      }),
      processEntry({
        pid: 2002,
        cmd: 'node --watch --inspect=127.0.0.1:9230 src/index.ts',
        cpu: 2,
      }),
      processEntry({
        pid: 2003,
        cmd: 'node worker.js',
        cpu: 3,
      }),
      processEntry({
        pid: 2004,
        name: 'nodejs',
        cmd: 'nodejs api.js',
        path: '/usr/bin/nodejs',
        cpu: 4,
      }),
      processEntry({
        pid: 3001,
        name: 'pnpm',
        cmd: 'pnpm run dev',
        path: '/usr/bin/pnpm',
      }),
      processEntry({
        pid: 3002,
        name: 'npm',
        cmd: 'npm run dev',
        path: '/usr/bin/npm',
      }),
      processEntry({
        pid: 3010,
        name: 'cursor',
        cmd: '/opt/Cursor/cursor --type=utility --utility-sub-type=node.mojom.NodeService --node-ipc',
        path: '/opt/Cursor/cursor',
      }),
    ]);
    mocks.readInspectableTargetsByPid.mockResolvedValue(
      new Map([[2003, { webSocketDebuggerUrl: 'ws://127.0.0.1:9229/app' }]]),
    );

    const processes = await listRunningNodeProcesses();

    expect(processes.map((processEntry) => processEntry.pid)).toEqual([2003, 2004, 2002, 2001]);
    expect(processes).toContainEqual(
      expect.objectContaining({
        pid: 2003,
        attachMode: 'cdp-ready',
        runtime: 'node',
      }),
    );
    expect(processes).toContainEqual(
      expect.objectContaining({
        pid: 2004,
        attachMode: 'pid-attach',
        runtime: 'nodejs',
      }),
    );
    expect(processes.some((processEntry) => processEntry.pid === 3001)).toBe(false);
    expect(processes.some((processEntry) => processEntry.pid === 3002)).toBe(false);
    expect(processes.some((processEntry) => processEntry.pid === 3010)).toBe(false);
  });

  it('does not classify direct node commands by purpose', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    mocks.psList.mockResolvedValue([
      processEntry({
        pid: 2100,
        cmd: 'node /repo/node_modules/.bin/pino-pretty',
      }),
      processEntry({
        pid: 2101,
        cmd: 'node /srv/browser-extension-worker/server.js',
      }),
    ]);
    mocks.readInspectableTargetsByPid.mockResolvedValue(new Map());

    await expect(listRunningNodeProcesses()).resolves.toEqual([
      expect.objectContaining({
        pid: 2100,
        attachMode: 'pid-attach',
      }),
      expect.objectContaining({
        pid: 2101,
        attachMode: 'pid-attach',
      }),
    ]);
  });

  it('drops stale snapshot entries whose pid no longer exists', async () => {
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 2200) throw new Error('not running');
      return true;
    });

    mocks.psList.mockResolvedValue([
      processEntry({
        pid: 2200,
        cmd: 'node stale.js',
      }),
      processEntry({
        pid: 2201,
        cmd: 'node live.js',
      }),
    ]);
    mocks.readInspectableTargetsByPid.mockResolvedValue(
      new Map([[2200, { webSocketDebuggerUrl: 'ws://127.0.0.1:9229/stale' }]]),
    );

    await expect(listRunningNodeProcesses()).resolves.toEqual([
      expect.objectContaining({
        pid: 2201,
        command: 'node live.js',
      }),
    ]);
  });
});
