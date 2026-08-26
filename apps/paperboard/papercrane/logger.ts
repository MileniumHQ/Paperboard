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
    minLevel?: LogLevel;
    mirrorConsole?: boolean;
}

// Leveled logger writing to a rotating file under <baseDir>/logs and
// mirroring to the console. Safe no-op when the filesystem is unavailable.
export class PaperboardLogger {
    private name: string;
    private logDir: string;
    private minLevel: LogLevel;
    private mirrorConsole: boolean;
    private currentFile: string | null = null;

    constructor(options: LoggerOptions = {}) {
        this.name = options.name || "paperboard";
        this.logDir = options.logDir || getLogsDir();
        this.minLevel =
            options.minLevel ||
            (process.env.PAPERBOARD_LOG_LEVEL as LogLevel) ||
            "info";
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

    // Formats and writes one entry; never throws into caller code.
    log(level: LogLevel, msg: string, ...args: unknown[]): void {
        try {
            if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

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
                                      return String(a);
                              }
                              return String(a);
                          })
                          .join(" ")
                    : "";
            const line = `${time} [${level.toUpperCase()}]${this.name ? ` [${this.name}]` : ""} ${msg}${rest}\n`;

            if (this.mirrorConsole) {
                const fn =
                    level === "error"
                        ? console.error
                        : level === "warn"
                          ? console.warn
                          : console.log;
                fn(line.trimEnd());
            }

            this.writeLine(line);
        } catch {}
    }

    private writeLine(line: string): void {
        const file = this.ensureLogFile();
        if (!file) return;
        try {
            fs.appendFileSync(file, line, "utf8");
        } catch {}
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
        } catch {}
    }
}

// Default shared instance used across the app.
export const logger = new PaperboardLogger({ name: "paperboard" });

// Named child logger, e.g. getLogger("papercrane").
export function getLogger(name: string): PaperboardLogger {
    return new PaperboardLogger({ name });
}
