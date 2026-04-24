import { describe, expect, it } from 'vitest';
import { parseDeoptsFromStderr } from '../src/capture/core/deopts.js';

describe('parseDeoptsFromStderr', () => {
  it('parses dependent-code deoptimization lines emitted by V8', () => {
    const trace =
      '[marking dependent code 0x391aa99446d1 <Code TURBOFAN_JS> (0x0ddd9864dfe1 <SharedFunctionInfo churn>) (opt id 0) for deoptimization, reason: dependent field representation changed]';

    expect(parseDeoptsFromStderr(trace)).toEqual([
      {
        function: 'churn',
        file: '',
        line: 0,
        reason: 'dependent field representation changed',
        bailoutType: 'dependent-code',
        count: 1,
      },
    ]);
  });
});
