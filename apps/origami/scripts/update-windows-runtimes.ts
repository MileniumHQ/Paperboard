// Publishes the Microsoft runtimes game servers load on Windows, as files a
// server carries beside its own executable rather than a system install:
// - xna-framework: XNA Framework 4.0, for Terraria's 32-bit Windows server.
//   The assemblies it references (Framework, Game, Graphics, Xact), the
//   native XnaNative.dll, and the Visual C++ 2010 libraries they link.
// - vc-runtime: Visual C++ 2015–2022 (x64), for Unreal Engine servers such
//   as Palworld's. The app-local CRT folder Microsoft ships for exactly this.
// bun run update:windows-runtimes -- --dry-run prints without writing.
// Trust: both come from Microsoft's own servers. XNA's redistributable never
// changes; the CRT is a payload of Visual Studio's signed release catalog,
// which lists its SHA-256. Each is pinned below and any change refuses the
// record, so a newer CRT is a reviewed pin, not a refresh.
// The Game Server panel installs a runtime only when Windows lacks it, and
// copies its bin/ beside the server's executable, where Windows and .NET
// look first.
import { createHash } from "node:crypto";
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, type PackageRecipe, type PackageRecord } from "./lib/records";

interface Runtime {
    name: string;
    version: string;
    url: string;
    sha256: string;
    recipe: PackageRecipe;
}

const XNA_KEYS = ["Microsoft_Xna_Framework", "Microsoft_Xna_Framework_Game", "Microsoft_Xna_Framework_Graphics", "Microsoft_Xna_Framework_Xact"];
// the File table keys of Visual C++ 2010's merge module, as the XNA package carries them
const VC2010_KEY = (lib: string) => `F_CENTRAL_${lib}_x86.DF495DFD_79F6_34DF_BB1E_E58DB5BDCF2C`;
const CRT_VERSION = "14.44.35112";

export const WINDOWS_RUNTIMES: readonly Runtime[] = [
    {
        name: "xna-framework",
        version: "4.0.0",
        url: "https://download.microsoft.com/download/A/C/2/AC2C903B-E6E8-42C2-9FD7-BEBAC362A930/xnafx40_redist.msi",
        sha256: "47260420773a20443fb1e38a89b7f39c5237a80a842de598e6c8f7f90a3bbd6d",
        recipe: {
            unpack: "msi",
            take: {
                ...Object.fromEntries(XNA_KEYS.map((key) => [`bin/${key.replaceAll("_", ".")}.dll`, `${key}_dll_GAC`])),
                "bin/XnaNative.dll": "XnaNative_dll_File",
                "bin/msvcr100.dll": VC2010_KEY("msvcr100"),
                "bin/msvcp100.dll": VC2010_KEY("msvcp100"),
            },
        },
    },
    {
        name: "vc-runtime",
        version: "14.44.35211",
        url: "https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5/Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix",
        sha256: "4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5",
        recipe: { unpack: "zip", take: { bin: `Contents/VC/Redist/MSVC/${CRT_VERSION}/x64/Microsoft.VC143.CRT` } },
    },
];

/** A record from what was downloaded; a download that differs from its pin refuses the record. */
export function buildWindowsRuntimeRecord(runtime: Runtime, download: { sha256: string; size: number }): PackageRecord {
    if (download.sha256 !== runtime.sha256) throw new Error(`${runtime.url}: sha256 differs from reviewed pin (${download.sha256})`);
    const record: PackageRecord = {
        name: runtime.name,
        version: runtime.version,
        platforms: { "windows-x64": { url: runtime.url, ...download, recipe: runtime.recipe } },
    };
    assertValidRecord(record);
    return record;
}

export async function buildWindowsRuntimeRecords(fetchFn: typeof fetch = fetch): Promise<PackageRecord[]> {
    const records: PackageRecord[] = [];
    for (const runtime of WINDOWS_RUNTIMES) {
        const res = await fetchFn(runtime.url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`GET ${runtime.url} failed: ${res.status} ${res.statusText}`);
        const bytes = await res.arrayBuffer();
        records.push(buildWindowsRuntimeRecord(runtime, { sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"), size: bytes.byteLength }));
    }
    return records;
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string }[];
    try {
        built = (await buildWindowsRuntimeRecords()).map((record) => ({ key: record.name, record }));
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        built = WINDOWS_RUNTIMES.map((runtime) => ({ key: runtime.name, error }));
    }
    return report(await writeRecords(built, { dryRun }), dryRun);
}

if (import.meta.main) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exit(1);
        },
    );
}
