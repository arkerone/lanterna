import { describe, expect, it } from 'vitest';
import { parseDeoptsFromStderr } from '../src/capture/core/deopts.js';

describe('parseDeoptsFromStderr', () => {
  it('parses Node 24 bailout lines with JSFunction names and no source location', () => {
    const trace = [
      '[bailout (kind: deopt-eager, reason: prepare for on stack replacement (OSR)): begin. deoptimizing 0x1a9113053409 <JSFunction deoptLoop (sfi = 0x2aa809203971)>, 0x03b4315437a9 <Code MAGLEV>, opt id 3, bytecode offset 247, deopt exit 27, FP to SP delta 120, caller SP 0x7fffeb7988f0, pc 0x7c0b96807624]',
      '[bailout (kind: deopt-eager, reason: not a String): begin. deoptimizing 0x1a9113053409 <JSFunction deoptLoop (sfi = 0x2aa809203971)>, 0x236a86703151 <Code TURBOFAN_JS>, opt id 4, bytecode offset 86, deopt exit 14, FP to SP delta 160, caller SP 0x7fffeb7988f0, pc 0x7c0b96808331]',
      '[bailout (kind: deopt-eager, reason: prepare for on stack replacement (OSR)): begin. deoptimizing 0x1a9113053409 <JSFunction deoptLoop (sfi = 0x2aa809203971)>, 0x236a867042c9 <Code MAGLEV>, opt id 5, bytecode offset 247, deopt exit 23, FP to SP delta 120, caller SP 0x7fffeb7988f0, pc 0x7c0b968099a0]',
    ].join('\n');

    expect(parseDeoptsFromStderr(trace)).toEqual([
      {
        function: 'deoptLoop',
        file: '',
        line: 0,
        reason: 'prepare for on stack replacement (OSR)',
        bailoutType: 'deopt-eager',
        count: 2,
      },
      {
        function: 'deoptLoop',
        file: '',
        line: 0,
        reason: 'not a String',
        bailoutType: 'deopt-eager',
        count: 1,
      },
    ]);
  });

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
