// Publishes AlliedModders' Metamod:Source and SourceMod, the plugin platform
// of Source dedicated servers (Team Fortress 2 and others).
// bun run update:sourcemod -- --dry-run prints without writing.
// Trust: AlliedModders publishes no checksums. Each stable-branch build is
// pinned below from its official drop (mms.alliedmods.net/mmsdrop,
// sm.alliedmods.net/smdrop); every download is hashed and any change refuses
// the whole record. A newer build is a reviewed pin, not a refresh.
// Both packages carry the archive's addons/ (and SourceMod's cfg/) under bin/.
// The Game Server panel copies them into a server's own addons folder, which
// SourceMod then owns: its configs, data and plugins are the user's.
import { createHash } from "node:crypto";
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, type PackageRecipe, type PackageRecord, type PlatformKey } from "./lib/records";

interface Build {
    name: string;
    version: string;
    files: Partial<Record<PlatformKey, { url: string; sha256: string; recipe: PackageRecipe }>>;
}

const mms = (file: string) => `https://mms.alliedmods.net/mmsdrop/1.12/${file}`;
const sm = (file: string) => `https://sm.alliedmods.net/smdrop/1.12/${file}`;

export const SOURCEMOD_BUILDS: readonly Build[] = [
    {
        name: "metamod-source",
        version: "1.12.0-git1228",
        files: {
            "linux-x64": { url: mms("mmsource-1.12.0-git1228-linux.tar.gz"), sha256: "29f60bb40154fb4d9d0020ee35347c8359eeaf493dc4fdd7182873cf51f83f47", recipe: { unpack: "tar", take: { "bin/addons": "addons" } } },
            "windows-x64": { url: mms("mmsource-1.12.0-git1228-windows.zip"), sha256: "39fadfe17f231064b663e9db8cdac7a2457f7a318ccfbad8d7a70986d081be49", recipe: { unpack: "zip", take: { "bin/addons": "addons" } } },
        },
    },
    {
        name: "sourcemod",
        version: "1.12.0-git7259",
        files: {
            "linux-x64": { url: sm("sourcemod-1.12.0-git7259-linux.tar.gz"), sha256: "1025717c46119c15c6e73fd9b4a190fd8da480987307d133e1281eb9a6f5c91c", recipe: { unpack: "tar", take: { "bin/addons": "addons", "bin/cfg": "cfg" } } },
            "windows-x64": { url: sm("sourcemod-1.12.0-git7259-windows.zip"), sha256: "5711ce719fa2f3fa4a762702f55c7906aa951690c739499beb5f2b62a9161362", recipe: { unpack: "zip", take: { "bin/addons": "addons", "bin/cfg": "cfg" } } },
        },
    },
];

/** A record from what was downloaded, by url; any download that differs from its pin refuses the record. */
export function buildSourcemodRecord(build: Build, downloads: Readonly<Record<string, { sha256: string; size: number }>>): PackageRecord {
    const platforms: PackageRecord["platforms"] = {};
    for (const [key, file] of Object.entries(build.files) as [PlatformKey, NonNullable<Build["files"][PlatformKey]>][]) {
        const observed = downloads[file.url];
        if (!observed) throw new Error(`${file.url}: download missing`);
        if (observed.sha256 !== file.sha256) throw new Error(`${file.url}: sha256 differs from reviewed pin (${observed.sha256})`);
        platforms[key] = { url: file.url, ...observed, recipe: file.recipe };
    }
    const record: PackageRecord = { name: build.name, version: build.version, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestSourcemodRecords(fetchFn: typeof fetch = fetch): Promise<PackageRecord[]> {
    const downloads: Record<string, { sha256: string; size: number }> = {};
    for (const build of SOURCEMOD_BUILDS) {
        for (const file of Object.values(build.files)) {
            const res = await fetchFn(file!.url, { signal: AbortSignal.timeout(120_000) });
            if (!res.ok) throw new Error(`GET ${file!.url} failed: ${res.status} ${res.statusText}`);
            const bytes = await res.arrayBuffer();
            downloads[file!.url] = { sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"), size: bytes.byteLength };
        }
    }
    return SOURCEMOD_BUILDS.map((build) => buildSourcemodRecord(build, downloads));
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string }[];
    try {
        built = (await buildLatestSourcemodRecords()).map((record) => ({ key: record.name, record }));
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        built = SOURCEMOD_BUILDS.map((build) => ({ key: build.name, error }));
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
