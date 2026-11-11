import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Data, Format, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { buildSupervisor, SUPERVISOR_TARGETS, type SupervisorTarget } from "./supervisor";
import { patchPeIcon } from "./windowsIcon";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "apps", "paperboard");
const appRequire = createRequire(join(APP, "package.json"));

let work: string;

beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "packaging-"));
});

afterEach(() => {
    rmSync(work, { recursive: true, force: true });
});

// The 7-Zip electron-builder archives with. Its own copy is a download, so
// the test uses the one on PATH (7-Zip 21+ names it 7zz).
function sevenZip(): string {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
        for (const name of ["7zz", "7za", "7z"]) {
            const candidate = join(dir, name);
            if (dir && existsSync(candidate)) return candidate;
        }
    }
    throw new Error("No 7-Zip (7zz, 7za or 7z) on PATH: the macOS zip test runs electron-builder's real archiver, which needs one");
}

const UNIX_SYMLINK = 0o120000;
const UNIX_FILE = 0o100000;
const UNIX_TYPE = 0o170000;

function entryType(entry: AdmZip.IZipEntry): number {
    return ((entry.header.attr >>> 16) & UNIX_TYPE) >>> 0;
}

// macOS refuses unsigned arm64 code and calls an unsigned download
// "damaged". electron-builder signs nothing unless an identity is named, so
// with no Developer ID the app must ask for ad-hoc. The release workflow's
// smoke checks the signature the Mac build actually carries.
describe("macOS builds are signed", () => {
    test("electron-builder signs the app ad-hoc, without the hardened runtime that refuses Electron's frameworks", () => {
        const config = Bun.YAML.parse(readFileSync(join(APP, "electron-builder.yml"), "utf8")) as {
            mac: { identity?: unknown; hardenedRuntime?: unknown };
        };
        expect(config.mac.identity).toBe("-");
        expect(config.mac.hardenedRuntime).toBe(false);
    });
});

// The macOS ZIP keeps framework symlinks when built off-Mac.
describe("the macOS ZIP keeps framework symlinks when built off-Mac", () => {
    test("electron-builder targets only zip for macOS x64 and arm64", () => {
        const config = Bun.YAML.parse(readFileSync(join(APP, "electron-builder.yml"), "utf8")) as {
            mac: { target: { target: string; arch: string[] }[] };
            dmg?: unknown;
        };
        expect(config.mac.target).toEqual([{ target: "zip", arch: ["x64", "arm64"] }]);
        expect(config.dmg).toBeUndefined();
    });

    test("the patched archiver stores Versions/Current and the framework's top-level link as symlinks", async () => {
        const archiveModule = appRequire.resolve("app-builder-lib/out/targets/archive.js", {
            paths: [dirname(appRequire.resolve("electron-builder/package.json"))],
        });
        const { archive } = (await import(archiveModule)) as {
            archive: (format: string, outFile: string, dir: string, options: Record<string, unknown>) => Promise<string>;
        };
        const app = join(work, "Paperboard.app");
        const framework = join(app, "Contents", "Frameworks", "Electron Framework.framework");
        mkdirSync(join(framework, "Versions", "A"), { recursive: true });
        writeFileSync(join(framework, "Versions", "A", "Electron Framework"), "real framework binary");
        symlinkSync("A", join(framework, "Versions", "Current"));
        symlinkSync(join("Versions", "Current", "Electron Framework"), join(framework, "Electron Framework"));

        const previous = process.env.ELECTRON_BUILDER_7ZIP_PATH;
        process.env.ELECTRON_BUILDER_7ZIP_PATH = sevenZip();
        const out = join(work, "paperboard-0.3.0-arm64.zip");
        try {
            // the options ArchiveTarget passes for a mac zip
            await archive("zip", out, app, { compression: "normal", withoutDir: false, preserveSymlinks: true });
        } finally {
            if (previous === undefined) delete process.env.ELECTRON_BUILDER_7ZIP_PATH;
            else process.env.ELECTRON_BUILDER_7ZIP_PATH = previous;
        }

        const entries = new Map(new AdmZip(out).getEntries().map((e) => [e.entryName, e]));
        const base = "Paperboard.app/Contents/Frameworks/Electron Framework.framework/";
        const current = entries.get(`${base}Versions/Current`);
        const top = entries.get(`${base}Electron Framework`);
        const real = entries.get(`${base}Versions/A/Electron Framework`);
        if (!current || !top || !real) throw new Error(`the zip is missing framework entries: ${[...entries.keys()].join(", ")}`);
        expect(entryType(current)).toBe(UNIX_SYMLINK);
        expect(current.getData().toString()).toBe("A");
        expect(entryType(top)).toBe(UNIX_SYMLINK);
        expect(top.getData().toString()).toBe("Versions/Current/Electron Framework");
        expect(entryType(real)).toBe(UNIX_FILE);
        expect(real.getData().toString()).toBe("real framework binary");
    });
});

