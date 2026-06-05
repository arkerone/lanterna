import { describe, expect, it } from 'vitest';
import {
  isEditableUserFile,
  isLanternaInstrumentationPath,
} from '../../src/renderers/agent/paths.js';

describe('isEditableUserFile', () => {
  it('treats real application source as editable', () => {
    expect(isEditableUserFile('/app/server.js')).toBe(true);
    expect(isEditableUserFile('./src/handlers/login.ts')).toBe(true);
  });

  it('rejects dependency and runtime paths', () => {
    expect(isEditableUserFile('/app/node_modules/pkg/index.js')).toBe(false);
    expect(isEditableUserFile('node:internal/crypto/pbkdf2')).toBe(false);
  });

  it("rejects Lanterna's own injected preload so it never becomes a read target", () => {
    expect(isEditableUserFile('/tmp/lanterna-preload-123-456-abc.cjs')).toBe(false);
    expect(isLanternaInstrumentationPath('/tmp/lanterna-preload-123-456-abc.cjs')).toBe(true);
    expect(isLanternaInstrumentationPath('/app/server.js')).toBe(false);
  });
});
