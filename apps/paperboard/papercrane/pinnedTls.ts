// Every connection to another computer's daemon goes through here. The
// daemon's self-signed certificate is captured once, while pairing (trust on
// first use), and from then on it is the only certificate accepted for that
// computer: it is the sole trust anchor, and the exact fingerprint must match.
// Used by the Electron main process (Node) and the daemon's tunnels (Bun).
import * as crypto from "crypto";
import * as https from "https";
import type * as tls from "tls";

export function certFingerprint(certPem: string): string {
    return new crypto.X509Certificate(certPem).fingerprint256;
}

export function pinnedTlsOptions(certPem: string): tls.ConnectionOptions {
    const pinned = certFingerprint(certPem);
    return {
        ca: [certPem],
        rejectUnauthorized: true,
        // hostname is irrelevant: the certificate itself is the identity
        checkServerIdentity: (_host, cert) =>
            cert.fingerprint256 === pinned
                ? undefined
                : new Error(`Certificate fingerprint ${cert.fingerprint256} does not match the paired computer`),
    };
}

/** PEM of the certificate the peer presented on this TLS socket. */
export function peerCertPem(socket: tls.TLSSocket): string {
    const raw = socket.getPeerCertificate(true)?.raw;
    if (!raw?.length) throw new Error("The computer presented no TLS certificate");
    const pem = `-----BEGIN CERTIFICATE-----\n${raw.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
    certFingerprint(pem); // refuse anything that does not parse
    return pem;
}

export interface PinnedResponse {
    status: number;
    ok: boolean;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}

export interface PinnedRequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    /** response bodies past this are refused */
    maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * HTTPS request to a paired computer. cert is the pinned certificate;
 * null skips verification and is only for requests that carry no
 * credential (the pre-pairing reachability probe).
 */
export function pinnedRequest(url: string, cert: string | null, init: PinnedRequestInit = {}): Promise<PinnedResponse> {
    const target = new URL(url);
    if (target.protocol !== "https:") return Promise.reject(new Error(`Refusing non-TLS request to ${target.host}`));
    const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
    return new Promise((resolve, reject) => {
        const req = https.request(
            target,
            {
                method: init.method ?? "GET",
                headers: init.headers,
                agent: false,
                timeout: init.timeoutMs ?? 30_000,
                ...(cert ? pinnedTlsOptions(cert) : { rejectUnauthorized: false }),
            },
            (res) => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        req.destroy(new Error(`Response from ${target.host} exceeded ${maxBytes} bytes`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on("error", reject);
                res.on("end", () => {
                    const status = res.statusCode ?? 0;
                    resolve({ status, ok: status >= 200 && status < 300, headers: res.headers, body: Buffer.concat(chunks) });
                });
            },
        );
        req.on("timeout", () => req.destroy(Object.assign(new Error(`Request to ${target.host} timed out`), { name: "TimeoutError" })));
        req.on("error", reject);
        req.end(init.body);
    });
}
