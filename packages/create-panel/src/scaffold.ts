// Scaffolds a new Paperboard panel from ../template, copying every
// first-party convention: manifest shape (0.x version, no icon until you add
// branding/), PaperProvider and PaperPanel bootstrap, an explicit PANEL_ID in
// the UI, service and widget, bridge-mirrored service state with loading and
// failure states, hermetic tests, a UI standards guard and one tested
// pure-logic unit.
//
// Three choices shape the panel: a background service, a Home widget (which
// mirrors the service, so it needs one) and a store listing starter. The
// template is the panel with all three; a deselected one removes its files,
// its manifest entries and the blocks fenced by `@if <feature>` and `@endif`
// marker comments.
//
// Two modes share this one implementation:
//   workspace  - `bun scripts/create-panel.ts` inside the Paperboard repo:
//                writes panels/<id>/, depends on the libraries via workspace:*
//   standalone - `npm create @mileniumhq/panel`: writes ./<id>/ in the
//                caller's directory, depends on the published libraries
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";
import { parseArgs } from "util";
import { isPanelId, requirePanelId } from "../../paperapi/src/panelIdentity";
import paperapiPackage from "../../paperapi/package.json";
import paperuiPackage from "../../paperui/package.json";

// resolves from both src/scaffold.ts (source) and dist/cli.js (bundle)
export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "template");

const TOKENS = ["__PANEL_ID__", "__PANEL_NAME__", "__PANEL_DESC__", "__PAPERAPI_DEP__", "__PAPERUI_DEP__"];

export type ScaffoldMode = "workspace" | "standalone";

/** The choices that shape a panel; each defaults to on, as in first-party panels. */
export interface PanelFeatures {
    /** a background service: state, actions other panels can call, work with no window open */
    service: boolean;
    /** a Home widget mirroring the service's state; needs the service */
    widget: boolean;
    /** store/about.md and the manifest entry for the panel library page */
    store: boolean;
}

export const DEFAULT_FEATURES: PanelFeatures = { service: true, widget: true, store: true };

// what a deselected feature removes from the template, relative to the panel
const FEATURE_FILES: Record<keyof PanelFeatures, string[]> = {
    service: ["src/service.ts", "src/lib/greet.ts", "src/pages/ServicePage.tsx", "test/greet.test.ts"],
    widget: ["widget.html", "src/widget.tsx", "src/widget.css"],
    store: ["store/about.md"],
};

export interface ScaffoldOptions {
    mode: ScaffoldMode;
    id: string;
    displayName?: string;
    description?: string;
    /** Who the panel's library page credits. Standalone only: first-party panels are Paperboard's. */
    publisher?: string;
    features?: Partial<PanelFeatures>;
    /** Directory the panel folder is created in. */
    parentDir: string;
    templateDir?: string;
}

export interface ScaffoldResult {
    targetDir: string;
    files: string[];
}

