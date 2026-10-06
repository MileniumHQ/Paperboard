// Run with: bunx vite --config test/fixtures/modrinth.vite.ts
// Open /test/fixtures/modrinth.html. Uses real Plugins/PaperUI and HTTP mapping;
// only service hydration and external API responses are fixtures. ?live uses Modrinth.
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import Plugins from "../../src/components/Plugins";
import { setServerSoftware, setServerVersion } from "./modrinthServer";

const originalFetch = globalThis.fetch;
const live = new URLSearchParams(location.search).has("live");
const requests: string[] = [];
if (!live) {
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        requests.push(url.href);
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const version = JSON.parse(url.searchParams.get("game_versions") ?? '["1.21.1"]')[0];
        const loaders = JSON.parse(url.searchParams.get("loaders") ?? '["fabric"]');
        if (url.pathname.endsWith("/search")) return Response.json({ hits: [
            { project_id: "example", slug: "example", title: "Server Example", description: "Compatible server mod", downloads: 5000, follows: 1234 },
            { project_id: "client", slug: "client", title: "Client Example" },
            { project_id: "old", slug: "old", title: "Old Example" },
        ] });
        if (url.pathname.endsWith("/version")) return Response.json([{
            environment: url.pathname.includes("/client/") ? "client_only" : "server_only",
            game_versions: [url.pathname.includes("/old/") ? "1.20.1" : version], loaders,
            files: [{ filename: "example.jar", url: "https://cdn.modrinth.com/example.jar" }],
        }]);
        return Response.json({ id: "example", slug: "example", title: "Server Example", followers: 4321, updated: "2026-10-05T12:34:56Z", body: "Server mod description", license: { id: "mit" } });
    };
}
setServerSoftware("fabric");
setServerVersion("1.21.1");
const dispose = render(() => <PaperProvider><Plugins /></PaperProvider>, document.getElementById("app")!);
window.addEventListener("pagehide", () => { dispose(); globalThis.fetch = originalFetch; }, { once: true });
const waitUntil = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error("Browser regression timed out");
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
};
const checks: Record<string, boolean> = {};
Object.assign(window, { modrinthFixture: { requests, setServerSoftware, setServerVersion, dispose, checks } });
if (!live) {
    try {
        await waitUntil(() => !!document.querySelector('[title="Server Example"]') || document.body.innerText.includes("5.0k downloads"));
        checks.automaticFrontPage = requests.some((url) => new URL(url).pathname.endsWith("/search") && new URL(url).searchParams.get("query") === "");
        checks.filters = !document.body.innerText.includes("Client Example") && !document.body.innerText.includes("Old Example");
        const title = [...document.querySelectorAll<HTMLElement>("*")].find((element) => element.textContent === "Server Example");
        if (!title) throw new Error("Missing project card");
        title.click();
        await waitUntil(() => document.body.innerText.includes("4.3k"));
        checks.followers = document.body.innerText.includes("4.3k");
        checks.updated = document.body.innerText.includes("Oct 5, 2026");
        checks.noUnknownDate = [...document.querySelectorAll("tr")].find((row) => row.querySelector("th")?.textContent === "Last Updated")?.querySelector("td")?.textContent !== "Unknown";
        if (Object.values(checks).some((value) => !value)) throw new Error(JSON.stringify(checks));
        document.documentElement.dataset.result = "pass";
    } catch (error) {
        document.documentElement.dataset.result = "fail";
        Object.assign(checks, { error: String(error) });
        console.error(error);
    }
}
