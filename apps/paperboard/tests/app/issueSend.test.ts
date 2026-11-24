// Report an Issue posts what the person typed, and the app's version and
// system, to the issues service, and shows the service's refusal as it says it.
// The service runs here as a local server speaking its wire format; the
// worker's own suite (services/issues) checks the same shape is what it takes.
import { afterEach, expect, test } from "bun:test";
import { CONTEXT_KEYS, MAX_TEXT_LENGTH } from "issues/shared";
import { issueContext, sendIssue } from "../../src/main/issueSend";

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(async () => {
    await server?.stop(true);
    server = undefined;
});

function serve(answer: (request: Request) => Response | Promise<Response>) {
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: answer });
    return `http://127.0.0.1:${server.port}`;
}

// Inventory: Core contracts — the app sends the trimmed text with exactly the context the service takes.
test("an issue is posted as JSON with the trimmed text and the app's context", async () => {
    const seen: { method: string; path: string; type: string | null; body: unknown }[] = [];
    const origin = serve(async (request) => {
        seen.push({ method: request.method, path: new URL(request.url).pathname, type: request.headers.get("Content-Type"), body: await request.json() });
        return Response.json({ id: crypto.randomUUID() }, { status: 201 });
    });
    const context = issueContext("window", "0.4.0", "15.1");
    expect(Object.keys(context).sort()).toEqual([...CONTEXT_KEYS].sort());
    await sendIssue("  The Terminal panel won't paste.  \n", context, origin);
    expect(seen).toEqual([
        { method: "POST", path: "/v1/issues", type: "application/json", body: { text: "The Terminal panel won't paste.", context } },
    ]);
});

test("the service's refusal reaches the person in its own words", async () => {
    const origin = serve(() => Response.json({ error: { code: "rate_limited", message: "Too many issues from this address. Try again in a minute." } }, { status: 429 }));
    await expect(sendIssue("Something broke", issueContext("browser", "0.4.0", "6.12"), origin)).rejects.toThrow("Too many issues from this address. Try again in a minute.");
});

test("an answer that isn't the service's still fails, with its status", async () => {
    const origin = serve(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(sendIssue("Something broke", issueContext("window", "0.4.0", "6.12"), origin)).rejects.toThrow("Paperboard's issues service answered HTTP 502.");
});

test("empty and oversized text never leave the app", async () => {
    let requests = 0;
    const origin = serve(() => {
        requests++;
        return Response.json({ id: "x" }, { status: 201 });
    });
    const context = issueContext("window", "0.4.0", "6.12");
    await expect(sendIssue("  \n ", context, origin)).rejects.toThrow("Say what went wrong first.");
    await expect(sendIssue("a".repeat(MAX_TEXT_LENGTH + 1), context, origin)).rejects.toThrow("An issue holds at most 10,000 characters.");
    expect(requests).toBe(0);
});
