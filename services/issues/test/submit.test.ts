// The public submit endpoint: anyone can reach it, so what it takes is
// bounded in size, shape and rate, and what it keeps is exactly what the app sent.
import { afterEach, describe, expect, test } from "bun:test";
import { DAILY_LIMIT, STORE_LIMIT } from "../src/worker/limits";
import { MAX_BODY_BYTES, MAX_TEXT_LENGTH, type Issue } from "../src/shared";
import { SUBMIT_LIMIT, startIssues, validIssue, type Issues } from "./helpers/worker";

let service: Issues | undefined;

afterEach(async () => {
    await service?.dispose();
    service = undefined;
});

async function listed(target: Issues): Promise<Issue[]> {
    const res = await target.dashboard("/dashboard/api/issues");
    expect(res.status).toBe(200);
    return ((await res.json()) as { issues: Issue[] }).issues;
}

async function errorCode(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code;
}

const HOUR = 3_600_000;

// Inventory: Core contracts — an issue the app sends is kept as sent, trimmed, and listed newest first.
test("a submitted issue is kept with its context and listed newest first", async () => {
    service = await startIssues();
    const first = await service.submit(validIssue({ text: "  First problem\r\nsecond line  " }));
    expect(first.status).toBe(201);
    const { id } = (await first.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await service.submit(validIssue({ text: "Second problem" }), { ip: "198.51.100.2" })).status).toBe(201);

    const issues = await listed(service);
    expect(issues.map((issue) => issue.text)).toEqual(["Second problem", "First problem\nsecond line"]);
    expect(issues[1]).toMatchObject({ id, context: validIssue().context });
});

// Inventory: Security — the unauthenticated endpoint refuses what it wasn't built to take.
describe("the submit endpoint refuses malformed requests", () => {
    test.each([
        ["a non-JSON content type", { headers: { "Content-Type": "text/plain" } }, JSON.stringify(validIssue()), 415, "unsupported_type"],
        ["a body that isn't JSON", {}, "{not json", 400, "invalid_issue"],
        ["an unknown top-level field", {}, validIssue({ email: "someone@example.com" }), 400, "invalid_issue"],
        ["empty text", {}, validIssue({ text: "   \n " }), 400, "invalid_issue"],
        ["text over the limit", {}, validIssue({ text: "a".repeat(MAX_TEXT_LENGTH + 1) }), 400, "invalid_issue"],
        ["control characters", {}, validIssue({ text: "bell \u0007" }), 400, "invalid_issue"],
        ["a missing context field", {}, validIssue({ context: { appVersion: "0.4.0", os: "Linux", osVersion: "6", arch: "x64" } }), 400, "invalid_issue"],
        ["an unknown context field", {}, validIssue({ context: { ...(validIssue().context as object), hostname: "pc" } }), 400, "invalid_issue"],
        ["a multi-line context field", {}, validIssue({ context: { ...(validIssue().context as object), os: "Linux\nevil" } }), 400, "invalid_issue"],
        ["an unknown shell", {}, validIssue({ context: { ...(validIssue().context as object), shell: "phone" } }), 400, "invalid_issue"],
    ] as const)("%s", async (_name, init, body, status, code) => {
        service ??= await startIssues();
        // each case from its own address, so the rate limit never answers first
        const res = await service.submit(body, { ...init, ip: `192.0.2.${Math.floor(Math.random() * 250) + 1}` });
        expect(res.status).toBe(status);
        expect(await errorCode(res)).toBe(code);
    });

    test("other methods and paths", async () => {
        service ??= await startIssues();
        const get = await service.request("/v1/issues");
        expect(get.status).toBe(405);
        expect(get.headers.get("Allow")).toBe("POST");
        expect((await service.request("/")).status).toBe(404);
        expect((await service.request("/v1/issues", { method: "POST", ip: null, headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(400);
        expect(await listed(service)).toEqual([]);
    });
});

// Inventory: Security — a body is read only up to the cap, whatever it claims.
test("bodies over the size cap are refused, declared or streamed", async () => {
    service = await startIssues();
    const big = JSON.stringify(validIssue({ text: "a".repeat(MAX_BODY_BYTES) }));
    const declared = await service.submit(big);
    expect(declared.status).toBe(413);

    // no Content-Length: the worker counts what it reads
    const chunks = [new TextEncoder().encode(big)];
    const streamed = await service.request("/v1/issues", {
        method: "POST",
        ip: "198.51.100.9",
        headers: { "Content-Type": "application/json" },
        body: new ReadableStream({
            pull(controller) {
                const next = chunks.shift();
                if (next) controller.enqueue(next);
                else controller.close();
            },
        }),
        duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(streamed.status).toBe(413);
    expect(await listed(service)).toEqual([]);
});

// Inventory: Security — one address can't flood the inbox.
test("one address is limited per minute and others aren't", async () => {
    service = await startIssues();
    // The rate-limit binding counts in windows aligned to the wall clock. A
    // run that straddles a boundary proves nothing either way, so it's
    // repeated once on a fresh address: two boundaries can't fall in one run.
    for (const attempt of [1, 2]) {
        const ip = `192.0.2.${attempt}`;
        const window = Math.floor(Date.now() / 60_000);
        const statuses: number[] = [];
        let last: Response | undefined;
        for (let i = 0; i <= SUBMIT_LIMIT; i++) {
            last = await service.submit(validIssue(), { ip });
            statuses.push(last.status);
        }
        if (Math.floor(Date.now() / 60_000) !== window) {
            if (attempt === 2) throw new Error("two rate-limit windows rolled over during the test");
            continue;
        }
        expect(statuses.slice(0, SUBMIT_LIMIT)).toEqual(Array(SUBMIT_LIMIT).fill(201));
        expect(statuses[SUBMIT_LIMIT]).toBe(429);
        expect(last!.headers.get("Retry-After")).toBe("60");
        expect(await errorCode(last!)).toBe("rate_limited");
        break;
    }
    expect((await service.submit(validIssue(), { ip: "198.51.100.50" })).status).toBe(201);
}, 30_000);

// Inventory: Security — many addresses together stay under the daily cap and the storage cap.
test("the daily cap counts the last 24 hours, and a full store refuses", async () => {
    service = await startIssues();
    await service.seed(DAILY_LIMIT, Date.now() - HOUR);
    const busy = await service.submit(validIssue());
    expect(busy.status).toBe(429);
    expect(await errorCode(busy)).toBe("busy");
    await service.dispose();

    service = await startIssues();
    await service.seed(DAILY_LIMIT, Date.now() - 25 * HOUR);
    expect((await service.submit(validIssue())).status).toBe(201);
    await service.seed(STORE_LIMIT - DAILY_LIMIT - 1, Date.now() - 25 * HOUR);
    const full = await service.submit(validIssue(), { ip: "198.51.100.3" });
    expect(full.status).toBe(503);
    expect(await errorCode(full)).toBe("full");
}, 30_000);