export function defaultDisplayName(id: string): string {
    const last = id.split(".").pop() ?? id;
    return last
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

// the published libraries the standalone panel installs; baked in at build
// from the library manifests so they cannot drift from what ships
export function libraryDependencies(mode: ScaffoldMode): { paperapi: string; paperui: string } {
    if (mode === "workspace") return { paperapi: "workspace:*", paperui: "workspace:*" };
    return { paperapi: `^${paperapiPackage.version}`, paperui: `^${paperuiPackage.version}` };
}

// a token's value as the file it lands in needs it: a description with a
// quote must not break manifest.json, nor a name with a "<" the page's title
function escapeFor(file: string, value: string): string {
    if (file.endsWith(".json")) return JSON.stringify(value).slice(1, -1);
    if (file.endsWith(".html")) return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return value;
}

const MARKER = /^\s*(?:\/\/|\{\/\*|<!--)\s*@(if|endif)(?:\s+(\w+))?\s*(?:\*\/\}|-->)?\s*$/;

/**
 * Drops the blocks of deselected features, and every marker line. Blocks do
 * not nest; a marker that is unbalanced or names an unknown feature throws,
 * so a template typo cannot ship half a panel.
 */
export function applyFeatureMarkers(content: string, features: PanelFeatures, file = "template"): string {
    const out: string[] = [];
    let open: keyof PanelFeatures | null = null;
    let skipping = false;
    for (const [index, line] of content.split("\n").entries()) {
        const marker = MARKER.exec(line);
        if (!marker) {
            if (!skipping) out.push(line);
            continue;
        }
        const where = `${file}:${index + 1}`;
        if (marker[1] === "if") {
            const name = marker[2];
            if (open) throw new Error(`${where}: @if inside another @if (blocks do not nest)`);
            if (!name || !(name in features)) throw new Error(`${where}: @if names unknown feature "${name ?? ""}"`);
            open = name as keyof PanelFeatures;
            skipping = !features[open];
        } else {
            if (!open) throw new Error(`${where}: @endif without @if`);
            open = null;
            skipping = false;
        }
    }
    if (open) throw new Error(`${file}: @if ${open} is never closed`);
    return out.join("\n");
}

function copyTemplate(
    srcDir: string,
    destDir: string,
    replacements: Record<string, string>,
    features: PanelFeatures,
    root = srcDir,
): string[] {
    const written: string[] = [];
    for (const entry of readdirSync(srcDir)) {
        const src = join(srcDir, entry);
        const dest = join(destDir, entry);
        if (statSync(src).isDirectory()) {
            mkdirSync(dest, { recursive: true });
            written.push(...copyTemplate(src, dest, replacements, features, root));
            continue;
        }
        let content = applyFeatureMarkers(readFileSync(src, "utf8"), features, relative(root, src));
        for (const [token, value] of Object.entries(replacements)) {
            content = content.split(token).join(escapeFor(entry, value));
        }
        writeFileSync(dest, content);
        written.push(dest);
    }
    return written;
}

function rewriteJson(file: string, edit: (value: any) => void): void {
    const value = JSON.parse(readFileSync(file, "utf8"));
    edit(value);
    writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`);
}

export function scaffoldPanel(options: ScaffoldOptions): ScaffoldResult {
    const id = requirePanelId(options.id);
    const displayName = options.displayName?.trim() || defaultDisplayName(id);
    const description = options.description?.trim() || `${displayName} panel`;
    const publisher = options.publisher?.trim() ?? "";
    const features: PanelFeatures = { ...DEFAULT_FEATURES, ...options.features };
    const templateDir = options.templateDir ?? TEMPLATE_DIR;
    const targetDir = resolve(options.parentDir, id);

    if (features.widget && !features.service) {
        throw new Error("a widget mirrors the service's state, so it needs a service: choose both or neither");
    }
    if (publisher && options.mode === "workspace") {
        throw new Error("panels in the Paperboard repo are published by Paperboard: omit the publisher");
    }
    if (existsSync(targetDir)) {
        throw new Error(`"${targetDir}" already exists. Pick another id or remove it first`);
    }
    if (!existsSync(templateDir)) {
        throw new Error(`template dir missing: ${templateDir}`);
    }

    // the folder is ours from here: a scaffold that throws leaves nothing behind
    mkdirSync(targetDir, { recursive: true });
    try {
        return writePanel(options.mode, targetDir, templateDir, { id, displayName, description, publisher }, features);
    } catch (err) {
        rmSync(targetDir, { recursive: true, force: true });
        throw err;
    }
}

function writePanel(
    mode: ScaffoldMode,
    targetDir: string,
    templateDir: string,
    panel: { id: string; displayName: string; description: string; publisher: string },
    features: PanelFeatures,
): ScaffoldResult {
    const deps = libraryDependencies(mode);
    const files = copyTemplate(
        templateDir,
        targetDir,
        {
            __PANEL_ID__: panel.id,
            __PANEL_NAME__: panel.displayName,
            __PANEL_DESC__: panel.description,
            __PAPERAPI_DEP__: deps.paperapi,
            __PAPERUI_DEP__: deps.paperui,
        },
        features,
    );

    // npm strips .gitignore from published packages, so the template ships
    // it as `gitignore`. Inside the repo the root .gitignore already applies.
    const gitignore = join(targetDir, "gitignore");
    if (mode === "standalone") {
        writeFileSync(join(targetDir, ".gitignore"), readFileSync(gitignore));
        files.push(join(targetDir, ".gitignore"));
    }
    rmFile(gitignore, files);

    for (const feature of Object.keys(features) as Array<keyof PanelFeatures>) {
        if (features[feature]) continue;
        for (const file of FEATURE_FILES[feature]) rmFile(join(targetDir, file), files);
    }
    // a feature's folder goes with its last file
    const store = join(targetDir, "store");
    if (existsSync(store) && readdirSync(store).length === 0) rmSync(store, { recursive: true });

    rewriteJson(join(targetDir, "manifest.json"), (manifest) => {
        if (!features.service) delete manifest.service;
        if (!features.widget) delete manifest.widgets;
        if (!features.store) delete manifest.store;
        // the template's publisher is Paperboard's; a panel made outside the
        // repo belongs to whoever made it
        if (mode === "standalone") {
            if (panel.publisher) manifest.publisher = panel.publisher;
            else delete manifest.publisher;
        }
    });
    rewriteJson(join(targetDir, "package.json"), (pkg) => {
        if (!features.service) pkg.scripts.build = "tsc && vite build";
        if (mode === "standalone") pkg.license = "UNLICENSED";
    });
    if (mode === "standalone") rmFile(join(targetDir, "LICENSE"), files);

    // fail loudly if a token survived (a new template file forgot a replacement)
    const leftovers = files.filter((file) => {
        const content = readFileSync(file, "utf8");
        return TOKENS.some((token) => content.includes(token));
    });
    if (leftovers.length > 0) {
        throw new Error(`unreplaced template tokens in:\n  ${leftovers.join("\n  ")}`);
    }

    return { targetDir, files };
}

function rmFile(file: string, files: string[]): void {
    rmSync(file);
    files.splice(files.indexOf(file), 1);
}

export interface CliOptions {
    mode: ScaffoldMode;
    parentDir: string;
    /** How the user invoked us, for usage text. */
    command: string;
    argv: string[];
    /** Answers a prompt; defaults to the terminal. Prompts are only used when no panel id is given. */
    ask?: (question: string) => Promise<string>;
    /** Where output goes; defaults to the console. */
    log?: (line: string) => void;
}

const FLAGS = {
    help: { type: "boolean", short: "h" },
    description: { type: "string" },
    publisher: { type: "string" },
    "no-service": { type: "boolean" },
    "no-widget": { type: "boolean" },
    "no-store": { type: "boolean" },
} as const;

function usage(cli: CliOptions): string[] {
    const standalone = cli.mode === "standalone";
    return [
        `Usage: ${cli.command} [panel-id] [Display Name] [options]`,
        `Example: ${cli.command} dev.paperboard.my-panel "My Panel"`,
        "",
        "Run with no panel id to be asked about each choice. With one, the panel is",
        "made at once from the options below, and anything you leave out is included.",
        "",
        "Options:",
        '  --description <text>   one line shown on the panel\'s library page',
        ...(standalone ? ["  --publisher <name>     who the library page credits"] : []),
        "  --no-service           no background service (a UI-only panel; also drops the widget)",
        "  --no-widget            no Home widget",
        "  --no-store             no store listing starter",
        "  -h, --help             show this",
        "",
        "Exits 0 when the panel is made, 1 when it cannot be, 2 for a command line it cannot read.",
        "Docs: https://paperboard.dev/docs/developers/",
    ];
}

function terminalAsk(rl: readline.Interface): (question: string) => Promise<string> {
    return (question) =>
        new Promise((resolvePrompt) => {
            rl.question(question, (answer) => resolvePrompt(answer.trim()));
        });
}

async function askYesNo(ask: (question: string) => Promise<string>, question: string, fallback: boolean): Promise<boolean> {
    for (;;) {
        const answer = (await ask(`${question} [${fallback ? "Y/n" : "y/N"}]: `)).toLowerCase();
        if (answer === "") return fallback;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        console.error("  Answer y or n.");
    }
}

interface Choices {
    id: string;
    displayName: string;
    description: string;
    publisher: string;
    features: PanelFeatures;
}

// the choices that matter, one at a time, each saying what it adds
async function promptChoices(
    cli: CliOptions,
    ask: (question: string) => Promise<string>,
    log: (line: string) => void,
    preset: { displayName: string; description: string; publisher: string },
): Promise<Choices> {
    let id = "";
    // loop until the id validates AND the target is free
    for (;;) {
        const answer = await ask("Panel id (e.g. dev.paperboard.my-panel): ");
        if (!isPanelId(answer)) {
            try {
                requirePanelId(answer);
            } catch (err) {
                console.error(`  ${(err as Error).message}`);
            }
            continue;
        }
        if (existsSync(resolve(cli.parentDir, answer))) {
            console.error(`  ${answer}/ already exists. Pick another id`);
            continue;
        }
        id = answer;
        break;
    }
    const fallbackName = defaultDisplayName(id);
    const displayName = preset.displayName || (await ask(`Display name [${fallbackName}]: `)) || fallbackName;
    const description = preset.description || (await ask(`Description [${displayName} panel]: `)) || `${displayName} panel`;
    let publisher = preset.publisher;
    if (cli.mode === "standalone" && !publisher) {
        publisher = await ask("Publisher, credited on the library page (leave empty to set it later): ");
    }

    log("");
    log("A background service keeps the panel's state and runs its work whether or not a window is open.");
    log("Other panels and the Actions panel call what it offers. Without one, the panel is only UI.");
    const service = await askYesNo(ask, "Include a background service?", true);
    let widget = false;
    if (service) {
        log("");
        log("A widget puts a small live tile from your panel on Paperboard's Home page.");
        widget = await askYesNo(ask, "Include a Home widget?", true);
    }
    log("");
    log("A store listing is the long description on the panel's page in the panel library.");
    const store = await askYesNo(ask, "Include a store listing starter?", true);
    return { id, displayName, description, publisher, features: { service, widget, store } };
}

/** Exit code for a command line the scaffolder cannot read, as paperapi uses. */
export const EXIT_USAGE = 2;

export async function runCli(cli: CliOptions): Promise<number> {
    const log = cli.log ?? ((line: string) => console.log(line));
    let parsed;
    try {
        parsed = parseArgs({ args: cli.argv, options: FLAGS, allowPositionals: true });
    } catch (err) {
        console.error(`${cli.command}: ${(err as Error).message}`);
        console.error(`Try ${cli.command} --help`);
        return EXIT_USAGE;
    }
    const { values, positionals } = parsed;
    if (values.help) {
        for (const line of usage(cli)) log(line);
        return 0;
    }

    const [argId, ...rest] = positionals;
    const flagFeatures: Partial<PanelFeatures> = {};
    if (values["no-service"]) flagFeatures.service = false;
    if (values["no-widget"]) flagFeatures.widget = false;
    if (values["no-store"]) flagFeatures.store = false;
    // no service means no widget: dropping one choice must not need a second flag
    if (flagFeatures.service === false) flagFeatures.widget = false;

    let choices: Choices;
    if (argId) {
        const displayName = rest.join(" ").trim() || defaultDisplayName(argId);
        choices = {
            id: argId,
            displayName,
            description: values.description ?? "",
            publisher: values.publisher ?? "",
            features: { ...DEFAULT_FEATURES, ...flagFeatures },
        };
    } else {
        let rl: readline.Interface | undefined;
        let ask = cli.ask;
        if (!ask) {
            if (!process.stdin.isTTY) {
                console.error(`Usage: ${cli.command} <panel-id> [Display Name]`);
                console.error(`Example: ${cli.command} dev.paperboard.my-panel "My Panel"`);
                return EXIT_USAGE;
            }
            rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            ask = terminalAsk(rl);
        }
        try {
            choices = await promptChoices(cli, ask, log, {
                displayName: rest.join(" ").trim(),
                description: values.description ?? "",
                publisher: values.publisher ?? "",
            });
            // a flag is a decision made before the questions
            choices.features = { ...choices.features, ...flagFeatures };
        } finally {
            rl?.close();
        }
    }

    const { targetDir, files } = scaffoldPanel({
        mode: cli.mode,
        id: choices.id,
        displayName: choices.displayName,
        description: choices.description,
        publisher: choices.publisher,
        features: choices.features,
        parentDir: cli.parentDir,
    });
    const where = relative(process.cwd(), targetDir) || ".";
    const made = Object.entries(choices.features)
        .filter(([, on]) => on)
        .map(([name]) => name);

    log(`Created ${files.length} files in ${where}/ (${made.length ? made.join(", ") : "UI only"})`);
    log("");
    const bundles = `the page${choices.features.widget ? ", widget" : ""}${choices.features.service ? " and service" : ""} bundles`;
    log("Next (panels build and test with Bun, https://bun.sh):");
    log(`  cd ${where}`);
    log(`  bun install          # ${cli.mode === "workspace" ? "links the workspace libraries" : "the panel's dependencies"}`);
    log(`  bun run build        # typecheck, then ${bundles}`);
    log(`  bunx paperapi link   # Paperboard runs the panel from this folder`);
    log("");
    log("Its README.md has what comes after: tests, paperapi doctor, monitor and restart, and publishing.");
    log("Docs: https://paperboard.dev/docs/developers/");
    return 0;
}
