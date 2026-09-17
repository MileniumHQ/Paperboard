import * as fs from "fs";
import * as path from "path";
import { getLogsDir } from "./paths";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;

interface LoggerOptions {
    name?: string;
    logDir?: string;
    // file keeps everything
    minLevel?: LogLevel;
    // console stays quiet, warnings and errors only
    consoleLevel?: LogLevel;
    mirrorConsole?: boolean;
}

// leveled logger to a rotating file, warn+ mirrored to console
export class PaperboardLogger {
    private name: string;
    private logDir: string;
    private minLevel: LogLevel;
    private consoleLevel: LogLevel;
    private mirrorConsole: boolean;
    private currentFile: string | null = null;

    constructor(options: LoggerOptions = {}) {
        this.name = options.name || "paperboard";
        this.logDir = options.logDir || getLogsDir();
        this.minLevel = options.minLevel || "debug";
        this.consoleLevel = options.consoleLevel || "warn";
        this.mirrorConsole = options.mirrorConsole ?? true;
    }

    debug(msg: string, ...args: unknown[]): void {
        this.log("debug", msg, ...args);
    }
    info(msg: string, ...args: unknown[]): void {
        this.log("info", msg, ...args);
    }
    warn(msg: string, ...args: unknown[]): void {
        this.log("warn", msg, ...args);
    }
    error(msg: string, ...args: unknown[]): void {
        this.log("error", msg, ...args);
    }

    // formats and writes one entry, never throws
    log(level: LogLevel, msg: string, ...args: unknown[]): void {
        try {
            const time = new Date().toISOString();
            const rest =
                args.length > 0
                    ? " " +
                      args
                          .map((a) => {
                              if (a instanceof Error) return a.stack || a.message;
                              if (typeof a === "object")
                                  try {
                                      return JSON.stringify(a);
                                  } catch {
                                      // direct console: the logger cannot log to itself
                                      console.debug("[logger] arg not stringifiable, using String()");
                                      return String(a);
                                  }
                              return String(a);
                          })
                          .join(" ")
                    : "";
            const line = `${time} [${level.toUpperCase()}]${this.name ? ` [${this.name}]` : ""} ${msg}${rest}\n`;

            if (this.mirrorConsole && LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
                const fn =
                    level === "error"
                        ? console.error
                        : level === "warn"
                          ? console.warn
                          : console.log;
                fn(line.trimEnd());
            }

            if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel]) {
                this.writeLine(line);
            }
        } catch (err) { console.error("[logger] formatting failed:", err); }
    }

    private writeLine(line: string): void {
        const file = this.ensureLogFile();
        if (!file) return;
        try {
            this.rotateIfNeeded();
            fs.appendFileSync(file, line, "utf8");
        } catch (err) { console.error("[logger] append failed:", err); }
    }

    private ensureLogFile(): string | null {
        if (this.currentFile) return this.currentFile;
        try {
            if (!fs.existsSync(this.logDir))
                fs.mkdirSync(this.logDir, { recursive: true });
            this.rotateIfNeeded();
            this.currentFile = path.join(this.logDir, `${this.name}.log`);
            return this.currentFile;
        } catch {
            // direct console: the logger cannot log to itself; a dead log
            // file must be loud, not a quiet null
            console.error(`[logger] log file unavailable in ${this.logDir}, console only`);
            return null;
        }
    }

    private rotateIfNeeded(): void {
        const target = path.join(this.logDir, `${this.name}.log`);
        try {
            const stat = fs.existsSync(target)
                ? fs.statSync(target)
                : null;
            if (stat && stat.size >= MAX_FILE_BYTES) {
                for (let i = MAX_FILES - 1; i >= 1; i--) {
                    const from = path.join(
                        this.logDir,
                        `${this.name}.${i}.log`,
                    );
                    const to = path.join(
                        this.logDir,
                        `${this.name}.${i + 1}.log`,
                    );
                    if (fs.existsSync(from)) fs.renameSync(from, to);
                }
                fs.renameSync(
                    target,
                    path.join(this.logDir, `${this.name}.1.log`),
                );
            }
        } catch (err) { console.error("[logger] rotation failed:", err); }
    }
}

// shared instance used across the app
export const logger = new PaperboardLogger({ name: "paperboard" });

// named child logger
export function getLogger(name: string): PaperboardLogger {
    return new PaperboardLogger({ name });
}
