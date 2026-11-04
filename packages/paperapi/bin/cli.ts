#!/usr/bin/env node
// `paperapi`: the panel developer's command line. Every command honours
// PAPERBOARD_DIR, prints results to stdout and progress to stderr, and exits
// 0 when done, 1 when something is wrong, 2 when the command line is.
import { Command, CommanderError } from "commander";
import { packPanel } from "../src/pack";
import { linkPanel, unlinkPanel, listLinkedPanels } from "../src/link";
import { requirePanelId } from "../src/panelIdentity";
import { runMonitor } from "../src/cli/monitor";
import { runDoctor } from "../src/cli/doctor";
import { runCall, runRestart } from "../src/cli/call";
import { panelsDir } from "../src/cli/paths";
import { CliError, EXIT_OK, EXIT_USAGE, Output, shownPath, usageError } from "../src/cli/output";
import packageJson from "../package.json";

const output = new Output();

// a reader that stops early (`paperapi doctor | head`) closes stdout: the
// rest of the result has nowhere to go, and that is the reader's choice,
// not a crash. The command still finishes and exits with its own code.
// Any other stdout failure stays loud.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") throw err;
    output.readerClosed();
});

// every command body runs through here: one place turns a failure into its
// message, its fix and its exit code
function command<A extends unknown[]>(body: (...args: A) => number | Promise<number>): (...args: A) => Promise<void> {
    return async (...args: A) => {
        try {
            process.exitCode = await body(...args);
        } catch (err) {
            process.exitCode = output.failure(err);
        }
    };
}

function panelIdArg(value: string): string {
    try {
        return requirePanelId(value);
    } catch (err) {
        throw usageError((err as Error).message);
    }
}

// resolves on the first Ctrl+C or SIGTERM, so a streaming command can stop cleanly
function interrupted(): Promise<void> {
    return new Promise((resolve) => {
        const stop = () => {
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
            resolve();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
    });
}

const program = new Command();
program
    .name("paperapi")
    .description("Build, run and watch Paperboard panels. Docs: https://paperboard.dev/docs/guides/")
    .version(packageJson.version)
    .showHelpAfterError()
    .exitOverride((err: CommanderError) => {
        // help and --version are done; anything else commander refuses is usage
        process.exit(err.exitCode === 0 ? EXIT_OK : EXIT_USAGE);
    })
    .addHelpText("after", "\nEvery command works on the Paperboard data folder in PAPERBOARD_DIR (default ~/.paperboard).");

program
    .command("link [panel-dir]")
    .alias("dev-link")
    .description("Link a panel folder into Paperboard, so it runs from your working copy")
    .option("-f, --force", "replace an installed copy of the panel (its data stays)")
    .action(command((panelDir: string | undefined, opts: { force?: boolean }) => {
        let res: ReturnType<typeof linkPanel>;
        try {
            res = linkPanel({ targetDir: panelDir ?? process.cwd(), force: opts.force });
        } catch (err) {
            const message = (err as Error).message;
            throw new CliError(message, /--force/.test(message) ? undefined : "Run paperapi doctor in the panel folder to see what is wrong.");
        }
        output.success(`Linked ${output.err.bold(res.name)} (${res.id})`);
        output.line(`${res.linkPath} → ${shownPath(res.sourcePath)}`);
        output.note(output.err.dim(res.hasService
            ? "Paperboard serves its pages from this folder now. After a build, run paperapi restart to run the new service."
            : "Paperboard serves its pages from this folder now."));
        return EXIT_OK;
    }));

program
    .command("unlink <panel-id>")
    .description("Remove a panel's development link (never an installed panel)")
    .action(command((panelId: string) => {
        const id = panelIdArg(panelId);
        let removed: boolean;
        try {
            removed = unlinkPanel(id);
        } catch (err) {
            throw new CliError((err as Error).message, "Uninstall an installed panel from Paperboard instead.");
        }
        if (!removed) throw new CliError(`${id} has no development link in ${panelsDir()}`, "paperapi links lists the ones there are.");
        output.success(`Unlinked ${id}`);
        return EXIT_OK;
    }));

program
    .command("links")
    .alias("list-links")
    .description("List development links, and the ones whose folder is gone")
    .option("--json", "print the links as JSON")
    .action(command((opts: { json?: boolean }) => {
        const links = listLinkedPanels();
        if (opts.json) {
            output.line(JSON.stringify(links, null, 2));
            return EXIT_OK;
        }
        if (links.length === 0) {
            output.note(`No development links in ${panelsDir()}.`);
            return EXIT_OK;
        }
        output.note(output.err.dim(`${links.length} development ${links.length === 1 ? "link" : "links"} in ${panelsDir()}:`));
        const width = Math.max(...links.map((l) => l.id.length));
        for (const l of links) {
            const broken = l.isBroken ? `  ${output.out.red("✗ folder is gone")}` : "";
            output.line(`${output.out.bold(l.id.padEnd(width))}  → ${l.targetPath}${broken}`);
        }
        return EXIT_OK;
    }));

program
    .command("doctor [panel-dir]")
    .description("Check that Paperboard can run a panel folder, and say how to fix what stops it")
    .option("--json", "print the checks as JSON")
    .action(command((panelDir: string | undefined, opts: { json?: boolean }) => runDoctor(panelDir, opts, output)));

program
    .command("monitor")
    .description("Watch PaperAPI calls, events, services and processes on this computer, live")
    .option("-p, --panel <panel-id>", "only what involves this panel")
    .option("--json", "print one JSON record per line")
    .action(command((opts: { panel?: string; json?: boolean }) => {
        const panel = opts.panel === undefined ? undefined : panelIdArg(opts.panel);
        return runMonitor({ panel, json: opts.json }, output, interrupted());
    }));

program
    .command("call <panel-id> [action] [inputs]")
    .description("Call a panel's action and print its result as JSON; with no action, list its actions")
    .option("-t, --timeout <ms>", "how long to wait, up to 60000, or \"none\" (default 30000)")
    .action(command((panelId: string, action: string | undefined, inputs: string | undefined, opts: { timeout?: string }) =>
        runCall(panelId, action, inputs, opts, output)));

program
    .command("restart [panel]")
    .description("Restart a panel's service so it runs the latest build (a panel folder or id; default: here)")
    .action(command((panel: string | undefined) => runRestart(panel, output)));

program
    .command("pack [panel-dir]")
    .description("Build if needed, then package a panel into out/<id>-<version>.tar.gz")
    .option("-o, --out <dir>", "where the archive goes (default: out/ in the panel folder)")
    .option("--json", "print the release metadata as JSON")
    .action(command((panelDir: string | undefined, opts: { out?: string; json?: boolean }) => {
        let result: ReturnType<typeof packPanel>;
        try {
            result = packPanel({ targetDir: panelDir ?? process.cwd(), outputDir: opts.out, log: (line) => output.note(output.err.dim(line)) });
        } catch (err) {
            throw new CliError((err as Error).message);
        }
        if (opts.json) {
            output.line(JSON.stringify(result, null, 2));
            return EXIT_OK;
        }
        output.success(`Packed ${output.err.bold(result.id)} ${result.version} ${output.err.dim(`· ${(result.sizeBytes / 1024).toFixed(1)} KB`)}`);
        output.line(shownPath(result.archivePath));
        output.line(`sha256 ${result.sha256}`);
        return EXIT_OK;
    }));

program.parseAsync(process.argv).catch((err) => {
    process.exitCode = output.failure(err);
});
