// Publishes Arch Linux's libcurl-gnutls for Source dedicated servers.
// bun run update:libcurl-gnutls -- --dry-run prints without writing.
// Valve's Linux servers (Team Fortress 2's replay_srv.so) link
// libcurl-gnutls.so.4, which Debian and Ubuntu install by default but Arch,
// SteamOS and Fedora don't. The Game Server panel installs this package only
// when the computer's own libraries leave that name unresolved.
// Trust: the archive is pinned below. Its sha256 was taken after checking
// Arch's detached signature (Pierre Schmitz, Arch Linux master key) against
// /usr/share/pacman/keyrings/archlinux.gpg; any change refuses the record.
// archive.archlinux.org never rewrites a published file, so a new version
// is a reviewed pin, not a refresh.
// Its other libraries (gnutls, ngtcp2, nghttp2/3, libssh2, krb5, …) are
// curl's own dependencies on Arch; elsewhere the panel names whatever ldd
// still can't find.
import { createHash } from "node:crypto";
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, type PackageRecord } from "./lib/records";

export const LIBCURL_GNUTLS_BUILD = {
    version: "8.23.0-2",
    file: "libcurl-gnutls-8.23.0-2-x86_64.pkg.tar.zst",
    sha256: "204a6de0407860fd16bfcd93a2c3eedf9f1bb505a38549ad086fd5f717552c25",
    // the package's other names are symlinks to this file
    library: "usr/lib/libcurl-gnutls.so.4.8.0",
} as const;

export const libcurlGnutlsUrl = (file: string) => `https://archive.archlinux.org/packages/l/libcurl-gnutls/${file}`;

export function buildLibcurlGnutlsRecord(download: { sha256: string; size: number }): PackageRecord {
    const build = LIBCURL_GNUTLS_BUILD;
    if (download.sha256 !== build.sha256) throw new Error(`${build.file}: sha256 differs from reviewed pin (${download.sha256})`);
    const record: PackageRecord = {
        name: "libcurl-gnutls",
        version: build.version,
        platforms: {
            "linux-x64": {
                url: libcurlGnutlsUrl(build.file),
                ...download,
                recipe: { unpack: "tar", take: { "bin/libcurl-gnutls.so.4": build.library } },
            },
        },
    };
    assertValidRecord(record);
    return record;
}

export async function buildLatestLibcurlGnutlsRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const url = libcurlGnutlsUrl(LIBCURL_GNUTLS_BUILD.file);
    const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
    const bytes = await res.arrayBuffer();
    return buildLibcurlGnutlsRecord({ sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"), size: bytes.byteLength });
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "libcurl-gnutls", record: await buildLatestLibcurlGnutlsRecord() };
    } catch (err) {
        built = { key: "libcurl-gnutls", error: err instanceof Error ? err.message : String(err) };
    }
    return report(await writeRecords([built], { dryRun }), dryRun);
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
