// The papercrane command line: what each command and flag means, parsed into
// one plain description of what to run. main.ts runs it. Parsing has no side
// effects beyond printing help, the version or a usage error, so tests and
// the desktop app can import this freely.
//
// `serve` is the default command, so every flag the daemon has always taken
// still works without it: `papercrane --headless` is `papercrane serve
// --headless`. --supervise and --panel-service are how the daemon re-invokes
// its own binary; they stay out of the help.
import * as path from "path";
import { Command, CommanderError, Help, InvalidArgumentError, Option } from "commander";
import pkg from "../package.json";

export const CLI_VERSION: string = pkg.version;
export const DEFAULT_LISTEN_PORT = 45464;
export const DEFAULT_SERVICE_NAME = "papercrane";

// what every exit means, for scripts and service managers
export const EXIT = {
    OK: 0,
    // the command ran and failed (it says why on stderr)
    FAILURE: 1,
    // the command line was wrong; nothing ran
    USAGE: 2,
    // `status`: no daemon is running for this data directory
    NOT_RUNNING: 3,
    // interrupted with Ctrl+C
    INTERRUPTED: 130,
} as const;

export interface ServeOptions {
    port?: number;
    host?: string;
    noAuth?: boolean;
    headless?: boolean;
    startPairing?: boolean;
}

export type ServiceScope = "user" | "system";

export interface ServiceTarget {
    scope: ServiceScope;
    name: string;
    dryRun: boolean;
}

export type CliCommand =
    | { kind: "serve"; options: ServeOptions }
    | { kind: "supervise"; procId: string }
    | { kind: "panel-service"; module: string }
    | { kind: "status"; json: boolean }
    | { kind: "pair" }
    | { kind: "install-service"; target: ServiceTarget; serve: { port?: number; host?: string; dataDir?: string }; runAs?: string }
    | { kind: "uninstall-service"; target: ServiceTarget };

// a wrong command line, already printed with its usage
export class CliUsageError extends Error {
    readonly exitCode = EXIT.USAGE;
}

// --help or --version was printed; nothing else runs
export class CliHandledExit extends Error {
    readonly exitCode = EXIT.OK;
}

function parsePort(value: string, source = "--port"): number {
    if (!/^\d{1,5}$/.test(value.trim())) throw new InvalidArgumentError(`${source} must be a whole number from 0 to 65535, not "${value}".`);
    const port = Number(value);
    if (port > 65535) throw new InvalidArgumentError(`${source} must be a whole number from 0 to 65535, not "${value}".`);
    return port;
}

function parseHost(value: string): string {
    const host = value.trim();
    if (!host || /\s/.test(host)) throw new InvalidArgumentError(`--host must be an address such as 0.0.0.0 or 127.0.0.1, not "${value}".`);
    return host;
}

function parseDataDir(value: string): string {
    if (!value.trim()) throw new InvalidArgumentError("--data-dir must name a directory.");
    return path.resolve(value);
}

function parseServiceName(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)) {
        throw new InvalidArgumentError(`--name may only use letters, digits, ".", "_" and "-" (at most 64), not "${value}".`);
    }
    return value;
}

function parseUserName(value: string): string {
    if (!/^[a-z_][a-z0-9_.-]{0,31}\$?$/i.test(value)) throw new InvalidArgumentError(`--run-as must be a user name, not "${value}".`);
    return value;
}

const dataDirOption = () =>
    new Option("--data-dir <path>", "where the daemon keeps its data (sets PAPERBOARD_DIR; default ~/.paperboard)").argParser(parseDataDir);

// the service's own daemon does not see this shell's environment, so only
// serve mentions the variables
function addListenOptions(cmd: Command, { env }: { env: boolean }): Command {
    return cmd
        .addOption(new Option("--port <port>", `port to listen on, 0 for any free port (default ${DEFAULT_LISTEN_PORT}${env ? ", or PAPERCRANE_PORT" : ""})`).argParser((v) => parsePort(v)))
        .addOption(new Option("--host <address>", `address to listen on; 127.0.0.1 keeps it to this computer (default 0.0.0.0${env ? ", or PAPERCRANE_HOST" : ""})`).argParser(parseHost))
        .addOption(dataDirOption());
}

function addServiceTargetOptions(cmd: Command): Command {
    return cmd
        .option("--system", "a system service that starts at boot (needs root); the default is a service for your user")
        .addOption(new Option("--name <name>", "service name, to run more than one daemon").default(DEFAULT_SERVICE_NAME).argParser(parseServiceName))
        .option("--dry-run", "print what would be written and run, and change nothing");
}

function serviceTarget(opts: Record<string, unknown>): ServiceTarget {
    return { scope: opts.system ? "system" : "user", name: String(opts.name), dryRun: opts.dryRun === true };
}

// --data-dir is the same as PAPERBOARD_DIR, and children (supervisors, panel
// services) must see the same directory, so it is applied to the environment
function applyDataDir(opts: Record<string, unknown>, env: NodeJS.ProcessEnv): void {
    if (typeof opts.dataDir === "string") env.PAPERBOARD_DIR = opts.dataDir;
}