// A PE shaped like a Bun --compile output: a .rsrc holding Bun's named
// default icon group, and the .bun payload section after it.
function bunShapedPe(): { bytes: Uint8Array; payload: Uint8Array } {
    const exe = NtExecutable.createEmpty(false, false);
    const resources = NtExecutableResource.from(exe);
    // a default icon large enough that the .rsrc allocation has the room
    // Bun's real one has
    const frame = Data.RawIconItem.from(new Uint8Array(160 * 1024).fill(0x11), 256, 256, 32);
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, "IDI_MYICON" as unknown as number, 1033, [frame]);
    resources.outputResource(exe);
    const payload = new Uint8Array(8192);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 0xff;
    exe.setSectionByEntry(Format.ImageDirectoryEntry.Exception, {
        info: {
            name: ".bun",
            virtualSize: payload.length,
            virtualAddress: 0,
            sizeOfRawData: 0,
            pointerToRawData: 0,
            pointerToRelocations: 0,
            pointerToLineNumbers: 0,
            numberOfRelocations: 0,
            numberOfLineNumbers: 0,
            characteristics: 0x40000040,
        },
        data: payload.buffer,
    });
    return { bytes: new Uint8Array(exe.generate()), payload };
}

function sections(bytes: Uint8Array): { name: string; virtualAddress: number; pointerToRawData: number; sizeOfRawData: number }[] {
    return NtExecutable.from(bytes, { ignoreCert: true })
        .getAllSections()
        .map((s) => ({
            name: s.info.name.replace(/\0+$/, ""),
            virtualAddress: s.info.virtualAddress,
            pointerToRawData: s.info.pointerToRawData,
            sizeOfRawData: s.info.sizeOfRawData,
        }));
}

// The icon resources of a Bun-shaped PE, read with the trailing section
// hidden (the parser refuses a non-relocation section after .rsrc).
function iconResources(bytes: Uint8Array): { groups: (string | number)[]; frames: number } {
    const exe = NtExecutable.from(bytes, { ignoreCert: true });
    const view = Object.create(exe) as NtExecutable;
    view.getAllSections = () => exe.getAllSections().filter((s) => s.info.name.replace(/\0+$/, "") === ".rsrc");
    const entries = NtExecutableResource.from(view).entries;
    return {
        groups: entries.filter((e) => e.type === 14).map((e) => e.id),
        frames: entries.filter((e) => e.type === 3).length,
    };
}

// Server binaries ship working.
describe("server binaries ship working", () => {
    test("the workload supervisor builds for every release target, as the kind of program that target runs", () => {
        // what each system's loader looks for at the start of a program
        const magic: Record<string, number[]> = {
            linux: [0x7f, 0x45, 0x4c, 0x46],
            darwin: [0xcf, 0xfa, 0xed, 0xfe],
            win32: [0x4d, 0x5a],
        };
        for (const target of Object.keys(SUPERVISOR_TARGETS) as SupervisorTarget[]) {
            const built = readFileSync(buildSupervisor(target));
            const expected = magic[SUPERVISOR_TARGETS[target].platform]!;
            expect({ target, magic: [...built.subarray(0, expected.length)] }).toEqual({ target, magic: expected });
        }
    }, 300_000);

    test("stamping the icon onto a Bun-shaped PE keeps the sections after .rsrc where they were", () => {
        const { bytes, payload } = bunShapedPe();
        const before = sections(bytes);
        expect(before.map((s) => s.name)).toEqual([".rsrc", ".bun"]);
        const icon = readFileSync(join(APP, "papercrane", "branding", "icon.ico"));

        const patched = patchPeIcon(bytes, icon);

        expect(patched.byteLength).toBe(bytes.byteLength);
        expect(sections(patched)).toEqual(before);
        const bun = before[1];
        expect(patched.subarray(bun.pointerToRawData, bun.pointerToRawData + payload.length)).toEqual(payload);
        expect(iconResources(bytes)).toEqual({ groups: ["IDI_MYICON"], frames: 1 });
        expect(iconResources(patched)).toEqual({ groups: [1], frames: Data.IconFile.from(icon).icons.length });
        // the input is not mutated
        expect(sections(bytes)).toEqual(before);
    });
});
