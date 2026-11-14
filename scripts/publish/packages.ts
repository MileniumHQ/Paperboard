// Publish packages: builds the picked public packages under packages/ and
// publishes them with npm, under the operator's own npm sign-in.
import * as p from "@clack/prompts";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { bar, cancelled, checkCancel, cmdOk, fail, printTable, REPO_ROOT, sh } from "./common";

interface NpmPackage {
    dir: string;
    name: string;
    version: string;
}

function listPackages(): NpmPackage[] {
    const pkgsRoot = join(REPO_ROOT, "packages");
    const out: NpmPackage[] = [];
    if (!existsSync(pkgsRoot)) return out;
    for (const e of readdirSync(pkgsRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const pkgPath = join(pkgsRoot, e.name, "package.json");
        if (!existsSync(pkgPath)) continue;
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
                name?: unknown;
                version?: unknown;
                private?: unknown;
                scripts?: Record<string, string>;
            };
            if (pkg.private) continue;
            if (typeof pkg.name !== "string" || typeof pkg.version !== "string") continue;
            if (!pkg.scripts?.build) continue;
            out.push({ dir: join(pkgsRoot, e.name), name: pkg.name, version: pkg.version });
        } catch (err) {
            p.log.warn(
                `Skipping ${e.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function flowPublishPackages(): Promise<void> {
    p.intro("Publish npm packages");
    const pkgs = listPackages();
    if (!pkgs.length) fail("No publishable packages found under packages/ (need name, version, and a build script).");
    const pickedNames = checkCancel(
        await p.multiselect({
            message: "Which packages to publish?",
            options: pkgs.map((x) => ({ value: x.name, label: x.name, hint: `v${x.version}` })),
            required: true,
        }),
    ) as string[];
    const picked = pkgs.filter((x) => pickedNames.includes(x.name));

    const buildBar = bar(picked.length);
    for (const x of picked) {
        p.log.step(`Building ${x.name} v${x.version}…`);
        await sh([process.execPath, "run", "build"], { cwd: x.dir, quiet: false });
        buildBar.increment(1, { task: x.name });
    }
    buildBar.stop();

    p.log.info("Ready to publish:");
    printTable(picked.map((x) => [x.name, `v${x.version}`]));
    if (!checkCancel(await p.confirm({ message: `Publish ${picked.length} package(s) to npm?`, initialValue: false }))) {
        cancelled();
    }

    if (!(await cmdOk(["npm", "--version"]))) {
        fail("npm not found on PATH. Install Node.js/npm, then re-run.");
    }
    if (!(await cmdOk(["npm", "whoami"]))) {
        p.log.warn("npm: not logged in — opening `npm login`…");
        await sh(["npm", "login"], { quiet: false, interactive: true });
        if (!(await cmdOk(["npm", "whoami"]))) {
            fail("npm login did not complete. Aborting before anything publishes.");
        }
    }

    // npm signs in through the browser (passkey) for each publish: it
    // prints a link and waits, so it gets the terminal and no progress bar
    // is drawn over the link
    p.log.info("npm will show a sign-in link for each package. Open it and approve with your passkey.");
    for (const x of picked) {
        p.log.step(`Publishing ${x.name} v${x.version}…`);
        await sh(["npm", "publish"], { cwd: x.dir, quiet: false, interactive: true });
    }

    p.log.success("Published:");
    printTable(
        picked.map((x) => [x.name, `https://www.npmjs.com/package/${x.name}/v/${x.version}`]),
    );
    p.outro("npm updated.");
}
