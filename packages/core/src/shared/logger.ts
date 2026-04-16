import type { LevelWithSilent, Logger } from 'pino';
import pino from 'pino';

export type LoggerLevel = 'silent' | 'warn' | 'debug';

const destination = pino.destination({ dest: 2, sync: true });

export function resolveLogLevel(value = process.env.LANTERNA_LOG): LoggerLevel {
  if (value === 'debug') return 'debug';
  if (value === 'warn') return 'warn';
  return 'silent';
}

function toPinoLevel(level: LoggerLevel): LevelWithSilent {
  if (level === 'debug') return 'debug';
  if (level === 'warn') return 'warn';
  return 'error';
}

export function createLogger({ level = resolveLogLevel() }: { level?: LoggerLevel } = {}): Logger {
  return pino(
    {
      name: 'lanterna',
      level: toPinoLevel(level),
      base: undefined,
      timestamp: false,
    },
    destination,
  );
}

export const logger = createLogger();
