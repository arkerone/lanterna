import { describe, expect, it } from 'vitest';
import { normalizeCdpAsyncStackTrace } from '../src/kinds/async/cdp-stack.js';

describe('CDP async stack normalization', () => {
  it('flattens synchronous and async parent stack traces with proof metadata', () => {
    const normalized = normalizeCdpAsyncStackTrace('Runtime.exceptionThrown', {
      callFrames: [
        {
          functionName: 'handler',
          url: 'file:///app/server.js',
          lineNumber: 9,
          columnNumber: 2,
        },
      ],
      parent: {
        description: 'await',
        callFrames: [
          {
            functionName: 'loadUser',
            url: 'file:///app/users.js',
            lineNumber: 41,
            columnNumber: 6,
          },
        ],
      },
    });

    expect(normalized).toMatchObject({
      source: 'Runtime.exceptionThrown',
      proofLevel: 'cdp-debugger-async-stack',
      frames: [
        { function: 'handler', file: 'file:///app/server.js', line: 10, column: 3 },
        { function: 'loadUser', file: 'file:///app/users.js', line: 42, column: 7 },
      ],
      asyncStack: [
        {
          description: 'await',
          frames: [{ function: 'loadUser', file: 'file:///app/users.js', line: 42, column: 7 }],
        },
      ],
    });
  });
});
