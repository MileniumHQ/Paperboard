import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { applyFeatureMarkers, DEFAULT_FEATURES, runCli, scaffoldPanel, TEMPLATE_DIR, type PanelFeatures } from "../src/scaffold";
import paperapiPackage from "../../paperapi/package.json";
import paperuiPackage from "../../paperui/package.json";
import ownPackage from "../package.json";

let parentDir: string;

beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), "create-panel-test-"));
});

afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
});

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

function allFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? allFiles(path) : [path];
    });
}

describe("scaffoldPanel", () => {
    it("writes a standalone panel wired to the published libraries", () => {
        const { targetDir } = scaffoldPanel({
            mode: "standalone",
            id: "dev.paperboard.my-panel",
            displayName: "My Panel",
            publisher: "Ada",
            parentDir,
        });
        expect(targetDir).toBe(join(parentDir, "dev.paperboard.my-panel"));

        const pkg = readJson(join(targetDir, "package.json"));
        expect(pkg.name).toBe("dev.paperboard.my-panel");
        expect(pkg.dependencies["@mileniumhq/paperapi"]).toBe(`^${paperapiPackage.version}`);
        expect(pkg.dependencies["@mileniumhq/paperui"]).toBe(`^${paperuiPackage.version}`);
        expect(pkg.license).toBe("UNLICENSED");

        expect(readJson(join(targetDir, "manifest.json"))).toEqual({
            name: "My Panel",
            id: "dev.paperboard.my-panel",
            version: "0.1.0",
            description: "My Panel panel",
            publisher: "Ada",
            base: "./dist/index.html",
            service: "./dist/service.js",
            widgets: [
                {
                    id: "greetings",
                    name: "Greetings",
                    description: "How many greetings the service has given",
                    sizes: ["1x1", "2x1"],
                },
            ],
            store: { about: "./store/about.md" },
        });

        expect(existsSync(join(targetDir, ".gitignore"))).toBe(true);
        expect(existsSync(join(targetDir, "gitignore"))).toBe(false);
        expect(existsSync(join(targetDir, "LICENSE"))).toBe(false);
        expect(readFileSync(join(targetDir, "src/panel.ts"), "utf8")).toContain(
            'export const PANEL_ID = "dev.paperboard.my-panel";',
        );
    });

    it("writes a workspace panel wired to workspace:* as first-party", () => {
        const { targetDir } = scaffoldPanel({ mode: "workspace", id: "dev.paperboard.my-panel", parentDir });
        const pkg = readJson(join(targetDir, "package.json"));
        expect(pkg.dependencies["@mileniumhq/paperapi"]).toBe("workspace:*");
        expect(pkg.dependencies["@mileniumhq/paperui"]).toBe("workspace:*");
        expect(pkg.license).toBe("PolyForm-Noncommercial-1.0.0");
        expect(readJson(join(targetDir, "manifest.json")).publisher).toBe("Paperboard");
        expect(readJson(join(targetDir, "manifest.json")).name).toBe("My Panel");
        expect(existsSync(join(targetDir, "LICENSE"))).toBe(true);
        expect(existsSync(join(targetDir, "gitignore"))).toBe(false);
        expect(existsSync(join(targetDir, ".gitignore"))).toBe(false);
    });

    it("ships what the first-party panels guard: a UI standards test and the hermetic preload", () => {
        const { targetDir } = scaffoldPanel({ mode: "standalone", id: "dev.paperboard.my-panel", parentDir });
        expect(readFileSync(join(targetDir, "test/uiStandards.test.ts"), "utf8")).toContain("no component sets an inline style");
        expect(readFileSync(join(targetDir, "bunfig.toml"), "utf8")).toContain("./test/hermetic.ts");
    });

    it("leaves no inline style and no stale token in any file it writes", () => {
        const { targetDir } = scaffoldPanel({ mode: "standalone", id: "dev.paperboard.my-panel", parentDir });
        for (const file of allFiles(targetDir).filter((f) => f.endsWith(".tsx"))) {
            expect(readFileSync(file, "utf8")).not.toMatch(/\bstyle=\{/);
            // light-text was a PaperUI color that no longer exists; PaperText takes any string, so nothing else catches it
            expect(readFileSync(file, "utf8")).not.toContain("light-text");
        }
    });

    describe("choices", () => {
        const combos: Array<[string, Partial<PanelFeatures>, { service: boolean; widget: boolean; store: boolean }]> = [
            ["everything", {}, { service: true, widget: true, store: true }],
            ["no widget", { widget: false }, { service: true, widget: false, store: true }],
            ["no store", { store: false }, { service: true, widget: true, store: false }],
            ["UI only", { service: false, widget: false, store: false }, { service: false, widget: false, store: false }],
        ];

        for (const [name, features, expected] of combos) {
            it(`${name}: writes exactly what it chose`, () => {
                const { targetDir, files } = scaffoldPanel({ mode: "standalone", id: "dev.paperboard.my-panel", features, parentDir });
                const has = (path: string) => existsSync(join(targetDir, path));
                const manifest = readJson(join(targetDir, "manifest.json"));
                const pkg = readJson(join(targetDir, "package.json"));

                expect(has("src/service.ts")).toBe(expected.service);
                expect(has("src/pages/ServicePage.tsx")).toBe(expected.service);
                expect(has("test/greet.test.ts")).toBe(expected.service);
                expect(manifest.service).toBe(expected.service ? "./dist/service.js" : undefined);
                expect(pkg.scripts.build.includes("service.js")).toBe(expected.service);

                expect(has("widget.html")).toBe(expected.widget);
                expect(has("src/widget.tsx")).toBe(expected.widget);
                expect(manifest.widgets !== undefined).toBe(expected.widget);
                expect(readFileSync(join(targetDir, "vite.config.ts"), "utf8").includes("widget.html")).toBe(expected.widget);

                expect(has("store/about.md")).toBe(expected.store);
                expect(has("store")).toBe(expected.store);
                expect(manifest.store !== undefined).toBe(expected.store);

                // the pages and the app agree with the choices
                expect(readFileSync(join(targetDir, "src/App.tsx"), "utf8").includes("ServicePage")).toBe(expected.service);
                // no marker, token or dangling file reference survives
                for (const file of files) {
                    const content = readFileSync(file, "utf8");
                    expect(content).not.toMatch(/@(if|endif)\b/);
                    expect(content).not.toMatch(/__PANEL_[A-Z]+__/);
                }
                expect(files.every((file) => existsSync(file) && statSync(file).isFile())).toBe(true);
            });
        }
    });

    it("keeps a description with quotes valid in the manifest, and a name with markup out of the page", () => {
        const { targetDir } = scaffoldPanel({
            mode: "standalone",
            id: "dev.paperboard.my-panel",
            displayName: 'Ada\'s <b>"Panel"</b>',
            description: 'Says "hello" \\ goodbye',
            parentDir,
        });
        const manifest = readJson(join(targetDir, "manifest.json"));
        expect(manifest.name).toBe('Ada\'s <b>"Panel"</b>');
        expect(manifest.description).toBe('Says "hello" \\ goodbye');
        const page = readFileSync(join(targetDir, "index.html"), "utf8");
        expect(page).toContain("<title>Ada's &lt;b&gt;\"Panel\"&lt;/b&gt;</title>");
    });

    it("refuses a widget without a service, writing nothing", () => {
        expect(() =>
            scaffoldPanel({ mode: "standalone", id: "dev.paperboard.my-panel", features: { service: false }, parentDir }),
        ).toThrow(/needs a service/);
        expect(existsSync(join(parentDir, "dev.paperboard.my-panel"))).toBe(false);
    });

    it("refuses a publisher on a first-party panel", () => {
        expect(() =>
            scaffoldPanel({ mode: "workspace", id: "dev.paperboard.my-panel", publisher: "Ada", parentDir }),
        ).toThrow(/published by Paperboard/);
    });

    it("leaves no half-written folder when the template is broken", () => {
        const broken = mkdtempSync(join(tmpdir(), "create-panel-broken-"));
        try {
            mkdirSync(join(broken, "src"), { recursive: true });
            writeFileSync(join(broken, "src/a.ts"), "// @if nonsense\nx\n// @endif\n");
            expect(() => scaffoldPanel({ mode: "standalone", id: "dev.paperboard.my-panel", parentDir, templateDir: broken })).toThrow(
                /unknown feature "nonsense"/,
            );
            expect(existsSync(join(parentDir, "dev.paperboard.my-panel"))).toBe(false);
        } finally {
            rmSync(broken, { recursive: true, force: true });
        }
    });

    it("refuses ids the panel identity contract rejects, writing nothing", () => {
        for (const id of ["settings", "Dev.Paperboard.X", "../escape", "a".repeat(129), ""]) {
            expect(() => scaffoldPanel({ mode: "standalone", id, parentDir })).toThrow(/Invalid panel id/);
        }
        expect(existsSync(join(parentDir, "settings"))).toBe(false);
    });

    it("refuses to write over an existing directory", () => {
        mkdirSync(join(parentDir, "dev.paperboard.taken"));
        expect(() => scaffoldPanel({ mode: "standalone", id: "dev.paperboard.taken", parentDir })).toThrow(
            /already exists/,
        );
        expect(existsSync(join(parentDir, "dev.paperboard.taken"))).toBe(true);
    });

    it("pins the dependencies the template builds with to the ones this package tests with", () => {
        // the build test runs the template against this package's devDependencies;
        // a range that drifted would pass here and fail for the panel's author
        const template = readJson(join(TEMPLATE_DIR, "package.json"));
        const own = ownPackage.devDependencies as Record<string, string>;
        const wanted = { ...template.dependencies, ...template.devDependencies };
        for (const name of ["solid-js", "typescript", "vite", "vite-plugin-solid"]) {
            expect(own[name]).toBe(wanted[name]);
        }
    });
});

describe("applyFeatureMarkers", () => {
    const on: PanelFeatures = { ...DEFAULT_FEATURES };
    const off: PanelFeatures = { service: false, widget: false, store: false };

    it("keeps a block whose feature is on, and drops its markers", () => {
        expect(applyFeatureMarkers("a\n// @if service\nb\n// @endif\nc", on)).toBe("a\nb\nc");
    });

    it("drops a block whose feature is off", () => {
        expect(applyFeatureMarkers("a\n// @if service\nb\n// @endif\nc", off)).toBe("a\nc");
    });

    it("reads the marker in JSX and markdown comments too", () => {
        expect(applyFeatureMarkers("{/* @if widget */}\nx\n{/* @endif */}", off)).toBe("");
        expect(applyFeatureMarkers("<!-- @if store -->\nx\n<!-- @endif -->", off)).toBe("");
    });

    it("refuses markers that do not balance, nest, or name a feature", () => {
        expect(() => applyFeatureMarkers("// @if service\nx", on)).toThrow(/never closed/);
        expect(() => applyFeatureMarkers("x\n// @endif", on)).toThrow(/without @if/);
        expect(() => applyFeatureMarkers("// @if service\n// @if widget\n// @endif\n// @endif", on)).toThrow(/nest/);
        expect(() => applyFeatureMarkers("// @if sevrice\n// @endif", on)).toThrow(/unknown feature "sevrice"/);
    });
});

describe("the service a panel starts with", () => {
    it("gives an action input the kind of value as its placeholder, not an example", () => {
        const { targetDir } = scaffoldPanel({ mode: "standalone", id: "dev.paperboard.inputs", parentDir });
        const service = readFileSync(join(targetDir, "src/service.ts"), "utf8");
        const placeholders = [...service.matchAll(/placeholder: "([^"]*)"/g)].map((m) => m[1]);
        expect(placeholders).toEqual(["Name"]);
    });
});

describe("the README a panel starts with", () => {
    const readme = (features: Partial<PanelFeatures>) => {
        const { targetDir } = scaffoldPanel({ mode: "standalone", id: "dev.paperboard.readme", features, parentDir });
        return readFileSync(join(targetDir, "README.md"), "utf8");
    };

    it("gives the next three commands, in order, and points at the guides", () => {
        const text = readme({});
        const block = text.slice(text.indexOf("```sh") + 5, text.indexOf("```", text.indexOf("```sh") + 5));
        expect(block.trim().split("\n").map((line) => line.replace(/\s+#.*$/, ""))).toEqual(["bun install", "bun run build", "bunx paperapi link"]);
        expect(text).toContain("https://paperboard.dev/docs/guides/");
        expect(text).not.toContain("paperboard.dev/paperapi");
    });

    it("names the commands for when something is off, for this panel", () => {
        const text = readme({});
        expect(text).toContain("bunx paperapi doctor");
        expect(text).toContain("bunx paperapi restart");
        expect(text).toContain("bunx paperapi monitor --panel dev.paperboard.readme");
        expect(text).toContain("bunx paperapi call dev.paperboard.readme greet");
        // a panel with no service has no actions to call
        rmSync(join(parentDir, "dev.paperboard.readme"), { recursive: true });
        expect(readme({ service: false, widget: false })).not.toContain("paperapi call");
    });
});

describe("runCli", () => {
    const run = async (argv: string[], answers: string[] = [], mode: "standalone" | "workspace" = "standalone") => {
        const lines: string[] = [];
        const asked: string[] = [];
        const code = await runCli({
            mode,
            parentDir,
            command: "create-panel",
            argv,
            log: (line) => lines.push(line),
            ask: async (question) => {
                asked.push(question);
                const answer = answers.shift();
                if (answer === undefined) throw new Error(`unexpected question: ${question}`);
                return answer;
            },
        });
        return { code, lines, asked };
    };

    it("makes the panel at once from an id, name and flags, asking nothing", async () => {
        const { code, asked } = await run(["dev.paperboard.my-panel", "My", "Panel", "--description", "Does a thing", "--no-store"]);
        expect(code).toBe(0);
        expect(asked).toEqual([]);
        const manifest = readJson(join(parentDir, "dev.paperboard.my-panel/manifest.json"));
        expect(manifest.name).toBe("My Panel");
        expect(manifest.description).toBe("Does a thing");
        expect(manifest.store).toBeUndefined();
        expect(manifest.widgets).toBeDefined();
    });

    it("lets --no-service drop the widget with it", async () => {
        await run(["dev.paperboard.my-panel", "--no-service"]);
        const manifest = readJson(join(parentDir, "dev.paperboard.my-panel/manifest.json"));
        expect(manifest.service).toBeUndefined();
        expect(manifest.widgets).toBeUndefined();
    });

    it("walks through the choices that matter when no id is given", async () => {
        // id, name, description, publisher, service, widget, store
        const { code, asked } = await run([], ["dev.paperboard.guided", "Guided", "A guided panel", "Ada", "y", "n", "n"]);
        expect(code).toBe(0);
        expect(asked.map((q) => q.replace(/ \[.*$|: $/, ""))).toEqual([
            "Panel id (e.g. dev.paperboard.my-panel)",
            "Display name",
            "Description",
            "Publisher, credited on the library page (leave empty to set it later)",
            "Include a background service?",
            "Include a Home widget?",
            "Include a store listing starter?",
        ]);
        const manifest = readJson(join(parentDir, "dev.paperboard.guided/manifest.json"));
        expect(manifest).toMatchObject({ name: "Guided", description: "A guided panel", publisher: "Ada" });
        expect(manifest.service).toBe("./dist/service.js");
        expect(manifest.widgets).toBeUndefined();
        expect(manifest.store).toBeUndefined();
    });

    it("does not offer a widget to a panel with no service, and takes Enter as the default", async () => {
        const { asked } = await run([], ["dev.paperboard.uionly", "", "", "", "n", ""]);
        expect(asked.some((q) => q.includes("widget"))).toBe(false);
        const manifest = readJson(join(parentDir, "dev.paperboard.uionly/manifest.json"));
        expect(manifest.name).toBe("Uionly");
        expect(manifest.service).toBeUndefined();
        expect(manifest.store).toBeDefined();
    });

    it("asks again after an invalid id or an unclear answer", async () => {
        const { asked } = await run([], ["Not An Id", "dev.paperboard.again", "", "", "", "maybe", "", "", ""]);
        expect(asked.filter((q) => q.startsWith("Panel id"))).toHaveLength(2);
        expect(asked.filter((q) => q.startsWith("Include a background service"))).toHaveLength(2);
        expect(existsSync(join(parentDir, "dev.paperboard.again"))).toBe(true);
    });

    it("does not ask a first-party author for a publisher", async () => {
        const { asked } = await run([], ["dev.paperboard.fp", "", "", "", "", ""], "workspace");
        expect(asked.some((q) => q.startsWith("Publisher"))).toBe(false);
    });

    it("prints usage for --help and fails on an option it does not know", async () => {
        const help = await run(["--help"]);
        expect(help.code).toBe(0);
        expect(help.lines.join("\n")).toContain("--no-service");
        // a command line it cannot read exits 2, as paperapi's does
        expect(await run(["--bogus"])).toMatchObject({ code: 2 });
    });

    it("ends with the three commands that run the panel, and where the guides are", async () => {
        const { code, lines } = await run(["dev.paperboard.next"]);
        expect(code).toBe(0);
        const text = lines.join("\n");
        const commands = lines.map((line) => line.trim().replace(/\s+#.*$/, "")).filter((line) => /^(cd|bun|bunx) /.test(line));
        expect(commands).toEqual([`cd ${relative(process.cwd(), join(parentDir, "dev.paperboard.next"))}`, "bun install", "bun run build", "bunx paperapi link"]);
        expect(text).toContain("https://paperboard.dev/docs/guides/");
        expect(text).not.toContain("npx");
    });
});
