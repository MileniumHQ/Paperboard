import { timingSafeEqual } from "crypto";

// constant-time credential comparison; length-unequal inputs fail without
// timing leakage beyond the length check itself
export function secretsMatch(a: string, b: string): boolean {
    const ab = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}
