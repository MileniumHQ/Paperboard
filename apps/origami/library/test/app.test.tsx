// The library's two modes are user-visible contracts: embedded installs go
// through the shell signal round-trip, and a standalone browser load must
// download the registry archive, not pretend to install.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { PaperProvider } from "@mileniumhq/paperui";
import PanelLibraryApp from "../src/App";
import { createLibraryBridge, type BridgeHost } from "../src/bridge";

function createFakeHost() {
    const sent: any[] = [];
    let listener: ((data: unknown) => void) | null = null;
    const host: BridgeHost = {
        send(data) {
            sent.push(data);
        },
        listen(callback) {
            listener = callback;
            return () => {
                listener = null;
            };
        },
    };
    return {
        host,
        sent,
        receive(data: unknown) {
            if (!listener) throw new Error("bridge is not listening");
            listener(data);
        },
    };
}

function registryResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

const REGISTRY = {
    "panel.a": {
        name: "Alpha",
        version: "1.0.0",
        description: "Alpha words",
    },
};

function renderApp(bridge: ReturnType<typeof createLibraryBridge>) {
    return render(() => (
        <PaperProvider>
            <PanelLibraryApp bridge={bridge} />
        </PaperProvider>
    ));
}

function mockRegistry() {
    const fetchMock = vi.fn(async () => registryResponse(REGISTRY));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => {
    window.history.replaceState(null, "", "/library/");
    mockRegistry();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("PanelLibraryApp", () => {
    test("a card navigates to the panel's own linkable page, and the breadcrumb returns", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, {
            handshakeTimeoutMs: 20,
        });
        fake.receive({ type: "paperboard:library-connected" });
        renderApp(bridge);

        fireEvent.click(await screen.findByText("Alpha"));
        expect(window.location.search).toBe("?panel=panel.a");
        expect(screen.getByRole("heading", { level: 1, name: "Alpha" })).toBeDefined();
        expect(screen.getByText("Alpha words")).toBeDefined();
        // no dialog: the grid page is replaced by the panel page
        expect(screen.queryByRole("dialog")).toBeNull();

        const crumb = screen.getByRole("link", { name: "Library" });
        expect(crumb.getAttribute("href")).toBe("./");
        fireEvent.click(crumb);
        expect(window.location.search).toBe("");
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
        expect(await screen.findByText("Alpha")).toBeDefined();
        bridge.dispose();
    });

    test("a shared panel URL opens straight onto that panel's page", async () => {
        window.history.replaceState(null, "", "/library/?panel=panel.a");
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        expect(
            await screen.findByRole("heading", { level: 1, name: "Alpha" }),
        ).toBeDefined();
        bridge.dispose();
    });

    test("the embedded library tells the shell it is ready after the registry settles", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host, { handshakeTimeoutMs: 20 });
        fake.receive({ type: "paperboard:library-connected", installed: [] });
        renderApp(bridge);

        await waitFor(() =>
            expect(fake.sent).toContainEqual({ type: "paperboard:library-ready" }),
        );
        bridge.dispose();
    });

    test("browser back from a panel page returns to the grid", async () => {
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        fireEvent.click(await screen.findByText("Alpha"));
        expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
        window.history.back();
        await waitFor(() =>
            expect(screen.queryByRole("heading", { level: 1 })).toBeNull(),
        );
        expect(window.location.search).toBe("");
        bridge.dispose();
    });

    test("an unknown panel URL is a not-found page, not the grid", async () => {
        window.history.replaceState(null, "", "/library/?panel=panel.missing");
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        expect(await screen.findByText("Panel not found")).toBeDefined();
        expect(screen.queryByText("Alpha")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Browse the library" }));
        expect(await screen.findByText("Alpha")).toBeDefined();
        bridge.dispose();
    });

    test("the panel page renders the published store listing", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                registryResponse({
                    "panel.a": {
                        ...REGISTRY["panel.a"],
                        publisher: "Paperboard",
                        sizeBytes: 3 * 1024 * 1024,
                        store: {
                            about: "## Features\n\nRuns **locally**.",
                            screenshots: [
                                {
                                    light: "/panel/panel.a/media/1.0.0/0-light.png",
                                    dark: "/panel/panel.a/media/1.0.0/0-dark.png",
                                    alt: "Chat view",
                                },
                                { light: "javascript:alert(1)" },
                            ],
                            services: [{ name: "Ollama", detail: "Downloading models" }],
                            credits: [{ name: "Discord.js", detail: "Providing the backend engine" }],
                            requirements: [{ name: "RAM", detail: "16 GB" }],
                        },
                    },
                }),
            ),
        );
        window.history.replaceState(null, "", "/library/?panel=panel.a");
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        await screen.findByRole("heading", { level: 1, name: "Alpha" });
        expect(screen.getByText("Paperboard")).toBeDefined();
        expect(screen.getByText("3.0 MB")).toBeDefined();
        expect(screen.getByText("v1.0.0")).toBeDefined();
        expect(screen.getByRole("heading", { name: "Features" })).toBeDefined();

        // one frame, in both themes; the unsafe URL never renders
        const shots = screen.getAllByRole("img", { name: "Chat view" });
        expect(shots.map((img) => img.getAttribute("src"))).toEqual([
            "/panel/panel.a/media/1.0.0/0-light.png",
            "/panel/panel.a/media/1.0.0/0-dark.png",
        ]);
        expect(document.querySelector('img[src^="javascript"]')).toBeNull();

        for (const [title, subtitle, name, detail] of [
            ["Services used", "Services that this panel contacts.", "Ollama", "Downloading models"],
            ["Special thanks", "Projects that make this panel possible.", "Discord.js", "Providing the backend engine"],
            ["Recommended system", "Recommended minimum system specs.", "RAM", "16 GB"],
        ]) {
            expect(screen.getByRole("heading", { name: title })).toBeDefined();
            expect(screen.getByText(subtitle)).toBeDefined();
            expect(screen.getByRole("rowheader", { name })).toBeDefined();
            expect(screen.getByText(detail)).toBeDefined();
        }
        bridge.dispose();
    });

    test("a panel without a listing shows no empty cards", async () => {
        window.history.replaceState(null, "", "/library/?panel=panel.a");
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        await screen.findByRole("heading", { level: 1, name: "Alpha" });
        expect(screen.queryByRole("heading", { name: "Services used" })).toBeNull();
        expect(screen.queryByRole("region", { name: "Screenshots" })).toBeNull();
        expect(screen.getByText("Unknown")).toBeDefined();
        bridge.dispose();
    });

    test("embedded install sends the signal and renders the shell's failure", async () => {
        mockRegistry();
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({ type: "paperboard:library-connected", installed: [] });
        renderApp(bridge);

        fireEvent.click(await screen.findByText("Alpha"));
        const installButton = screen.getByRole("button", { name: "Install" });
        fireEvent.click(installButton);

        const request = fake.sent.find(
            (m) => m.type === "paperboard:library-install",
        );
        expect(request).toMatchObject({ panelId: "panel.a" });
        fake.receive({
            type: "paperboard:library-install-result",
            requestId: request.requestId,
            panelId: "panel.a",
            ok: false,
            error: "daemon refused",
        });
        await waitFor(() =>
            expect(
                screen.getByText("Couldn't install Alpha: daemon refused"),
            ).toBeDefined(),
        );
        bridge.dispose();
    });

    test("a successful install turns the action into Open and signals it", async () => {
        mockRegistry();
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({ type: "paperboard:library-connected", installed: [] });
        renderApp(bridge);

        fireEvent.click(await screen.findByText("Alpha"));
        fireEvent.click(screen.getByRole("button", { name: "Install" }));
        const request = fake.sent.find(
            (m) => m.type === "paperboard:library-install",
        );
        fake.receive({
            type: "paperboard:library-install-result",
            requestId: request.requestId,
            panelId: "panel.a",
            ok: true,
        });
        fake.receive({
            type: "paperboard:library-installed",
            installed: [{ id: "panel.a", name: "Alpha", version: "1.0.0" }],
        });

        const openButton = await screen.findByRole("button", { name: "Open" });
        fireEvent.click(openButton);
        expect(fake.sent).toContainEqual({
            type: "paperboard:library-open",
            panelId: "panel.a",
        });
        bridge.dispose();
    });

    test("standalone download hands the registry archive to the browser", async () => {
        mockRegistry();
        const bridge = createLibraryBridge(null);
        const click = vi
            .spyOn(HTMLAnchorElement.prototype, "click")
            .mockImplementation(() => {});
        renderApp(bridge);

        fireEvent.click(await screen.findByText("Alpha"));
        expect(bridge.mode()).toBe("standalone");
        fireEvent.click(screen.getByRole("button", { name: "Download" }));

        expect(click).toHaveBeenCalledTimes(1);
        bridge.dispose();
    });

    test("an empty registry is a distinct state from a failed one", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => registryResponse({})));
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        expect(await screen.findByText("No panels published yet")).toBeDefined();
        expect(screen.queryByText("Couldn't load library")).toBeNull();
        bridge.dispose();
    });

    test("a registry index that is not an object is a failure, not an empty library", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => registryResponse(null)));
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        expect(await screen.findByText("Couldn't load library")).toBeDefined();
        expect(screen.queryByText("No panels published yet")).toBeNull();
        bridge.dispose();
    });

    test("a failed registry load shows recovery and retry repairs it", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response("nope", { status: 503 }))
            .mockResolvedValueOnce(registryResponse(REGISTRY));
        vi.stubGlobal("fetch", fetchMock);
        const bridge = createLibraryBridge(null);
        renderApp(bridge);

        const retry = await screen.findByRole("button", { name: "Retry" });
        expect(screen.getByText("Couldn't load library")).toBeDefined();
        fireEvent.click(retry);
        expect(await screen.findByText("Alpha")).toBeDefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        bridge.dispose();
    });

    test("an installed panel the registry doesn't list gets its page from Paperboard's own files", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({
            type: "paperboard:library-connected",
            installed: [
                { id: "panel.a", name: "Alpha", version: "1.0.0" },
                { id: "dev.local", name: "Local", version: "0.2.0", description: "Mine" },
            ],
        });
        window.history.replaceState(null, "", "/library/?panel=dev.local");
        renderApp(bridge);

        await screen.findByRole("heading", { level: 1, name: "Local" });
        await waitFor(() =>
            expect(fake.sent.filter((m) => m.type === "paperboard:library-media")).toHaveLength(2),
        );
        const requests = fake.sent.filter((m) => m.type === "paperboard:library-media");
        // only the unlisted panel is asked about: icon for the grid, full for the page
        expect(requests.map((m) => [m.panelId, m.full])).toEqual([
            ["dev.local", false],
            ["dev.local", true],
        ]);

        const icon = "data:image/png;base64,AQI=";
        const full = requests.find((m) => m.full);
        fake.receive({
            type: "paperboard:library-media-result",
            requestId: full.requestId,
            panelId: "dev.local",
            ok: true,
            icon,
            store: {
                about: "Local **notes**",
                screenshots: [{ light: icon, alt: "Local view" }, { light: "javascript:x" }],
                credits: [{ name: "Solid", detail: "Rendering" }],
            },
        });

        expect(await screen.findByRole("img", { name: "Local view" })).toBeDefined();
        expect(screen.getAllByRole("img", { name: "Local view" })).toHaveLength(1);
        expect(document.querySelector(`header img[src="${icon}"]`)).not.toBeNull();
        expect(screen.getByRole("rowheader", { name: "Solid" })).toBeDefined();
        bridge.dispose();
    });

    test("an unavailable local listing leaves the page without one and asks again next visit", async () => {
        const fake = createFakeHost();
        const bridge = createLibraryBridge(fake.host);
        fake.receive({
            type: "paperboard:library-connected",
            installed: [{ id: "dev.local", name: "Local" }],
        });
        window.history.replaceState(null, "", "/library/?panel=dev.local");
        renderApp(bridge);
        await screen.findByRole("heading", { level: 1, name: "Local" });
        await waitFor(() =>
            expect(fake.sent.some((m) => m.type === "paperboard:library-media" && m.full)).toBe(true),
        );
        const full = fake.sent.find((m) => m.type === "paperboard:library-media" && m.full);
        fake.receive({
            type: "paperboard:library-media-result",
            requestId: full.requestId,
            panelId: "dev.local",
            ok: false,
            error: "store/1.png: 404",
        });
        await waitFor(() => expect(screen.queryByRole("region", { name: "Screenshots" })).toBeNull());

        fireEvent.click(screen.getByRole("link", { name: "Library" }));
        fireEvent.click(await screen.findByText("Local"));
        await waitFor(() =>
            expect(
                fake.sent.filter((m) => m.type === "paperboard:library-media" && m.full),
            ).toHaveLength(2),
        );
        bridge.dispose();
    });
});
