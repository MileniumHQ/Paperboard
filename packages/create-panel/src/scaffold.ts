// Scaffolds a new Paperboard panel from ../template, copying every
// first-party convention: manifest shape (0.x version, no icon until you add
// branding/), PaperProvider bootstrap, explicit PANEL_ID plumbing in UI +
// service, typed service errors, hermetic tests, and one tested pure-logic
// unit.
//
// Two modes share this one implementation:
//   workspace  - `bun scripts/create-panel.ts` inside the Paperboard repo:
//                writes panels/<id>/, depends on the libraries via workspace:*
//   standalone - `npm create @paperboard-dev/panel`: writes ./<id>/ in the
//                caller's directory, depends on the published libraries
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";
import { isPanelId, requirePanelId } from "../../paperapi/src/panelIdentity";
import paperapiPackage from "../../paperapi/package.json";
import paperuiPackage from "../../paperui/package.json";

// resolves from both src/scaffold.ts (source) and dist/cli.js (bundle)
export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "template");

const TOKENS = ["__PANEL_ID__", "__PANEL_NAME__", "__PANEL_DESC__", "__PAPERAPI_DEP__", "__PAPERUI_DEP__"];

export type ScaffoldMode = "workspace" | "standalone";

export interface ScaffoldOptions {
    mode: ScaffoldMode;
    id: string;
    displayName?: string;
    description?: string;
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

function copyTemplate(srcDir: string, destDir: string, replacements: Record<string, string>): string[] {
    const written: string[] = [];
    for (const entry of readdirSync(srcDir)) {
        const src = join(srcDir, entry);
        const dest = join(destDir, entry);
        if (statSync(src).isDirectory()) {
            mkdirSync(dest, { recursive: true });
            written.push(...copyTemplate(src, dest, replacements));
            continue;
        }
        let content = readFileSync(src, "utf8");
        for (const [token, value] of Object.entries(replacements)) {
            content = content.split(token).join(value);
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
    const templateDir = options.templateDir ?? TEMPLATE_DIR;
    const targetDir = resolve(options.parentDir, id);

    if (existsSync(targetDir)) {
        throw new Error(`"${targetDir}" already exists — pick another id or remove it first`);
    }
    if (!existsSync(templateDir)) {
        throw new Error(`template dir missing: ${templateDir}`);
    }

    const deps = libraryDependencies(options.mode);
    mkdirSync(targetDir, { recursive: true });
    const files = copyTemplate(templateDir, targetDir, {
        __PANEL_ID__: id,
        __PANEL_NAME__: displayName,
        __PANEL_DESC__: description,
        __PAPERAPI_DEP__: deps.paperapi,
        __PAPERUI_DEP__: deps.paperui,
    });

    // npm strips .gitignore from published packages, so the template ships
    // it as `gitignore`. Inside the repo the root .gitignore already applies.
    const gitignore = join(targetDir, "gitignore");
    if (options.mode === "standalone") {
        writeFileSync(join(targetDir, ".gitignore"), readFileSync(gitignore));
        files.push(join(targetDir, ".gitignore"));
    }
    rmFile(gitignore, files);

    if (options.mode === "standalone") {
        // the template's license and publisher are Paperboard's; a panel
        // made outside the repo belongs to its author, who sets both
        rmFile(join(targetDir, "LICENSE"), files);
        rewriteJson(join(targetDir, "package.json"), (pkg) => {
            pkg.license = "UNLICENSED";
        });
        rewriteJson(join(targetDir, "manifest.json"), (manifest) => {
            delete manifest.publisher;
        });
    }

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

function ask(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolvePrompt) => {
        rl.question(prompt, (answer) => resolvePrompt(answer.trim()));
    });
}

export interface CliOptions {
    mode: ScaffoldMode;
    parentDir: string;
    /** How the user invoked us, for usage text. */
    command: string;
    argv: string[];
}

export async function runCli(cli: CliOptions): Promise<number> {
    const [argId, ...rest] = cli.argv;
    const example = `${cli.command} dev.paperboard.my-panel "My Panel"`;
    if (argId === "--help" || argId === "-h") {
        console.log(`Usage: ${cli.command} [panel-id] [Display Name]`);
        console.log(`Example: ${example}`);
        console.log("Run with no arguments for interactive prompts.");
        return 0;
    }

    let id = argId ?? "";
    let displayName = rest.join(" ").trim();
    let description = "";

    if (!id) {
        if (!process.stdin.isTTY) {
            console.error(`Usage: ${cli.command} <panel-id> [Display Name]`);
            console.error(`Example: ${example}`);
            return 1;
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
            // loop until the id validates AND the target is free
            for (;;) {
                const answer = await ask(rl, "Panel id (e.g. dev.paperboard.my-panel): ");
                if (!isPanelId(answer)) {
                    try {
                        requirePanelId(answer);
                    } catch (err) {
                        console.error(`  ${(err as Error).message}`);
                    }
                    continue;
                }
                if (existsSync(resolve(cli.parentDir, answer))) {
                    console.error(`  ${answer}/ already exists — pick another id`);
                    continue;
                }
                id = answer;
                break;
            }
            if (!displayName) {
                const fallback = defaultDisplayName(id);
                displayName = (await ask(rl, `Display name [${fallback}]: `)) || fallback;
            }
            description = (await ask(rl, `Description [${displayName} panel]: `)) || `${displayName} panel`;
        } finally {
            rl.close();
        }
    }

    const { targetDir, files } = scaffoldPanel({
        mode: cli.mode,
        id,
        displayName,
        description,
        parentDir: cli.parentDir,
    });
    const where = relative(process.cwd(), targetDir) || ".";

    console.log(`Created ${files.length} files in ${where}/`);
    console.log("");
    console.log("Next steps (panels build and test with Bun, https://bun.sh):");
    if (cli.mode === "workspace") {
        console.log(`  1. bun install                # link workspace deps`);
        console.log(`  2. cd ${where} && bun test   # hermetic unit tests`);
        console.log(`  3. bun run build              # typecheck + UI + service bundles`);
        console.log(`  4. bunx paperapi link         # load it in Paperboard`);
    } else {
        console.log(`  1. cd ${where} && bun install`);
        console.log(`  2. bun test                   # hermetic unit tests`);
        console.log(`  3. bun run build              # typecheck + UI + service bundles`);
        console.log(`  4. npx @paperboard-dev/paperapi link   # load it in Paperboard`);
    }
    console.log(`  5. Edit manifest.json (description, version) and make it yours.`);
    return 0;
}
