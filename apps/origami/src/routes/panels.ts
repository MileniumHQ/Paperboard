import {
    getPanelsIndex,
    getPanel,
    savePanel,
    deletePanel,
    isValidPanelId,
    isValidPanelVersion,
    type PanelRecord,
} from "../panels";
import { jsonResponse, verifyAuth, type Env } from "../lib";
import {
    parseStoreManifest,
    storeImageExtension,
    storeScreenshotField,
    STORE_IMAGE_TYPES,
    STORE_MAX_ABOUT_BYTES,
    STORE_MAX_SCREENSHOT_BYTES,
    STORE_MAX_SCREENSHOTS,
    type StoreListing,
} from "../../../../packages/paperapi/src/storeListing";

// Upload caps, enforced BEFORE any body is buffered: a single oversized
// publish must refuse, not OOM the Worker. MAX_REQUEST_BYTES is the early
// Content-Length refusal envelope (archive + icon + metadata/boundary
// slack); the per-file stream caps below are the exact enforcement.
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ICON_BYTES = 1 * 1024 * 1024;
// store media: every screenshot slot (light + dark) at its cap, plus the
// about markdown; the per-file caps below are the exact enforcement
export const MAX_STORE_MEDIA_BYTES =
    STORE_MAX_SCREENSHOTS * 2 * STORE_MAX_SCREENSHOT_BYTES + STORE_MAX_ABOUT_BYTES;
export const MAX_REQUEST_BYTES =
    MAX_ARCHIVE_BYTES + MAX_ICON_BYTES + MAX_STORE_MEDIA_BYTES + 1024 * 1024;

// Reads a stream up to `cap` bytes; returns null the moment the cap is
// exceeded (the stream is cancelled, nothing further is buffered).
async function readWithCap(
    stream: ReadableStream<Uint8Array> | null,
    cap: number,
): Promise<Uint8Array | null> {
    if (!stream) return null;
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > cap) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

function overCapResponse(cap: string, limitBytes: number): Response {
    return jsonResponse(
        {
            error: `Upload exceeds the ${cap} limit (${limitBytes} bytes); refused before buffering`,
            cap,
            limitBytes,
        },
        413,
    );
}

// O3: the declared Content-Length refusal is bypassable (chunked transfer,
// absent header, or a NaN CL all skip it) and request.formData() buffers
// the WHOLE body before the per-file caps ever see bytes. This reader
// consumes the raw body under a hard cap and re-materializes a Request
// with a known-size body, so the buffering ceiling holds regardless of
// what the client declares. The original content-type is preserved so
// formData() parses the re-materialized body normally.
async function readBodyUnderCap(
    request: Request,
    cap: number,
): Promise<{ request: Request } | { refused: Response }> {
    const buffer = await readWithCap(request.body, cap);
    if (!buffer) {
        return { refused: overCapResponse("MAX_REQUEST_BYTES", cap) };
    }
    const buffered = new Request("https://origami.internal/upload", {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") || "" },
        body: buffer,
    });
    return { request: buffered };
}

const ICON_CONTENT_TYPES: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
};

