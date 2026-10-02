// Readiness is no longer "the code ran": the shell holds its loader until
// fonts and images have settled. jsdom cannot load images, so these tests
// pin both the real wait path (with a stubbed decode) and the bounded
// fallback that keeps a non-rendering host from hanging forever.
import { afterEach, describe, expect, test, vi } from "vitest";
import { waitForContentPainted } from "../../../../packages/paperapi/src/paintReady";

const originalDecode = (HTMLImageElement.prototype as any).decode;

function stubDecode(decode: () => Promise<void>) {
    (HTMLImageElement.prototype as any).decode = decode;
}

afterEach(() => {
    if (originalDecode === undefined) {
        delete (HTMLImageElement.prototype as any).decode;
    } else {
        (HTMLImageElement.prototype as any).decode = originalDecode;
    }
    document.body.innerHTML = "";
});

describe("waitForContentPainted", () => {
    test("resolves in a host that cannot observe image loading instead of hanging", async () => {
        // jsdom parses <img> but never loads it and exposes no decode();
        // waiting on load would stall the reveal forever.
        expect(typeof (HTMLImageElement.prototype as any).decode).toBe("undefined");
        const img = document.createElement("img");
        img.src = "/panel/panel.a/icon.png";
        document.body.appendChild(img);

        await waitForContentPainted({ timeoutMs: 1_000 });
        expect(img.isConnected).toBe(true);
    });

    test("waits for a decoding image before resolving", async () => {
        let resolveDecode!: () => void;
        const decode = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveDecode = resolve;
                }),
        );
        stubDecode(decode);
        const img = document.createElement("img");
        img.src = "data:image/png;base64,AQI=";
        document.body.appendChild(img);

        let done = false;
        const wait = waitForContentPainted({ timeoutMs: 2_000 }).then(() => {
            done = true;
        });
        await Promise.resolve();
        expect(decode).toHaveBeenCalledTimes(1);
        expect(done).toBe(false);
        resolveDecode();
        await wait;
        expect(done).toBe(true);
    });

    test("a broken image never blocks the reveal", async () => {
        stubDecode(() => Promise.reject(new Error("decode failed")));
        const img = document.createElement("img");
        img.src = "/gone.png";
        document.body.appendChild(img);

        await waitForContentPainted({ timeoutMs: 1_000 });
        // reaching here at all is the assertion: no rejection escaped
        expect(true).toBe(true);
    });

    test("an offscreen lazy image does not stall the reveal", async () => {
        // a lazy, not-yet-loaded image is deliberately deferred; waiting on
        // decode would block first paint
        const decode = vi.fn(() => new Promise<void>(() => {}));
        stubDecode(decode);
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = "/offscreen.png";
        document.body.appendChild(img);

        await waitForContentPainted({ timeoutMs: 1_000 });
        expect(decode).not.toHaveBeenCalled();
    });

    test("an image that never settles is bounded by the timeout", async () => {
        stubDecode(() => new Promise<void>(() => {}));
        const img = document.createElement("img");
        img.src = "/slow.png";
        document.body.appendChild(img);

        const started = Date.now();
        await waitForContentPainted({ timeoutMs: 30 });
        expect(Date.now() - started).toBeLessThan(1_000);
    });
});
