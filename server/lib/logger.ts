/**
 * Structured Logger
 * 
 * Lightweight structured logging with levels, timestamps, and correlation IDs.
 * Outputs JSON in production for log aggregation (CloudWatch, Datadog, etc).
 * Outputs human-readable format in development.
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.FATAL]: 'FATAL',
};

const currentLevel: LogLevel = (() => {
    const env = process.env.LOG_LEVEL?.toUpperCase();
    switch (env) {
        case 'DEBUG': return LogLevel.DEBUG;
        case 'INFO': return LogLevel.INFO;
        case 'WARN': return LogLevel.WARN;
        case 'ERROR': return LogLevel.ERROR;
        case 'FATAL': return LogLevel.FATAL;
        default: return process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
})();

const isProduction = process.env.NODE_ENV === 'production';

interface LogEntry {
    level: string;
    message: string;
    timestamp: string;
    [key: string]: any;
}

function formatLog(level: LogLevel, message: string, meta?: Record<string, any>): void {
    if (level < currentLevel) return;

    const entry: LogEntry = {
        level: LOG_LEVEL_NAMES[level],
        message,
        timestamp: new Date().toISOString(),
        ...meta,
    };

    if (isProduction) {
        // JSON format for log aggregators
        const output = JSON.stringify(entry);
        if (level >= LogLevel.ERROR) {
            console.error(output);
        } else {
            console.log(output);
        }
    } else {
        // Human-readable format for development
        const prefix = `[${entry.timestamp.slice(11, 19)}] [${entry.level}]`;
        const metaStr = meta && Object.keys(meta).length > 0
            ? ` ${JSON.stringify(meta)}`
            : '';
        if (level >= LogLevel.ERROR) {
            console.error(`${prefix} ${message}${metaStr}`);
        } else {
            console.log(`${prefix} ${message}${metaStr}`);
        }
    }
}

export const logger = {
    debug: (message: string, meta?: Record<string, any>) => formatLog(LogLevel.DEBUG, message, meta),
    info: (message: string, meta?: Record<string, any>) => formatLog(LogLevel.INFO, message, meta),
    warn: (message: string, meta?: Record<string, any>) => formatLog(LogLevel.WARN, message, meta),
    error: (message: string, meta?: Record<string, any>) => formatLog(LogLevel.ERROR, message, meta),
    fatal: (message: string, meta?: Record<string, any>) => formatLog(LogLevel.FATAL, message, meta),
};

export default logger;