function serveOptions(opts: Record<string, unknown>, env: NodeJS.ProcessEnv): ServeOptions {
    if (opts.headless && opts.startPairing) {
        throw new InvalidArgumentError("--start-pairing shows a code on the interactive screen, which --headless turns off. Run `papercrane pair` while the daemon is running instead.");
    }
    const options: ServeOptions = {};
    // commander spells --no-auth as auth === false
    if (opts.auth === false) options.noAuth = true;
    if (opts.headless) options.headless = true;
    if (opts.startPairing) options.startPairing = true;
    if (typeof opts.port === "number") options.port = opts.port;
    else if (env.PAPERCRANE_PORT !== undefined) options.port = parsePort(env.PAPERCRANE_PORT, "PAPERCRANE_PORT");
    if (typeof opts.host === "string") options.host = opts.host;
    else if (env.PAPERCRANE_HOST !== undefined) {
        try { options.host = parseHost(env.PAPERCRANE_HOST); }
        catch { throw new InvalidArgumentError(`PAPERCRANE_HOST must be an address such as 0.0.0.0 or 127.0.0.1, not "${env.PAPERCRANE_HOST}".`); }
    }
    return options;
}

// serve's options laid out the way commander lays out its own
function optionTable(cmd: Command): string {
    const help = new Help();
    help.prepareContext({ helpWidth: process.stdout.columns || 80 });
    const options = help.visibleOptions(cmd).filter((o) => o.long !== "--help");
    const width = Math.max(...options.map((o) => help.optionTerm(o).length));
    return options.map((o) => help.formatItem(help.optionTerm(o), width, help.optionDescription(o), help)).join("\n");
}

const ENVIRONMENT_HELP = `
Environment:
  PAPERBOARD_DIR   data directory (same as --data-dir)
  PAPERCRANE_PORT  port to listen on when --port is not given
  PAPERCRANE_HOST  address to listen on when --host is not given`;

const EXIT_HELP = `
Exit codes:
  0  success
  1  the command failed (the reason is printed)
  2  the command line was wrong
  3  status: no daemon is running`;

// a command-line mistake found inside an action: printed like commander's
// own errors (message, then the command's usage), then thrown to parseCli
function guarded<A extends unknown[]>(body: (...args: A) => void): (...args: A) => void {
    return function (this: Command, ...args: A) {
        try {
            body(...args);
        } catch (err) {
            if (err instanceof InvalidArgumentError) this.error(`error: ${err.message}`, { exitCode: EXIT.USAGE, code: "papercrane.usage" });
            throw err;
        }
    };
}

