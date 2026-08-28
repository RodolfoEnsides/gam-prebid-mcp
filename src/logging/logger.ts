import type { AppConfig } from '../config/env.js';
import { sanitizeForLogging } from '../security/sanitize.js';

export type LogLevel = AppConfig['logging']['level'];
export type LogContext = Record<string, unknown>;

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
}

const priorities: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    if (priorities[level] < priorities[minimumLevel]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: sanitizeForLogging(context),
    };
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    trace: (message, context) => write('trace', message, context),
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
    fatal: (message, context) => write('fatal', message, context),
  };
}