export async function handlePanelsRoutes(
    request: Request,
    env: Env,
    url: URL,
    pathname: string,
    bucket: R2Bucket | undefined,
): Promise<Response | null> {
    // O10: record URLs come from the configured canonical origin. A
    // publish request's own origin is attacker-influenced (Host header);
    // baking it into stored records poisoned every client's download URL.
    const recordOrigin = env.PANEL_BASE_URL || url.origin;
    if (
        pathname === "/panels/index.json" ||
        pathname === "/panels" ||
        pathname === "/panels/"
    ) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }

        if (!env.PACKAGES) {
            return jsonResponse(
                { error: "PACKAGES KV binding not configured" },
                500,
            );
        }

        const index = await getPanelsIndex(env.PACKAGES);
        return jsonResponse(index);
    }

    if (pathname === "/panel/publish" || pathname === "/panels/publish") {
        if (request.method !== "POST") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }

        if (!verifyAuth(request, env)) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }

        if (!env.PACKAGES) {
            return jsonResponse(
                { error: "PACKAGES KV binding not configured" },
                500,
            );
        }

        const contentType = request.headers.get("content-type") || "";

        if (contentType.includes("multipart/form-data")) {
            // Early refusal on a declared Content-Length, then the hard
            // cap: the declared header is advisory (chunked/garbage CL
            // bypass it), the body reader below is the enforcement — the
            // whole request body is never buffered past MAX_REQUEST_BYTES.
            const contentLength = Number(request.headers.get("content-length"));
            if (
                Number.isFinite(contentLength) &&
                contentLength > MAX_REQUEST_BYTES
            ) {
                return overCapResponse("MAX_REQUEST_BYTES", MAX_REQUEST_BYTES);
            }

            const capped = await readBodyUnderCap(request, MAX_REQUEST_BYTES);
            if ("refused" in capped) return capped.refused;
            const formData = await capped.request.formData();
            const archiveFile = formData.get("archive") as File | null;
            const metadataRaw = formData.get("metadata") as string | null;

            if (!archiveFile || !metadataRaw) {
                return jsonResponse(
                    {
                        error: "Missing 'archive' file or 'metadata' field in formData",
                    },
                    400,
                );
            }

            let metadata: Partial<PanelRecord>;
            try {
                metadata = JSON.parse(metadataRaw);
            } catch {
                return jsonResponse(
                    { error: "Invalid metadata JSON" },
                    400,
                );
            }

            if (!metadata.id || !metadata.name || !metadata.version) {
                return jsonResponse(
                    {
                        error: "Metadata must include 'id', 'name', and 'version'",
                    },
                    400,
                );
            }

            // O1: id/version reach KV keys, R2 keys, and the download's
            // Content-Disposition header. `id: "s:index"` would become KV
            // key `panels:index` and overwrite the registry index; quotes
            // or control chars in version would break the download header.
            // The charset here matches the download/icon route regexes —
            // a published panel must be addressable by the routes that
            // serve it.
            if (!isValidPanelId(metadata.id)) {
                return jsonResponse(
                    {
                        error: "Invalid panel id: use a lowercase dotted identifier, at most 128 characters; library, settings and landing are reserved",
                    },
                    400,
                );
            }
            if (!isValidPanelVersion(metadata.version)) {
                return jsonResponse(
                    {
                        error: "Invalid panel version: use 1-64 characters of [a-zA-Z0-9._+-]",
                    },
                    400,
                );
            }
            // the registry stores the publisher's offline signature; it holds
            // no key and cannot make one, and clients refuse records without
            if (typeof metadata.signature !== "string" || !/^[A-Za-z0-9+/]{40,200}={0,2}$/.test(metadata.signature)) {
                return jsonResponse({ error: "Metadata must carry the release signature (sign with the Paperboard release key)" }, 400);
            }
            if (metadata.manifest?.id !== undefined && metadata.manifest.id !== metadata.id) {
                return jsonResponse({ error: "Manifest id must match the published panel id" }, 400);
            }

            // Store listing: validated in full BEFORE anything is written,
            // so a malformed listing cannot leave a half-published release.
            let storeMedia: {
                listing: Omit<StoreListing, "screenshots">;
                screenshots: {
                    alt?: string;
                    files: { theme: "light" | "dark"; ext: string; bytes: Uint8Array }[];
                }[];
            } | null = null;
            try {
                storeMedia = await readStoreUpload(metadata.manifest?.store, formData);
            } catch (err) {
                if (err instanceof StoreCapError) {
                    return overCapResponse(err.cap, err.limitBytes);
                }
                return jsonResponse(
                    { error: `Invalid store listing: ${(err as Error).message}` },
                    400,
                );
            }

            // Cap enforced by a stream reader: bytes past the cap are never
            // accumulated — the read aborts as soon as the limit is crossed.
            const archiveBuffer = await readWithCap(
                new Response(archiveFile).body,
                MAX_ARCHIVE_BYTES,
            );
            if (!archiveBuffer) {
                return overCapResponse("MAX_ARCHIVE_BYTES", MAX_ARCHIVE_BYTES);
            }
            const sizeBytes = archiveBuffer.byteLength;

            const hashBuffer = await crypto.subtle.digest(
                "SHA-256",
                archiveBuffer,
            );
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const sha256 = hashArray
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");

            const archiveKey = `panels/${metadata.id}/${metadata.id}-${metadata.version}.tar.gz`;

            if (bucket) {
                await bucket.put(archiveKey, archiveBuffer, {
                    httpMetadata: {
                        contentType: "application/gzip",
                    },
                    customMetadata: {
                        id: metadata.id,
                        version: metadata.version,
                        sha256,
                    },
                });
            }

            const iconFile = formData.get("icon") as File | null;
            let iconUrl: string | undefined = undefined;
            if (iconFile && bucket) {
                const iconExt = iconFile.name.endsWith(".svg")
                    ? "svg"
                    : iconFile.name.endsWith(".webp")
                      ? "webp"
                      : iconFile.name.endsWith(".png")
                        ? "png"
                        : null;
                if (!iconExt) {
                    return jsonResponse(
                        {
                            error: `Unsupported icon extension: '${iconFile.name}' must be .png, .svg, or .webp`,
                        },
                        400,
                    );
                }
                const iconKey = `panels/${metadata.id}/icon.${iconExt}`;
                const iconBuffer = await readWithCap(
                    new Response(iconFile).body,
                    MAX_ICON_BYTES,
                );
                if (!iconBuffer) {
                    return overCapResponse("MAX_ICON_BYTES", MAX_ICON_BYTES);
                }
                await bucket.put(iconKey, iconBuffer, {
                    httpMetadata: {
                        // O2: the content type is DERIVED from the
                        // extension, never taken from the publisher's part
                        // headers — a text/html icon would execute script
                        // on this origin when served back.
                        contentType: ICON_CONTENT_TYPES[iconExt],
                        cacheControl:
                            "public, max-age=31536000, immutable",
                    },
                });
                iconUrl = `${recordOrigin}/panel/${metadata.id}/icon`;
            }

            // media keys are per version: a republish never overwrites the
            // bytes an older record still references
            let store: StoreListing | undefined;
            if (storeMedia) {
                if (!bucket && storeMedia.screenshots.length > 0) {
                    return jsonResponse(
                        { error: "Store screenshots need the PANELS_BUCKET binding" },
                        500,
                    );
                }
                const screenshots: StoreListing["screenshots"] = [];
                for (const [index, shot] of storeMedia.screenshots.entries()) {
                    const urls: Partial<Record<"light" | "dark", string>> = {};
                    for (const file of shot.files) {
                        const name = `${index}-${file.theme}.${file.ext}`;
                        await bucket!.put(
                            `${storeMediaPrefix(metadata.id)}${metadata.version}/${name}`,
                            file.bytes,
                            {
                                httpMetadata: {
                                    // O2 again: derived from the extension
                                    contentType: STORE_IMAGE_TYPES[file.ext],
                                    cacheControl: "public, max-age=31536000, immutable",
                                },
                            },
                        );
                        urls[file.theme] = `${recordOrigin}/panel/${metadata.id}/media/${metadata.version}/${name}`;
                    }
                    screenshots.push({
                        light: urls.light!,
                        ...(urls.dark ? { dark: urls.dark } : {}),
                        ...(shot.alt ? { alt: shot.alt } : {}),
                    });
                }
                store = { ...storeMedia.listing, screenshots };
            }

            const record: PanelRecord = {
                id: metadata.id,
                name: metadata.name,
                version: metadata.version,
                description: metadata.description,
                // O11: publisher-supplied icon URLs are dropped — a record
                // field that sends clients off-registry is the same shape
                // the download-redirect fix removed. Icons are hosted here
                // (iconUrl above) or nowhere.
                iconUrl,
                archiveKey,
                sha256,
                signature: metadata.signature,
                sizeBytes,
                downloadUrl: `${recordOrigin}/panel/${metadata.id}/download`,
                updatedAt: new Date().toISOString(),
                ...(store ? { store } : {}),
                // an absent manifest is an absent manifest: no metadata
                // masquerading as one — a manifest-less record installs
                // as a coarse {id} record without publisher/version facts
                ...(metadata.manifest && typeof metadata.manifest === "object"
                    ? { manifest: metadata.manifest }
                    : {}),
            };

            await savePanel(env.PACKAGES, record);
            return jsonResponse({
                success: true,
                panel: record,
            });
        }

        const body = (await request.json()) as Partial<PanelRecord>;
        if (!body.id || !body.name || !body.version) {
            return jsonResponse(
                {
                    error: "Metadata must include 'id', 'name', and 'version'",
                },
                400,
            );
        }

        // Trust separation: the registry hashes what it hosts (multipart
        // path above computes sha256 server-side). A JSON record carrying a
        // publisher-typed downloadUrl and a self-supplied sha256 asks every
        // client to trust the same record that demands the download — that
        // shape is refused outright. Ship the archive via multipart upload.
        return jsonResponse(
            {
                error: "JSON publish cannot carry a download URL or checksum: upload the archive via multipart/form-data so the registry hashes what it hosts",
            },
            400,
        );
    }

    const downloadMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/download$/,
    );
    if (downloadMatch && downloadMatch[1]) {
        // O8: downloads are reads — any state-changing method is refused
        // rather than served with archive bytes
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const panelId = downloadMatch[1];
        const record = await getPanel(env.PACKAGES, panelId);

        if (!record) {
            return jsonResponse({ error: "Panel not found" }, 404);
        }

        if (bucket && record.archiveKey) {
            const object = await bucket.get(record.archiveKey);
            if (object) {
                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set("etag", object.httpEtag);
                headers.set("Content-Type", "application/gzip");
                headers.set(
                    "Content-Disposition",
                    `attachment; filename="${record.id}-${record.version}.tar.gz"`,
                );
                headers.set("Access-Control-Allow-Origin", "*");
                return new Response(object.body, { headers });
            }
        }

        // Publisher-typed redirect leg is DELETED: redirecting to a
        // record-carried URL asked every client to trust the same record
        // that demands the download (the accepted pre-Alpha-3 gap). The
        // registry serves only the archive it hashes (the archiveKey path
        // above). Legacy records whose archive lives off-registry no
        // longer resolve — re-publish via multipart upload. The message
        // matches the missing-record case above: a not-found here must
        // not distinguish "record exists, archive missing" to an
        // unauthenticated caller (O12).
        return jsonResponse({ error: "Panel not found" }, 404);
    }

    const iconMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/icon(?:\.(png|svg|webp))?$/,
    );
    if (iconMatch && iconMatch[1]) {
        if (request.method !== "GET") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const panelId = iconMatch[1];
        // O6: an icon is only served while its panel record is live — a
        // taken-down panel's branding must not outlive its record.
        const record = await getPanel(env.PACKAGES, panelId);
        if (!record) {
            return jsonResponse({ error: "Icon not found" }, 404);
        }
        if (bucket) {
            for (const ext of ["png", "svg", "webp"]) {
                const object = await bucket.get(
                    `panels/${panelId}/icon.${ext}`,
                );
                if (object) {
                    const headers = new Headers();
                    object.writeHttpMetadata(headers);
                    // icons share the library's origin and may be SVG
                    // documents: sandboxed with nothing to load, an icon
                    // navigated to as a top-level document cannot run
                    // script in the registry origin
                    headers.set(
                        "Content-Security-Policy",
                        "default-src 'none'; sandbox",
                    );
                    headers.set("X-Content-Type-Options", "nosniff");
                    headers.set(
                        "Cache-Control",
                        "public, max-age=86400",
                    );
                    headers.set("Access-Control-Allow-Origin", "*");
                    return new Response(object.body, { headers });
                }
            }
        }
        return jsonResponse({ error: "Icon not found" }, 404);
    }

    const mediaMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/media\/([a-zA-Z0-9._+-]+)\/([0-9]+-(?:light|dark)\.(?:png|webp|jpg|jpeg))$/,
    );
    if (mediaMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const [, panelId, version, name] = mediaMatch;
        // only media the live record references is served: a taken-down
        // panel or a superseded release does not keep its screenshots public
        const record = await getPanel(env.PACKAGES, panelId!);
        const referenced = record?.store?.screenshots?.some((shot) =>
            [shot.light, shot.dark].some((u) =>
                typeof u === "string" && u.endsWith(`/panel/${panelId}/media/${version}/${name}`),
            ),
        );
        if (!record || !referenced || !bucket) {
            return jsonResponse({ error: "Media not found" }, 404);
        }
        const object = await bucket.get(`${storeMediaPrefix(panelId!)}${version}/${name}`);
        if (!object) return jsonResponse({ error: "Media not found" }, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    const panelMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+?)(?:\.json)?$/,
    );
    if (panelMatch && panelMatch[1]) {
        if (request.method === "GET") {
            const panelId = panelMatch[1];
            const record = await getPanel(env.PACKAGES, panelId);

            if (!record) {
                return jsonResponse({ error: "Panel not found" }, 404);
            }

            return jsonResponse(record);
        }

        if (request.method === "DELETE") {
            if (!verifyAuth(request, env)) {
                return jsonResponse({ error: "Unauthorized" }, 401);
            }

            const panelId = panelMatch[1];
            const deleted = await deletePanel(
                env.PACKAGES,
                bucket,
                panelId,
            );

            if (!deleted) {
                return jsonResponse({ error: "Panel not found" }, 404);
            }

            // recoverable: the record survives under trash:<ts>:<id> and a
            // trashed archive copy — nothing here is destruction
            return jsonResponse({ success: true, deletedId: panelId, trashed: true });
        }

        return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    return null;
}

