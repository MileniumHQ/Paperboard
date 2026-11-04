// `paperapi doctor`: everything that has to be right for a panel folder to
// run in Paperboard on this computer, checked in the order it matters, each
// failure said with what to run to fix it.
import fs from "fs";
import path from "path";
import { requirePanelId } from "../panelIdentity";
import { validateWidgetDeclarations, WIDGET_ENTRY } from "../widgetManifest";
import { tutorialImagePaths, validateTutorialDeclaration } from "../tutorialManifest";
import { HostConnection } from "./daemon";
import { panelsDir, paperboardDir } from "./paths";
import { CliError, EXIT_FAILED, EXIT_OK, shownPath, type Output } from "./output";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
    name: string;
    status: CheckStatus;
    detail: string;
    /** what to run or change, for warn and fail */
    fix?: string;
}

export interface Diagnosis {
    dir: string;
    panel: string | null;
    checks: Check[];
    problems: number;
    warnings: number;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

// the newest file under dir, so a build can be held to the source it came from
function newestFile(dir: string): { file: string; mtime: number } | null {
    let newest: { file: string; mtime: number } | null = null;
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                const mtime = fs.statSync(full).mtimeMs;
                if (!newest || mtime > newest.mtime) newest = { file: full, mtime };
            }
        }
    };
    walk(dir);
    return newest;
}

function relativePathProblem(field: string, value: unknown): string | null {
    if (value === undefined) return null;
    if (typeof value !== "string" || value.length === 0) return `"${field}" must be a path`;
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) return `"${field}" must stay inside the panel folder: ${value}`;
    return null;
}

function checkManifest(dir: string, checks: Check[]): Record<string, any> | null {
    const file = path.join(dir, "manifest.json");
    if (!fs.existsSync(file)) {
        checks.push({ name: "Manifest", status: "fail", detail: `there is no manifest.json in ${dir}`, fix: "Run this in a panel folder, or name one: paperapi doctor <panel-dir>" });
        return null;
    }
    let manifest: any;
    try {
        manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        checks.push({ name: "Manifest", status: "fail", detail: `manifest.json is not valid JSON: ${(err as Error).message}` });
        return null;
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        checks.push({ name: "Manifest", status: "fail", detail: "manifest.json must hold an object" });
        return null;
    }
    try {
        requirePanelId(manifest.id);
    } catch (err) {
        checks.push({ name: "Manifest", status: "fail", detail: `"id": ${(err as Error).message}` });
        return null;
    }
    const problems: string[] = [];
    for (const field of ["base", "service"]) {
        const problem = relativePathProblem(field, manifest[field]);
        if (problem) problems.push(problem);
    }
    try {
        validateWidgetDeclarations(manifest.widgets);
    } catch (err) {
        problems.push(`"widgets": ${(err as Error).message}`);
    }
    try {
        validateTutorialDeclaration(manifest.tutorial);
    } catch (err) {
        problems.push(`"tutorial": ${(err as Error).message}`);
    }
    if (problems.length > 0) {
        for (const problem of problems) checks.push({ name: "Manifest", status: "fail", detail: problem });
        return null;
    }
    // Paperboard runs a panel without these, but cannot release one
    const missing = ["name", "version"].filter((field) => typeof manifest[field] !== "string" || manifest[field] === "");
    if (missing.length > 0) {
        checks.push({ name: "Manifest", status: "warn", detail: `no ${missing.map((f) => `"${f}"`).join(" or ")}; paperapi pack refuses a panel without them`, fix: "Add them to manifest.json." });
    } else {
        checks.push({ name: "Manifest", status: "ok", detail: `${manifest.name} ${manifest.version}` });
    }
    return manifest;
}

