// Effects of the built-in tools. Search reads DuckDuckGo's no-JS result page
// (no key, nothing to set up); the shell runs through the daemon's process API
// so the child is owned, time-limited and output-capped.

import os from "node:os";
import { processApi } from "@mileniumhq/paperapi";
import {
    parseDuckDuckGoResults,
    SearchUnavailableError,
    SHELL_OUTPUT_CAP_BYTES,
    SHELL_TIMEOUT_MS,
    shellArgv,
    type SearchResult,
} from "../core/builtins";

// declared in manifest.json network.hosts
const SEARCH_URL = "https://html.duckduckgo.com/html/";
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
// DuckDuckGo serves the no-JS form to plain clients; the panel identifies
// itself honestly rather than posing as a browser
const USER_AGENT = "Paperboard-AI/0.1";

/** Reads a body up to a byte cap, cancelling the stream past it. */
async function readCapped(res: Response, cap: number): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > cap) throw new SearchUnavailableError(`the search page passed ${cap} bytes`);
            chunks.push(value);
        }
    } catch (err) {
        await reader.cancel().catch((e) => console.debug("[ai] cancelling the search body failed:", String(e)));
        throw err;
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function webSearch(query: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<SearchResult[]> {
    const res = await fetchImpl(SEARCH_URL, {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
        headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        },
        body: new URLSearchParams({ q: query }).toString(),
    });
    // 202 is DuckDuckGo's anti-bot challenge: not results, and not success
    if (res.status === 202) {
        await res.body?.cancel().catch((e) => console.debug("[ai] cancelling the search body failed:", String(e)));
        throw new SearchUnavailableError("web search was challenged (HTTP 202)");
    }
    if (!res.ok) {
        await res.body?.cancel().catch((e) => console.debug("[ai] cancelling the search body failed:", String(e)));
        throw new SearchUnavailableError(`web search failed (HTTP ${res.status})`);
    }
    return parseDuckDuckGoResults(await readCapped(res, MAX_PAGE_BYTES));
}

export async function runShell(command: string, signal: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    const argv = shellArgv(command, process.platform);
    // bounded by timeout and output cap; the daemon owns and kills the child
    return processApi.exec(argv.command, argv.args, {
        cwd: os.homedir(),
        timeoutMs: SHELL_TIMEOUT_MS,
        execBufferCapBytes: SHELL_OUTPUT_CAP_BYTES,
    });
}
