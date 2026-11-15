import semver from "semver";

// version compare with coerce, numeric fallback for garbage
export function semverGt(a: string, b: string): boolean {
    // plain dotted numbers compare every segment: coerce would cut
    // Chromium-style 0.20.1.2 to 0.20.1 and never see the update
    const dotted = /^v?\d+(\.\d+)*$/;
    if (dotted.test(a ?? "") && dotted.test(b ?? "")) {
        const pa = a.replace(/^v/, "").split(".").map(Number);
        const pb = b.replace(/^v/, "").split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pa[i] ?? 0) - (pb[i] ?? 0);
            if (d !== 0) return d > 0;
        }
        return false;
    }
    const ca = semver.coerce(a ?? "");
    const cb = semver.coerce(b ?? "");
    if (ca && cb) return semver.gt(ca, cb);
    const parse = (v: string) =>
        (v || "")
            .replace(/^[^0-9]*/, "")
            .split(".")
            .map((n) => {
                const num = Number(n);
                return Number.isFinite(num) ? num : 0;
            });
    const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
    const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
    if (aMaj !== bMaj) return aMaj > bMaj;
    if (aMin !== bMin) return aMin > bMin;
    return aPat > bPat;
}
