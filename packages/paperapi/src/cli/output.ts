// One look and one set of exit codes for every `paperapi` command.
//
// Results go to stdout, so they pipe; what the command is doing, and why it
// failed, goes to stderr. Exit codes:
//   0  done
//   1  failed: the command ran and something is wrong (a check failed, the
//      action threw, Paperboard is not running)
//   2  usage: the command line itself is wrong

import path from "path";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/** A failure the CLI reports as it is: the message, then how to fix it. */
export class CliError extends Error {
    constructor(
        message: string,
        public readonly hint?: string,
        public readonly exitCode: number = EXIT_FAILED,
    ) {
        super(message);
        this.name = "CliError";
    }
}

export function usageError(message: string, hint?: string): CliError {
    return new CliError(message, hint, EXIT_USAGE);
}

interface Stream {
    isTTY?: boolean;
    write(chunk: string): unknown;
}

// NO_COLOR (https://no-color.org) wins, FORCE_COLOR asks for colour off a
// terminal, otherwise colour only where a person is reading
export function colorEnabled(stream: Stream, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
    if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
    return stream.isTTY === true;
}

const CODES = {
    bold: [1, 22],
    dim: [2, 22],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
} as const;

export type Paint = Record<keyof typeof CODES, (text: string) => string>;

export function painter(enabled: boolean): Paint {
    const paint: Partial<Paint> = {};
    for (const [name, [on, off]] of Object.entries(CODES)) {
        paint[name as keyof Paint] = enabled ? (text: string) => `\x1b[${on}m${text}\x1b[${off}m` : (text: string) => text;
    }
    return paint as Paint;
}

/** stdout and stderr, each with its own colour decision. */
export class Output {
    readonly out: Paint;
    readonly err: Paint;

    constructor(
        private stdout: Stream = process.stdout,
        private stderr: Stream = process.stderr,
        env: NodeJS.ProcessEnv = process.env,
    ) {
        this.out = painter(colorEnabled(stdout, env));
        this.err = painter(colorEnabled(stderr, env));
    }

    /** a result line, on stdout */
    line(text = ""): void {
        this.stdout.write(`${text}\n`);
    }

    /** a progress or status line, on stderr */
    note(text: string): void {
        this.stderr.write(`${text}\n`);
    }

    success(text: string): void {
        this.stderr.write(`${this.err.green("✓")} ${text}\n`);
    }

    failure(error: unknown): number {
        if (error instanceof CliError) {
            this.stderr.write(`${this.err.red("✗")} ${error.message}\n`);
            if (error.hint) this.stderr.write(`  ${this.err.dim(error.hint)}\n`);
            return error.exitCode;
        }
        this.stderr.write(`${this.err.red("✗")} ${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_FAILED;
    }
}

/** A path as a person reads it: relative to where they are when that is shorter. */
export function shownPath(target: string, cwd = process.cwd()): string {
    const rel = path.relative(cwd, target);
    if (rel === "") return ".";
    if (rel.startsWith("..") || path.isAbsolute(rel)) return target;
    return rel;
}
