import picocolors from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_MAP: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: number;

  constructor(level: LogLevel = 'info') {
    this.level = LEVEL_MAP[level];
  }

  public setLevel(level: LogLevel) {
    this.level = LEVEL_MAP[level];
  }

  private formatMessage(level: LogLevel, msg: string, meta?: any) {
    const timestamp = new Date().toISOString();
    let prefix = '';
    switch (level) {
      case 'debug': prefix = picocolors.gray(`[${timestamp}] DEBUG:`); break;
      case 'info': prefix = picocolors.blue(`[${timestamp}] INFO:`); break;
      case 'warn': prefix = picocolors.yellow(`[${timestamp}] WARN:`); break;
      case 'error': prefix = picocolors.red(`[${timestamp}] ERROR:`); break;
    }
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${prefix} ${msg}${metaStr}`;
  }

  debug(msg: string, meta?: any) {
    if (this.level <= LEVEL_MAP.debug) {
      console.debug(this.formatMessage('debug', msg, meta));
    }
  }

  info(msg: string, meta?: any) {
    if (this.level <= LEVEL_MAP.info) {
      console.info(this.formatMessage('info', msg, meta));
    }
  }

  warn(msg: string, meta?: any) {
    if (this.level <= LEVEL_MAP.warn) {
      console.warn(this.formatMessage('warn', msg, meta));
    }
  }

  error(msg: string, meta?: any) {
    if (this.level <= LEVEL_MAP.error) {
      console.error(this.formatMessage('error', msg, meta));
    }
  }
}

export const logger = new Logger();