// Builds the program. `run` receives the parsed command; nothing in here
// starts a server or touches the disk.
function buildProgram(env: NodeJS.ProcessEnv, run: (command: CliCommand) => void): Command {
    const program = new Command("papercrane")
        .description("The Paperboard server daemon. It runs panels, game servers and everything else Paperboard does on this computer, and lets Paperboard on another computer use it once paired.")
        .usage("[command] [options]")
        .version(CLI_VERSION, "-v, --version", "print the version")
        .helpOption("-h, --help", "show help")
        .helpCommand("help [command]", "show help for a command")
        .exitOverride()
        .configureOutput({
            writeErr: (text) => process.stderr.write(text),
            writeOut: (text) => process.stdout.write(text),
        });

    const serve = addListenOptions(
        program
            .command("serve", { isDefault: true })
            .summary("start the daemon (the default command)")
            .description("Start the Paperboard server daemon. In a terminal it shows an interactive screen for pairing; --headless runs it as a service, logging to stdout.")
            // a stray word is reported as an unknown command, below
            .allowExcessArguments(),
        { env: true },
    )
        .option("--headless", "no interactive screen, just log lines on stdout (use this under a service manager)")
        .option("--start-pairing", "show a pairing code as soon as the interactive screen opens (otherwise press p)")
        .option("--no-auth", "turn off authentication, for development on a trusted single-user computer (127.0.0.1 only)")
        .addOption(new Option("--allow-registry-override", "honor ORIGAMI_REGISTRY_URL in a production build").hideHelp())
        .addOption(new Option("--supervise <procId>").hideHelp())
        .addOption(new Option("--panel-service <module>").hideHelp())
        .action(guarded((opts: Record<string, unknown>, cmd: Command) => {
            if (cmd.args.length > 0) {
                throw new InvalidArgumentError(`unknown command '${cmd.args[0]}'.`);
            }
            applyDataDir(opts, env);
            if (typeof opts.supervise === "string") return run({ kind: "supervise", procId: opts.supervise });
            if (typeof opts.panelService === "string") return run({ kind: "panel-service", module: opts.panelService });
            run({ kind: "serve", options: serveOptions(opts, env) });
        }));
    serve.addHelpText("after", `
Examples:
  papercrane                              start with the interactive screen
  papercrane --start-pairing              start and show a pairing code right away
  papercrane --headless --port 45465      run as a service on another port
  papercrane --host 127.0.0.1             only accept this computer
${ENVIRONMENT_HELP}`);

    program
        .command("pair")
        .summary("show a pairing code on the running daemon")
        .description("Open pairing on the daemon running on this computer and print the code. Enter it in Paperboard on the computer you are pairing. Waits until that computer pairs; Ctrl+C cancels.")
        .addOption(dataDirOption())
        .action((opts: Record<string, unknown>) => {
            applyDataDir(opts, env);
            run({ kind: "pair" });
        });

    program
        .command("status")
        .summary("show whether the daemon is running")
        .description("Show whether a daemon is running for the data directory, with its version, address and paired computers. Exits 3 when none is running.")
        .addOption(dataDirOption())
        .option("--json", "print the status as JSON")
        .action((opts: Record<string, unknown>) => {
            applyDataDir(opts, env);
            run({ kind: "status", json: opts.json === true });
        });

    const install = addServiceTargetOptions(addListenOptions(
        program
            .command("install-service")
            .summary("run the daemon in the background, starting with the computer")
            .description("Install the daemon as a service (systemd on Linux, launchd on macOS), enable it and start it. It runs with --headless, and stopping or restarting it leaves game servers and other workloads running for the next daemon to adopt. Running it again updates the service."),
        { env: false },
    ))
        .addOption(new Option("--run-as <user>", "with --system: the account the daemon runs as (default: the user who ran sudo)").argParser(parseUserName))
        .action(guarded((opts: Record<string, unknown>) => {
            if (opts.runAs !== undefined && !opts.system) throw new InvalidArgumentError("--run-as only applies to --system services.");
            run({
                kind: "install-service",
                target: serviceTarget(opts),
                serve: {
                    ...(typeof opts.port === "number" ? { port: opts.port } : {}),
                    ...(typeof opts.host === "string" ? { host: opts.host } : {}),
                    ...(typeof opts.dataDir === "string" ? { dataDir: opts.dataDir } : {}),
                },
                ...(typeof opts.runAs === "string" ? { runAs: opts.runAs } : {}),
            });
        }));
    install.addHelpText("after", `
Examples:
  papercrane install-service                      for your user
  sudo papercrane install-service --system        at boot, as the user running sudo
  papercrane install-service --port 45465 --name papercrane-test --data-dir ~/pb-test`);

    addServiceTargetOptions(
        program
            .command("uninstall-service")
            .summary("stop and remove the service (your data stays)")
            .description("Stop the daemon's service and remove it. Your data directory stays as it is, and running game servers keep running until you start the daemon again."),
    ).action((opts: Record<string, unknown>) => {
        run({ kind: "uninstall-service", target: serviceTarget(opts) });
    });

    // the root help lists what `papercrane` alone accepts: serve's options
    program.addHelpText("after", `
Options for serve (also accepted without "serve"):
${optionTable(serve)}

Examples:
  papercrane                              start with the interactive screen
  papercrane install-service              run it in the background for your user
  papercrane pair                         pair Paperboard on another computer
  papercrane status                       check that it is running
${ENVIRONMENT_HELP}
${EXIT_HELP}

Run "papercrane <command> --help" for a command's options.`);

    // a wrong command line prints its error, then the usage of the command
    // it was for
    const withUsage = (cmd: Command) => {
        const prefix = cmd === program ? "papercrane" : `papercrane ${cmd.name()}`;
        cmd.showHelpAfterError(`Usage: ${prefix} ${cmd.usage()}\nRun "${prefix} --help" for details.`);
        for (const sub of cmd.commands) withUsage(sub);
    };
    withUsage(program);
    // serve is the default, so its usage reads as the program's
    serve.showHelpAfterError(`Usage: papercrane [serve] ${serve.usage()}\nRun "papercrane --help" for details.`);
    return program;
}

// Parse a full argv (argv[0] the runtime, argv[1] the script, as
// process.argv). Throws CliUsageError (already printed) on a wrong command
// line, CliHandledExit after --help or --version.
export function parseCli(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): CliCommand {
    let parsed: CliCommand | null = null;
    const program = buildProgram(env, (command) => { parsed = command; });
    try {
        program.parse(argv, { from: "node" });
    } catch (err) {
        if (err instanceof CommanderError) {
            if (err.exitCode === 0) throw new CliHandledExit(err.message);
            throw new CliUsageError(err.message);
        }
        throw err;
    }
    if (!parsed) throw new Error("papercrane: the command line parsed to nothing");
    return parsed;
}

// the daemon's own flags, for callers that only start a server (tests, the
// historical API): anything other than a serve command line is an error
export function parseCliArgs(argv: string[] = process.argv): ServeOptions & { supervise?: string; panelService?: string } {
    const command = parseCli(argv);
    switch (command.kind) {
        case "serve": return command.options;
        case "supervise": return { supervise: command.procId };
        case "panel-service": return { panelService: command.module };
        default: throw new Error(`parseCliArgs only parses serve options, not the ${command.kind} command`);
    }
}
