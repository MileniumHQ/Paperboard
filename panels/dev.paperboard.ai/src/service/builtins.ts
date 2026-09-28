// Effects of the built-in tools. Search reads Brave's public result page (no
// key, nothing to set up); the shell runs through the daemon's process API
// so the child is owned, time-limited and output-capped.

import os from "node:os";
import { processApi } from "@paperboard-dev/paperapi";
import {
    parseBraveResults,
    SearchUnavailableError,
    SHELL_OUTPUT_CAP_BYTES,
    SHELL_TIMEOUT_MS,
    shellArgv,
    type SearchResult,
} from "../core/builtins";

// declared in manifest.json network.hosts
const SEARCH_URL = "https://search.brave.com/search";
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
// the result page is served to browsers; a bare client gets a challenge
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

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
    const url = `${SEARCH_URL}?${new URLSearchParams({ q: query, source: "web" })}`;
    const res = await fetchImpl(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
        headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) {
        await res.body?.cancel().catch((e) => console.debug("[ai] cancelling the search body failed:", String(e)));
        throw new SearchUnavailableError(`web search failed (HTTP ${res.status})`);
    }
    return parseBraveResults(await readCapped(res, MAX_PAGE_BYTES));
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
