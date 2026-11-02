import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decode, encode, parseOptionSettings, writeOptionSettings } from "../src/games/palworld/ini";
import { options, palworld } from "../src/games/palworld";
import { validateOptions } from "../src/games/options";
import { installApp, parseAppProgress, parseAppResult, takeSelfUpdate, type Runner } from "../src/games/steam/steamcmd";

// lines as the 2026 Palworld dedicated server writes them
const DEFAULT = `; This configuration file is a sample of the default server settings.
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,RandomizerSeed="",ExpRate=1.000000,DeathPenalty=Item,ServerPlayerMaxNum=32,ServerName="Default Palworld Server",ServerDescription="a, b",AdminPassword="",CrossplayPlatforms=(Steam,Xbox,PS5,Mac),bIsPvP=False,DenyTechnologyList=,bAllowEnhanceStat_WorkSpeed=True)
`;

describe("PalWorldSettings.ini", () => {
    test("reads every entry, quoted commas and tuples included", () => {
        const entries = parseOptionSettings(DEFAULT);
        expect(entries.map((e) => e.key)).toEqual(["Difficulty", "RandomizerSeed", "ExpRate", "DeathPenalty", "ServerPlayerMaxNum", "ServerName", "ServerDescription", "AdminPassword", "CrossplayPlatforms", "bIsPvP", "DenyTechnologyList", "bAllowEnhanceStat_WorkSpeed"]);
        expect(entries.find((e) => e.key === "CrossplayPlatforms")!.raw).toBe("(Steam,Xbox,PS5,Mac)");
        expect(decode(entries.find((e) => e.key === "ServerDescription")!.raw, "string", "ServerDescription")).toBe("a, b");
        expect(decode("1.500000", "float", "ExpRate")).toBe(1.5);
        expect(decode("False", "bool", "bIsPvP")).toBe(false);
    });

    test("a write changes only the keys it sets and keeps the rest of the file", () => {
        const entries = parseOptionSettings(DEFAULT).map((e) => (e.key === "ExpRate" ? { key: e.key, raw: encode(2.5, "float", e.key) } : e));
        const text = writeOptionSettings(DEFAULT, entries);
        expect(text.split("\n")[0]).toStartWith("; This configuration");
        expect(text).toContain("ExpRate=2.500000,DeathPenalty=Item");
        expect(text).toContain("CrossplayPlatforms=(Steam,Xbox,PS5,Mac)");
        expect(text).toContain('ServerDescription="a, b"');
        expect(parseOptionSettings(text)).toHaveLength(12);
    });

    test("broken files and unsafe values are refused, not guessed", () => {
        expect(() => parseOptionSettings("[/Script/Pal.PalGameWorldSettings]\n")).toThrow("no OptionSettings line");
        expect(() => parseOptionSettings('OptionSettings=(ServerName="open)')).toThrow("unclosed quote");
        expect(() => decode("maybe", "bool", "bIsPvP")).toThrow("not True or False");
        expect(() => encode('Pal"s', "string", "Server name")).toThrow("can't hold quotes");
    });
});

describe("Palworld options", () => {
    test("rates take tenths in their range; whole-number options stay whole", () => {
        expect(validateOptions(options, "Palworld", { ExpRate: 2.5, PalCaptureRate: 0.5 })).toEqual({ ExpRate: 2.5, PalCaptureRate: 0.5 });
        expect(() => validateOptions(options, "Palworld", { ExpRate: 2.55 })).toThrow("Experience must be a number from 0.1 to 20 in steps of 0.1");
        expect(() => validateOptions(options, "Palworld", { PalCaptureRate: 3 })).toThrow("from 0.5 to 2");
        expect(() => validateOptions(options, "Palworld", { ServerPlayerMaxNum: 2.5 })).toThrow("Maximum players must be a whole number from 1 to 32");
        expect(() => validateOptions(options, "Palworld", { Difficulty: "Hard" })).toThrow("Unknown Palworld option: Difficulty");
    });

    test("every stored option names its ini key once, and messages go to everyone instead of a console", () => {
        const keys = options.flatMap((o) => (o.ini ? [o.ini.key] : []));
        expect(new Set(keys).size).toBe(keys.length);
        const features = palworld.describe({ software: "", version: "" });
        expect(features.control).toEqual({ kind: "broadcast" });
        expect(features.actions).not.toContain("run-command");
        expect(palworld.hostSupport({ os: "linux", arch: "arm64" }, { software: "", version: "" }).supported).toBe(false);
    });
});

