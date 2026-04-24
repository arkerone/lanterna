import { captureDiagnosticMessage, recordCaptureDiagnostic } from '../core/session.js';
import type { ConnectedSource } from '../core/types.js';
import { withTimeoutResult } from './timeouts.js';

const CDP_CLOSE_TIMEOUT_MS = 2000;

export class CaptureSession {
  appCompleted = false;
  private cdpClosed = false;
  private finalized = false;

  constructor(private readonly connected: ConnectedSource) {}

  async closeCdp(): Promise<void> {
    if (this.cdpClosed) return;
    this.cdpClosed = true;
    try {
      const result = await withTimeoutResult(this.connected.cdp.close(), CDP_CLOSE_TIMEOUT_MS);
      if (!result.ok) {
        recordCaptureDiagnostic(this.connected.initialIntegrity, {
          stage: 'finalize',
          message: `timed out closing CDP connection after ${CDP_CLOSE_TIMEOUT_MS}ms`,
        });
      }
    } catch (error) {
      recordCaptureDiagnostic(this.connected.initialIntegrity, {
        stage: 'finalize',
        message: `failed to close CDP connection: ${captureDiagnosticMessage(error)}`,
      });
    }
  }

  async finalize(options: { suppressErrors: boolean }): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    try {
      await this.connected.finalize({ appCompleted: this.appCompleted });
    } catch (error) {
      recordCaptureDiagnostic(this.connected.initialIntegrity, {
        stage: 'finalize',
        message: captureDiagnosticMessage(error),
      });
      if (!options.suppressErrors) throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.closeCdp();
    await this.finalize({ suppressErrors: true });
  }
}
