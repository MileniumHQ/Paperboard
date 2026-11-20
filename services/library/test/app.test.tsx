import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
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

// Store listings render safely.
describe("store listings render safely", () => {
    const imageSources = () => [...document.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");

    test("a registry listing renders only images the registry hosts, from the page's own origin", async () => {
        const shot = "/panel/dev.example.clock/media/1.2.0/0-light.png";
        serveIndex({
            [CLOCK.id]: {
                ...CLOCK,
                iconUrl: `https://origami.ariapis.com/panel/${CLOCK.id}/icon`,
                store: {
                    screenshots: [
                        { light: "javascript:alert(1)", alt: "Hostile" },
                        { light: "https://cdn.example.test/shot.png", alt: "Off-registry shot" },
                        { light: `https://origami.ariapis.com${shot}`, dark: "https://cdn.example.test/dark.png", alt: "Real shot" },
                        { light: `${window.location.origin}/panel/dev.example.clock/media/1.2.0/1-light.png`, alt: "Same-origin shot" },
                        { light: "data:image/png;base64,iVBORw0KGgo=", alt: "Data image from the registry" },
                    ],
                },
            },
        });
        open(`/library/?panel=${CLOCK.id}`);
        await screen.findByAltText("Real shot");
        const sources = imageSources();
        expect(sources).toContain(shot);
        expect(sources).toContain("/panel/dev.example.clock/media/1.2.0/1-light.png");
        expect(sources).toContain(`/panel/${CLOCK.id}/icon`);
        expect(sources.filter((s) => !s.startsWith("/panel/"))).toEqual([]);
        for (const alt of ["Hostile", "Off-registry shot", "Data image from the registry"]) expect(screen.queryByAltText(alt)).toBeNull();
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
