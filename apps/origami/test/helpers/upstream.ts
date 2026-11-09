// The vendors the updaters read from (GitHub, Microsoft, Valve, npm,
// Anthropic) cannot run on loopback, so one real loopback HTTP server
// answers for all of them. An updater's fetch keeps its real URL; only the
// connection goes to this server, which answers by that URL.

type Answer = () => Response;

const answers = new Map<string, Answer>();
export const requested: string[] = [];

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const original = request.headers.get("x-upstream-url");
        if (!original) return new Response("missing x-upstream-url", { status: 400 });
        requested.push(original);
        const answer = answers.get(original);
        return answer ? answer() : new Response(`no upstream answer for ${original}`, { status: 404 });
    },
});

// one server for the whole test process (bun shares this module between
// files); unref'd so it never holds the process open after the last test
server.unref();

/** Answer `url` with these bytes (or JSON), as the vendor would. */
export function serve(url: string, body: string | Uint8Array | object, init: ResponseInit = {}): void {
    answers.set(url, () =>
        typeof body === "string" || body instanceof Uint8Array
            ? new Response(body, init)
            : Response.json(body, init),
    );
}

export function resetUpstream(): void {
    answers.clear();
    requested.length = 0;
}

export const upstreamFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    headers.set("x-upstream-url", url);
    const target = new URL(url);
    return fetch(`http://127.0.0.1:${server.port}${target.pathname}${target.search}`, { ...init, headers });
}) as typeof fetch;
