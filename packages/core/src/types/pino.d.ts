declare module 'pino' {
  export type LevelWithSilent = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

  export interface Logger {
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    debug(obj: unknown, msg?: string): void;
  }

  export interface LoggerOptions {
    name?: string;
    level?: LevelWithSilent;
    base?: object | undefined;
    timestamp?: boolean;
  }

  export interface DestinationStream {}

  interface PinoFunction {
    (options?: LoggerOptions, destination?: DestinationStream): Logger;
    destination(options: { dest: number; sync: boolean }): DestinationStream;
  }

  const pino: PinoFunction;
  export default pino;
}
