import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backupApi, BackupLocationError } from "../src/backups";
import { exportFile, FileTransferError, importFile } from "../src/fileTransfer";
import { setFrameSession } from "../src/frameSession";
import { catchLoopbackRedirect, LoopbackRedirectError } from "../src/loopback";

// A panel frame's window as the SDK sees it: its own message events, and a
// parent it posts to. Messages are delivered with the source the browser
// would stamp on them.
const g = globalThis as any;
let posted: any[];
let events: EventTarget;
const parent = { postMessage: (msg: unknown) => posted.push(msg) };
const otherFrame = { postMessage: () => {} };

function deliver(data: unknown, source: unknown = parent): void {
    const event = new Event("message");
    Object.assign(event, { data, source });
    events.dispatchEvent(event);
}

beforeEach(() => {
    posted = [];
    events = new EventTarget();
    g.window = {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    };
    setFrameSession({ generation: "gen-2", widget: false, computerName: "Workshop PC" });
});

afterEach(() => {
    delete g.window;
    setFrameSession(null as any);
});

// settles a promise into a readable state, for checking it has not settled
function track<T>(promise: Promise<T>) {
    const state = { settled: false, value: undefined as T | undefined, error: undefined as any };
    promise.then(
        (value) => {
            state.settled = true;
            state.value = value;
        },
        (error) => {
            state.settled = true;
            state.error = error;
        },
    );
    return state;
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

// Shell requests accept only the parent's matching reply and refuse bad input up front.
describe("shell requests accept only the parent's matching reply and refuse bad input up front", () => {
    const requests = [
        {
            name: "file export",
            start: () => exportFile("saves/world.zip", "dev.a"),
            result: { status: "exported", name: "world.zip", bytes: 10 },
        },
        {
            name: "file import",
            start: () => importFile("saves/world.zip", "dev.a"),
            result: { status: "imported", name: "world.zip", bytes: 10 },
        },
        {
            name: "backup location choice",
            start: () => backupApi.chooseLocation("dev.a"),
            result: { status: "chosen", location: { id: "local", kind: "local", label: "This computer", detail: "/data", removable: false } },
        },
        {
            name: "loopback sign-in",
            start: () => catchLoopbackRedirect("http://localhost:1455/auth/callback"),
            result: { status: "caught", url: "http://localhost:1455/auth/callback?code=abc" },
        },
    ];

    for (const r of requests) {
        test(`${r.name} settles only on the parent's reply with this generation and request id`, async () => {
            const pending = track(r.start() as Promise<unknown>);
            expect(posted).toHaveLength(1);
            const request = posted[0];
            expect(request.generation).toBe("gen-2");
            const reply = { type: `${request.type}-result`, generation: "gen-2", requestId: request.requestId, result: r.result };

            deliver(reply, otherFrame);
            deliver({ ...reply, generation: "gen-1" });
            deliver({ ...reply, requestId: "someone-else" });
            deliver({ ...reply, type: "paperboard:something-else-result" });
            await flush();
            expect(pending.settled).toBe(false);

            deliver(reply);
            await flush();
            expect(pending.error).toBeUndefined();
            expect(pending.settled).toBe(true);
        });
    }

    test("the backup location reply carries the computer's name for the local folder", async () => {
        const pending = backupApi.chooseLocation("dev.a");
        const request = posted[0];
        deliver({ type: `${request.type}-result`, generation: "gen-2", requestId: request.requestId, result: requests[2].result });
        expect(await pending).toEqual({ status: "chosen", location: { id: "local", kind: "local", label: "Workshop PC", detail: "/data", removable: false } });
    });

    test("catchLoopbackRedirect refuses anything but http://localhost:<explicit port>/path without a fragment", async () => {
        const bad = [
            "https://localhost:1455/cb",
            "http://example.com:1455/cb",
            "http://localhost/cb",
            "http://localhost:80/cb",
            "http://localhost:1455/cb#frag",
            "http://user:pass@localhost:1455/cb",
            "not a url",
            "",
        ];
        for (const uri of bad) {
            const err = await catchLoopbackRedirect(uri).then(
                () => null,
                (e: LoopbackRedirectError) => e,
            );
            expect({ uri, code: err?.code }).toEqual({ uri, code: "invalid-request" });
        }
        expect(posted).toEqual([]);
        for (const uri of ["http://localhost:1455/cb", "http://127.0.0.1:8080/", "http://[::1]:3000/auth"]) {
            const pending = catchLoopbackRedirect(uri);
            const request = posted.pop();
            expect(request.redirectUri).toBe(uri);
            deliver({ type: `${request.type}-result`, generation: "gen-2", requestId: request.requestId, result: { status: "local" } });
            expect(await pending).toEqual({ status: "local" });
        }
    });

    test("backupApi.forSource refuses a malformed source id before sending anything", () => {
        for (const bad of ["../other", "", "a".repeat(65), "has space", "-lead"]) {
            expect(() => backupApi.forSource("dev.a", bad)).toThrow("Choose an explicit backup source id");
        }
        expect(() => backupApi.forSource("../evil", "world")).toThrow("Invalid panel id");
        expect(backupApi.forSource("dev.a", "world-1.main").status).toBeInstanceOf(Function);
        expect(posted).toEqual([]);
    });

    test("widget frames and pages outside Paperboard get unavailable, and nothing is posted", async () => {
        setFrameSession({ generation: "gen-2", widget: true, computerName: null });
        const fromWidget = [
            await exportFile("a", "dev.a").then(() => null, (e: FileTransferError) => e.code),
            await backupApi.chooseLocation("dev.a").then(() => null, (e: BackupLocationError) => e.code),
            await catchLoopbackRedirect("http://localhost:1455/cb").then(() => null, (e: LoopbackRedirectError) => e.code),
        ];
        expect(fromWidget).toEqual(["unavailable", "unavailable", "unavailable"]);
        setFrameSession(null as any);
        expect(await importFile("a", "dev.a").then(() => null, (e: FileTransferError) => e.code)).toBe("unavailable");
        expect(posted).toEqual([]);
    });
});