function checkBuild(dir: string, manifest: Record<string, any>, checks: Check[]): boolean {
    const expected = [String(manifest.base ?? "./dist/index.html")];
    if (manifest.service) expected.push(String(manifest.service));
    if (validateWidgetDeclarations(manifest.widgets).length > 0) expected.push(`./dist/${WIDGET_ENTRY}`);
    for (const image of tutorialImagePaths(validateTutorialDeclaration(manifest.tutorial))) expected.push(`./dist/${image.replace(/^\.\//, "")}`);

    const missing = expected.filter((file) => !fs.existsSync(path.resolve(dir, file)));
    if (missing.length > 0) {
        checks.push({ name: "Build", status: "fail", detail: `${missing.map((f) => f.replace(/^\.\//, "")).join(", ")} ${missing.length === 1 ? "is" : "are"} missing`, fix: "bun run build" });
        return false;
    }
    const built = expected.map((file) => fs.statSync(path.resolve(dir, file)).mtimeMs);
    const src = path.join(dir, "src");
    const newest = fs.existsSync(src) ? newestFile(src) : null;
    if (newest && newest.mtime > Math.min(...built)) {
        checks.push({ name: "Build", status: "warn", detail: `${path.relative(dir, newest.file)} changed after the last build`, fix: "bun run build" });
    } else {
        checks.push({ name: "Build", status: "ok", detail: expected.map((f) => f.replace(/^\.\//, "")).join(", ") });
    }
    return true;
}

function checkLink(dir: string, id: string, checks: Check[]): boolean {
    const panels = panelsDir();
    const link = path.join(panels, id);
    let stat: fs.Stats;
    try {
        stat = fs.lstatSync(link);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        checks.push({ name: "Link", status: "fail", detail: `not linked into ${panels}`, fix: "paperapi link" });
        return false;
    }
    if (!stat.isSymbolicLink()) {
        checks.push({
            name: "Link",
            status: "fail",
            detail: `an installed copy of ${id} is in ${link}, so Paperboard runs that instead of this folder`,
            fix: "paperapi link --force (replaces the installed copy; the panel's data stays)",
        });
        return false;
    }
    const target = path.resolve(panels, fs.readlinkSync(link));
    if (!fs.existsSync(target)) {
        checks.push({ name: "Link", status: "fail", detail: `${link} points at ${target}, which is gone`, fix: "paperapi link" });
        return false;
    }
    if (fs.realpathSync(target) !== fs.realpathSync(dir)) {
        checks.push({ name: "Link", status: "fail", detail: `${link} points at another folder: ${target}`, fix: "paperapi link (points it here)" });
        return false;
    }
    checks.push({ name: "Link", status: "ok", detail: `${link} → ${shownPath(dir)}` });
    return true;
}

async function checkDaemon(id: string, manifest: Record<string, any>, linked: boolean, checks: Check[]): Promise<void> {
    let connection: HostConnection;
    try {
        connection = await HostConnection.open();
    } catch (err) {
        if (!(err instanceof CliError)) throw err;
        checks.push({ name: "Paperboard", status: "fail", detail: err.message.replace(/^Paperboard /, ""), ...(err.hint ? { fix: err.hint } : {}) });
        if (manifest.service) checks.push({ name: "Service", status: "skip", detail: "needs a running Paperboard" });
        return;
    }
    try {
        checks.push({ name: "Paperboard", status: "ok", detail: `running at ${connection.address}, data in ${paperboardDir()}` });
        if (!manifest.service) return;
        if (!linked) {
            checks.push({ name: "Service", status: "skip", detail: "needs the panel linked" });
            return;
        }
        const { actions } = await connection.request<{ actions: Array<{ panelId: string }> }>("actions:list", { panelId: id });
        if (actions.length > 0) {
            checks.push({ name: "Service", status: "ok", detail: `answering, with ${actions.length} ${actions.length === 1 ? "action" : "actions"} registered` });
        } else {
            checks.push({
                name: "Service",
                status: "fail",
                detail: "not answering: it has registered nothing with Paperboard",
                fix: `paperapi restart starts it; paperapi monitor --panel ${id} shows why it stops`,
            });
        }
    } finally {
        connection.close();
    }
}

export async function diagnose(dirArg: string | undefined, cwd = process.cwd()): Promise<Diagnosis> {
    const dir = path.resolve(cwd, dirArg ?? ".");
    const checks: Check[] = [];
    const manifest = checkManifest(dir, checks);
    const id = manifest ? String(manifest.id) : null;
    if (manifest && id) {
        checkBuild(dir, manifest, checks);
        const linked = checkLink(dir, id, checks);
        await checkDaemon(id, manifest, linked, checks);
    }
    return {
        dir,
        panel: id,
        checks,
        problems: checks.filter((c) => c.status === "fail").length,
        warnings: checks.filter((c) => c.status === "warn").length,
    };
}

export async function runDoctor(dirArg: string | undefined, options: { json?: boolean }, output: Output): Promise<number> {
    const report = await diagnose(dirArg);
    if (options.json) {
        output.line(JSON.stringify(report, null, 2));
        return report.problems > 0 ? EXIT_FAILED : EXIT_OK;
    }
    const p = output.out;
    output.line(`${p.bold(report.panel ?? "Panel")} ${p.dim(`in ${shownPath(report.dir)}`)}`);
    output.line();
    const width = Math.max(...report.checks.map((c) => c.name.length));
    const mark = { ok: p.green("✓"), warn: p.yellow("!"), fail: p.red("✗"), skip: p.dim("-") };
    for (const check of report.checks) {
        const detail = check.status === "skip" ? p.dim(check.detail) : check.detail;
        output.line(`  ${mark[check.status]} ${check.name.padEnd(width)}  ${detail}`);
        if (check.fix) output.line(`    ${" ".repeat(width)}  ${p.dim(`→ ${check.fix}`)}`);
    }
    output.line();
    const counts = [
        report.problems ? p.red(`${report.problems} ${report.problems === 1 ? "problem" : "problems"}`) : "",
        report.warnings ? p.yellow(`${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"}`) : "",
    ].filter(Boolean);
    output.line(counts.length ? `${counts.join(", ")}.` : p.green("Ready: Paperboard can run this panel."));
    return report.problems > 0 ? EXIT_FAILED : EXIT_OK;
}
