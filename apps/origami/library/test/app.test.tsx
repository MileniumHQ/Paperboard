import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import PanelLibraryApp from "../src/App";
import { createLibraryBridge, type LibraryBridge } from "../src/bridge";
import { shell, type Shell } from "./helpers/shell";

// A real loopback registry: the library reads /panels/index.json from its
// own origin, so the page's relative fetch resolves against this server the
// way a browser resolves it against the registry origin it was served from.
type IndexAnswer = (res: ServerResponse) => void;
let answerIndex: IndexAnswer;
let indexRequests = 0;
let onIndexRequest: (() => void) | undefined;
let server: Server;
let origin: string;
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
    server = createServer((req, res) => {
        if (req.url !== "/panels/index.json") {
            res.writeHead(404).end();
            return;
        }
        indexRequests++;
        onIndexRequest?.();
        answerIndex(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
        nativeFetch(new URL(typeof input === "string" || input instanceof URL ? input : input.url, `${origin}/library/`), init)) as typeof fetch;
});

afterAll(async () => {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

let host: Shell;
let bridge: LibraryBridge | undefined;

afterEach(() => {
    cleanup();
    bridge?.dispose();
    bridge = undefined;
    onIndexRequest = undefined;
    indexRequests = 0;
    window.history.replaceState(null, "", "/library/");
});

function serveIndex(index: unknown): void {
    answerIndex = (res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(index));
}

function open(path: string, installed: unknown[] = []) {
    window.history.replaceState(null, "", path);
    host = shell();
    bridge = createLibraryBridge(host);
    host.reply({ type: "paperboard:library-connected", theme: "light", installed });
    const b = bridge;
    return render(() => <PanelLibraryApp bridge={b} />);
}

const CLOCK = {
    id: "dev.example.clock",
    name: "Clock",
    version: "1.2.0",
    description: "A clock.",
    iconUrl: "/panel/dev.example.clock/icon",
};

const installs = () => host.sent.filter((m) => m.type === "paperboard:library-install");

// Installs round-trip through the shell, with a bound, and failures are shown.
describe("installs round-trip through the shell, and failures are shown", () => {
    test("a shell failure is shown inline, and a success turns the action into Open", async () => {
        serveIndex({ [CLOCK.id]: CLOCK });
        open(`/library/?panel=${CLOCK.id}`);
        fireEvent.click(await screen.findByRole("button", { name: /Install/ }));

        await waitFor(() => expect(installs()).toHaveLength(1));
        expect(installs()[0]).toMatchObject({ panelId: CLOCK.id });
        host.reply({ type: "paperboard:library-install-result", requestId: installs()[0]!.requestId, panelId: CLOCK.id, ok: false, error: "Disk full" });
        expect((await screen.findByRole("alert")).textContent).toBe("Couldn't install Clock: Disk full");

        // the failure leaves the action usable: a retry is a new request
        fireEvent.click(await screen.findByRole("button", { name: /Install/ }));
        await waitFor(() => expect(installs()).toHaveLength(2));
        expect(screen.queryByRole("alert")).toBeNull();
        // the shell answers the way Paperboard does: the result, then the new installed list
        host.reply({ type: "paperboard:library-install-result", requestId: installs()[1]!.requestId, panelId: CLOCK.id, ok: true });
        host.reply({ type: "paperboard:library-installed", theme: "light", installed: [{ id: CLOCK.id, name: "Clock", version: "1.2.0" }] });

        fireEvent.click(await screen.findByRole("button", { name: /Open/ }));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(host.sent.filter((m) => m.type === "paperboard:library-open")).toEqual([{ type: "paperboard:library-open", panelId: CLOCK.id }]);
        expect(installs()).toHaveLength(2);
    });
});

// Store listings render safely.
describe("store listings render safely", () => {
    const imageSources = () => [...document.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");

    test("a registry listing never renders an unsafe URL as an image", async () => {
        serveIndex({
            [CLOCK.id]: {
                ...CLOCK,
                store: {
                    screenshots: [
                        { light: "javascript:alert(1)", alt: "Hostile" },
                        { light: "https://cdn.example.test/shot.png", dark: "javascript:alert(2)", alt: "Real shot" },
                        { light: "data:image/png;base64,iVBORw0KGgo=", alt: "Data image from the registry" },
                    ],
                },
            },
        });
        open(`/library/?panel=${CLOCK.id}`);
        await screen.findByAltText("Real shot");
        const sources = imageSources();
        expect(sources).toContain("https://cdn.example.test/shot.png");
        expect(sources.filter((s) => /^\s*(javascript|data):/i.test(s))).toEqual([]);
        expect(screen.queryByAltText("Hostile")).toBeNull();
    });

    test("an installed panel the registry does not list never renders an unsafe URL from the shell", async () => {
        serveIndex({});
        const LOCAL = "dev.local.tool";
        open(`/library/?panel=${LOCAL}`, [{ id: LOCAL, name: "Local Tool", version: "0.1.0" }]);
        const media = () => host.sent.filter((m) => m.type === "paperboard:library-media");
        await waitFor(() => expect(media().some((m) => m.full === true)).toBe(true));
        const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        for (const request of media()) {
            host.reply({
                type: "paperboard:library-media-result",
                requestId: request.requestId,
                panelId: LOCAL,
                ok: true,
                icon: "javascript:alert(1)",
                store: {
                    screenshots: [
                        { light: "javascript:alert(2)", alt: "Hostile" },
                        { light: pixel, dark: "javascript:alert(3)", alt: "Own screenshot" },
                        { light: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", alt: "SVG document" },
                    ],
                },
            });
        }
        await screen.findByAltText("Own screenshot");
        const sources = imageSources();
        expect(sources).toContain(pixel);
        expect(sources.filter((s) => /^\s*javascript:/i.test(s) || s.startsWith("data:image/svg"))).toEqual([]);
        expect(screen.queryByAltText("Hostile")).toBeNull();
        expect(screen.queryByAltText("SVG document")).toBeNull();
    });
});

// Readiness is signalled and never hangs.
describe("readiness is signalled once the registry load settles", () => {
    const readies = () => host.sent.filter((m) => m.type === "paperboard:library-ready");

    test("an embedded library sends ready only after the registry answers", async () => {
        let release!: () => void;
        const requested = new Promise<void>((resolve) => (onIndexRequest = resolve));
        answerIndex = (res) => {
            release = () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ [CLOCK.id]: CLOCK }));
        };
        open("/library/");
        await requested;
        expect(indexRequests).toBe(1);
        expect(readies()).toEqual([]);
        release();
        await waitFor(() => expect(readies()).toHaveLength(1));
        await screen.findByText("Clock");
        expect(readies()).toHaveLength(1);
    });

    test("a registry that fails still settles, and the library says ready with the failure shown", async () => {
        answerIndex = (res) => res.writeHead(503).end("unavailable");
        open("/library/");
        await waitFor(() => expect(readies()).toHaveLength(1));
        expect(screen.getAllByText("Couldn't load library").length).toBeGreaterThan(0);
    });
});
