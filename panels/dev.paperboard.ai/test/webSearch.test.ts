// The transport contract for web search: DuckDuckGo's no-JS form is reached
// by POST with an honest User-Agent, and its anti-bot challenge (HTTP 202) is
// a typed failure rather than a silent empty answer.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { SearchUnavailableError } from "../src/core/builtins";
import { webSearch } from "../src/service/builtins";

const page = fs.readFileSync(path.join(import.meta.dir, "fixtures", "ddg-results.html"), "utf8");
const signal = new AbortController().signal;

describe("web search transport", () => {
    it("POSTs the query to DuckDuckGo's no-JS form and parses the page", async () => {
        let url = "";
        let init: RequestInit | undefined;
        const fetchImpl = (async (input: string | URL | Request, options?: RequestInit) => {
            url = String(input);
            init = options;
            return new Response(page, { status: 200, headers: { "Content-Type": "text/html" } });
        }) as typeof fetch;

        const results = await webSearch("solidjs stores", signal, fetchImpl);

        expect(url).toBe("https://html.duckduckgo.com/html/");
        expect(init!.method).toBe("POST");
        const headers = new Headers(init!.headers);
        expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
        expect(headers.get("User-Agent")).toBe("Paperboard-AI/0.1");
        expect(init!.body).toBe("q=solidjs+stores");
        expect(results.length).toBe(3);
    });

    it("treats DuckDuckGo's 202 challenge as unavailable, not as results", async () => {
        const fetchImpl = (async () => new Response("", { status: 202 })) as typeof fetch;
        await expect(webSearch("cats", signal, fetchImpl)).rejects.toThrow(SearchUnavailableError);
    });

    it("reports an HTTP failure", async () => {
        const fetchImpl = (async () => new Response("nope", { status: 503 })) as typeof fetch;
        await expect(webSearch("cats", signal, fetchImpl)).rejects.toThrow("HTTP 503");
    });
});