describe("SteamCMD app installs", () => {
    test("progress and the final verdict are read from SteamCMD's own lines", () => {
        expect(parseAppProgress("\x1b[0m Update state (0x61) downloading, progress: 45.12 (2225000000 / 4932070576)")).toEqual({ stage: "downloading", percent: 45.12, bytes: { done: 2225000000, total: 4932070576 } });
        expect(parseAppProgress(" Update state (0x81) verifying update, progress: 32.59 (1607344511 / 4932070576)")).toEqual({ stage: "verifying", percent: 32.59, bytes: { done: 1607344511, total: 4932070576 } });
        expect(parseAppProgress(" Update state (0x0) unknown, progress: 0.00 (0 / 0)")).toBeNull();
        expect(parseAppResult(["\x1b[0mSuccess! App '2394010' fully installed."], 2394010)).toEqual({ ok: true });
        expect(parseAppResult(["ERROR! Failed to install app '2394010' (Missing configuration)"], 2394010)).toEqual({ ok: false, reason: "Missing configuration" });
        expect(parseAppResult(["Error! App '2394010' state is 0x202 after update job."], 2394010)).toEqual({ ok: false, reason: "state 0x202" });
        expect(parseAppResult(["Success! App '730' fully installed."], 2394010)).toBeNull();
    });

    const roots: string[] = [];
    afterAll(() => Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true }))));

    /** A SteamCMD stand-in run as a real process: fails its first run the way a fresh SteamCMD does, then installs. */
    async function steam(failures: number) {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), "steam-app-"));
        roots.push(ws);
        await fs.mkdir(path.join(ws, "steamcmd"));
        const script = path.join(ws, "steamcmd", "steamcmd.sh");
        await fs.writeFile(script, `#!/bin/sh
count="${ws}/runs"; n=$(cat "$count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$count"
dir=""; while [ $# -gt 0 ]; do case "$1" in +force_install_dir) dir="$2"; shift 2;; *) shift;; esac; done
if [ $n -le ${failures} ]; then echo "ERROR! Failed to install app '2394010' (Missing configuration)"; exit 8; fi
echo " Update state (0x61) downloading, progress: 50.00 (1 / 2)"
mkdir -p "$dir/steamapps"; printf '"AppState"\\n{\\n\\t"buildid"\\t\\t"25247047"\\n}\\n' > "$dir/steamapps/appmanifest_2394010.acf"
echo "Success! App '2394010' fully installed."
`);
        await fs.chmod(script, 0o755);
        return ws;
    }
    const runner: Runner = async (run) => {
        const child = Bun.spawn([run.command, ...run.args], { cwd: run.cwd, env: { ...process.env, ...run.env }, stdout: "pipe" });
        const lines = (await new Response(child.stdout).text()).split("\n").filter(Boolean);
        for (const line of lines) run.onLine?.(line);
        return { exitCode: await child.exited, tail: lines.slice(-20) };
    };

    test("a fresh SteamCMD's Missing configuration is retried once, and the build is read back", async () => {
        const ws = await steam(1);
        const progress: number[] = [];
        expect(await installApp(2394010, path.join(ws, "server"), { runner, workspace: ws, onProgress: (p) => progress.push(p.percent) })).toBe("25247047");
        expect(progress).toEqual([50]);
        expect((await fs.readFile(path.join(ws, "runs"), "utf8")).trim()).toBe("2");
    });

    // Windows SteamCMD exits with 7 after updating itself and finishes the
    // run in a relaunched copy; a download then finished unseen and failed
    test("Windows SteamCMD's self-update is taken by a run that only quits, before the real one", async () => {
        const ws = await fs.mkdtemp(path.join(os.tmpdir(), "steamcmd-update-"));
        roots.push(ws);
        const script = path.join(ws, "steamcmd.sh");
        const updates = (n: number) => fs.writeFile(script, `#!/bin/sh
count="${ws}/runs"; n=$(cat "$count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$count"; echo "$*" >> "${ws}/args"
if [ $n -le ${n} ]; then echo "[----] Update complete, launching..."; exit 7; fi
`, { mode: 0o755 });
        await updates(1);
        await takeSelfUpdate(runner, script, ws, "win32");
        expect((await fs.readFile(path.join(ws, "args"), "utf8")).trim().split("\n")).toEqual(["+quit", "+quit"]);
        await takeSelfUpdate(runner, script, ws, "linux");
        expect((await fs.readFile(path.join(ws, "runs"), "utf8")).trim()).toBe("2");
        await fs.rm(path.join(ws, "runs"));
        await updates(3);
        await expect(takeSelfUpdate(runner, script, ws, "win32")).rejects.toThrow("SteamCMD updated itself three times in a row without settling");
        await fs.writeFile(script, "#!/bin/sh\necho 'missing steam.dll'; exit 3\n", { mode: 0o755 });
        await expect(takeSelfUpdate(runner, script, ws, "win32")).rejects.toThrow("SteamCMD could not start (exited with 3)\nmissing steam.dll");
    });

    test("a second failure is reported with SteamCMD's reason", async () => {
        const ws = await steam(2);
        await expect(installApp(2394010, path.join(ws, "server"), { runner, workspace: ws })).rejects.toThrow("Steam download of app 2394010 failed: Missing configuration (SteamCMD exited with 8)");
    });
});