export function storeMediaPrefix(panelId: string): string {
    return `panels/${panelId}/media/`;
}

class StoreCapError extends Error {
    constructor(
        readonly cap: string,
        readonly limitBytes: number,
    ) {
        super(`${cap} exceeded`);
    }
}

// Reads the listing's text and images out of the publish form. Every file
// the manifest names must be present; a part the manifest does not name is
// ignored, never stored.
async function readStoreUpload(rawStore: unknown, formData: FormData) {
    const manifest = parseStoreManifest(rawStore);
    if (!manifest) return null;

    let about: string | undefined;
    if (manifest.about) {
        const part = formData.get("about");
        if (typeof part !== "string" || !part.trim()) {
            throw new Error(`about names ${manifest.about} but the upload has no 'about' text`);
        }
        const bytes = new TextEncoder().encode(part).byteLength;
        if (bytes > STORE_MAX_ABOUT_BYTES) {
            throw new StoreCapError("STORE_MAX_ABOUT_BYTES", STORE_MAX_ABOUT_BYTES);
        }
        about = part;
    }

    const screenshots = [];
    for (const [index, shot] of manifest.screenshots.entries()) {
        const files = [];
        for (const theme of ["light", "dark"] as const) {
            const declared = shot[theme];
            if (!declared) continue;
            const field = storeScreenshotField(index, theme);
            const part = formData.get(field);
            if (!part || typeof part === "string") {
                throw new Error(`screenshot ${declared} is missing from the upload (${field})`);
            }
            const ext = storeImageExtension(declared)!;
            const bytes = await readWithCap(new Response(part).body, STORE_MAX_SCREENSHOT_BYTES);
            if (!bytes) {
                throw new StoreCapError("STORE_MAX_SCREENSHOT_BYTES", STORE_MAX_SCREENSHOT_BYTES);
            }
            files.push({ theme, ext, bytes });
        }
        screenshots.push({ ...(shot.alt ? { alt: shot.alt } : {}), files });
    }

    return {
        listing: {
            ...(about ? { about } : {}),
            services: manifest.services,
            credits: manifest.credits,
            requirements: manifest.requirements,
        },
        screenshots,
    };
}
