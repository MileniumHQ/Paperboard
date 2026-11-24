// Cloudflare Access guards /dashboard at the edge. The worker checks Access's
// signed token on every dashboard request as well, so a route or Access
// application that drifts can't open the issues to the internet: no valid
// token for this application, no dashboard.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

export interface AccessConfig {
    /** the team domain, like mileniumhq.cloudflareaccess.com */
    teamDomain: string;
    /** the Access application's audience tag */
    aud: string;
}

interface Jwk extends JsonWebKey {
    kid?: string;
}

// a team's signing keys rotate every few weeks, with the old key kept a while
const KEYS_TTL = 10 * 60 * 1000;
let cached: { teamDomain: string; at: number; keys: Map<string, CryptoKey> } | null = null;

async function fetchKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access keys answered HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys)) throw new Error("Access keys came back without keys");
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys) {
        if (!jwk.kid || jwk.kty !== "RSA") continue;
        keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    cached = { teamDomain, at: Date.now(), keys };
    return keys;
}

// an unknown key id reads the keys again once, for a key Access just rotated in
async function keyFor(teamDomain: string, kid: string): Promise<CryptoKey | undefined> {
    const fresh = cached && cached.teamDomain === teamDomain && Date.now() - cached.at < KEYS_TTL;
    const keys = fresh ? cached!.keys : await fetchKeys(teamDomain);
    return keys.get(kid) ?? (fresh ? (await fetchKeys(teamDomain)).get(kid) : undefined);
}

function decodePart(part: string): Uint8Array {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

function jsonPart(part: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(new TextDecoder().decode(decodePart(part)));
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
        // quiet: a token that isn't JSON is refused like any other bad token
        return null;
    }
}

/**
 * The signed-in email when the request carries a valid Access token for
 * this application, or null. Throws only when Access's keys can't be read,
 * which the caller shows as the service being unavailable.
 */
export async function accessEmail(request: Request, config: AccessConfig): Promise<string | null> {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
    const header = jsonPart(rawHeader);
    const payload = jsonPart(rawPayload);
    if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return null;

    const key = await keyFor(config.teamDomain, header.kid);
    if (!key) return null;
    let signature: Uint8Array;
    try {
        signature = decodePart(rawSignature);
    } catch {
        // quiet: a signature that isn't base64url is refused like a wrong one
        return null;
    }
    const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))) return null;

    const now = Date.now() / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(config.aud)) return null;
    if (payload.iss !== `https://${config.teamDomain}`) return null;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
    return typeof payload.email === "string" && payload.email ? payload.email : null;
}
