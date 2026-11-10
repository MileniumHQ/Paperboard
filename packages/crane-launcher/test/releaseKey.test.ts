import { describe, expect, test } from "bun:test";
import published from "./fixtures/published-0.2.2-linux-x64.json";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "../../../apps/paperboard/papercrane/releaseSignature";

// replaces the character at `index` with the next one in the field's alphabet
function alter(value: string, index: number, alphabet: string): string {
    const next = alphabet[(alphabet.indexOf(value[index]) + 1) % alphabet.length];
    return value.slice(0, index) + next + value.slice(index + 1);
}

const HEX = "0123456789abcdef";

// The bundled key verifies a real published release.
describe("the bundled key verifies a real published release", () => {
    test("the release key and signing message verify the published linux-x64 0.2.2 entry", () => {
        expect(verifyRelease(releaseMessage.crane(published.version, published.sha256), published.signature, RELEASE_PUBLIC_KEY)).toBe(true);
    });

    test("changing the version, any character of the sha256 or any byte of the signature fails verification", () => {
        const verifies = (version: string, sha256: string, signature: string) => verifyRelease(releaseMessage.crane(version, sha256), signature, RELEASE_PUBLIC_KEY);
        expect(verifies("0.2.3", published.sha256, published.signature)).toBe(false);
        for (let i = 0; i < published.sha256.length; i++) {
            expect({ i, ok: verifies(published.version, alter(published.sha256, i, HEX), published.signature) }).toEqual({ i, ok: false });
        }
        // every byte of the signature itself (a base64 character also
        // carries padding bits a decoder ignores, so bytes are what count)
        const signature = Buffer.from(published.signature, "base64");
        expect(signature.length).toBe(64);
        for (let i = 0; i < signature.length; i++) {
            const changed = Buffer.from(signature);
            changed[i] ^= 0x01;
            expect({ i, ok: verifies(published.version, published.sha256, changed.toString("base64")) }).toEqual({ i, ok: false });
        }
        // and the same signature under another kind's message never verifies
        expect(verifyRelease(releaseMessage.panel("crane", published.version, published.sha256), published.signature, RELEASE_PUBLIC_KEY)).toBe(false);
    });
});
