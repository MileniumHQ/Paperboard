import { describe, expect, it } from "bun:test";
import { buildLatestLibcurlGnutlsRecord, buildLibcurlGnutlsRecord, LIBCURL_GNUTLS_BUILD } from "../scripts/update-libcurl-gnutls";
import { assertValidRecord } from "../scripts/lib/records";

// The pin is a reviewed upstream fact: the record carries only bytes that
// hash to it, and only for the one platform Arch builds.
describe("update-libcurl-gnutls", () => {
    it("builds the Linux x64 recipe from the reviewed pin", () => {
        const record = buildLibcurlGnutlsRecord({ sha256: LIBCURL_GNUTLS_BUILD.sha256, size: 461453 });
        assertValidRecord(record);
        expect(record.name).toBe("libcurl-gnutls");
        expect(record.version).toBe("8.23.0-2");
        expect(Object.keys(record.platforms)).toEqual(["linux-x64"]);
        expect(record.platforms["linux-x64"]).toEqual({
            url: "https://archive.archlinux.org/packages/l/libcurl-gnutls/libcurl-gnutls-8.23.0-2-x86_64.pkg.tar.zst",
            sha256: LIBCURL_GNUTLS_BUILD.sha256,
            size: 461453,
            recipe: { unpack: "tar", take: { "bin/libcurl-gnutls.so.4": "usr/lib/libcurl-gnutls.so.4.8.0" } },
        });
    });
    it("hashes the fetched bytes and refuses anything else", async () => {
        await expect(buildLatestLibcurlGnutlsRecord((async () => new Response("changed")) as unknown as typeof fetch)).rejects.toThrow(/reviewed pin/);
        await expect(buildLatestLibcurlGnutlsRecord((async () => new Response("missing", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    });
});
