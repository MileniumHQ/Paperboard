import { describe, expect, test } from "bun:test";
import { PartialUpdateError, UpdateQueue, type UpdateJob } from "../../src/main/updateQueue";
import { batchPercent, groupHolds, holdGroupText, pendingUpdates, type UpdateHold, type UpdateQueueState } from "../../src/shared/updateQueue";

const identity = (key: string) => ({ key, kind: "panel" as const, computerId: "local", computerName: null, panelId: key, name: key, version: "2.0.0" });

function gate() {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => { open = resolve; });
    return { opened, open };
}

function queue() {
    const published: UpdateQueueState[] = [];
    return { q: new UpdateQueue((state) => published.push(state)), published };
}

// The top bar's list is the truth about what is updating: one job at a
// time, failures and holds kept, nothing double-run.
describe("update queue", () => {
    test("jobs run one at a time in order, report progress, and a failure is kept with its reason", async () => {
        const { q } = queue();
        const first = gate();
        const order: string[] = [];
        const a = q.enqueue({ items: [identity("a")], run: async (report) => { order.push("a"); report({ stage: "downloading", percent: 40, bytesLoaded: 4, bytesTotal: 10 }); await first.opened; } });
        const b = q.enqueue({ items: [identity("b")], run: async () => { order.push("b"); throw new Error("disk full"); } });
        expect(pendingUpdates(q.snapshot()).map((i) => i.status)).toEqual(["running", "queued"]);
        expect(q.snapshot().items[0]).toMatchObject({ stage: "downloading", percent: 40, bytesLoaded: 4, bytesTotal: 10 });
        expect(batchPercent(q.snapshot())).toBe(20);
        first.open();
        expect((await a)[0].status).toBe("done");
        expect((await b)[0]).toMatchObject({ status: "failed", error: "disk full" });
        expect(order).toEqual(["a", "b"]);
        expect(pendingUpdates(q.snapshot())).toEqual([]);
    });

    test("a job already listed is not run twice, and a new batch clears the finished one", async () => {
        const { q } = queue();
        const g = gate();
        let runs = 0;
        const job: UpdateJob = { items: [identity("a")], run: async () => { runs++; await g.opened; } };
        const one = q.enqueue(job);
        const two = q.enqueue(job);
        g.open();
        expect((await one)[0].status).toBe("done");
        expect((await two)[0].status).toBe("done");
        expect(runs).toBe(1);
        await q.enqueue({ items: [identity("b")], run: async () => undefined });
        expect(q.snapshot().items.map((i) => i.key)).toEqual(["b"]);
    });

    test("a held job leaves a hold, which enqueuing its update removes", async () => {
        const { q } = queue();
        const hold: UpdateHold = { key: "a", kind: "panel", computerId: "local", computerName: null, id: "a", name: "A", version: "2.0.0", sha256: null, users: ["A"] };
        expect((await q.enqueue({ items: [identity("a")], run: async () => hold }))[0].status).toBe("held");
        expect(q.snapshot().holds).toEqual([hold]);
        expect(q.hold("a")).toEqual(hold);
        await q.enqueue({ items: [identity("a")], run: async () => undefined });
        expect(q.snapshot().holds).toEqual([]);
    });

    test("one job runs several items together; a partial failure fails only its own items", async () => {
        const { q } = queue();
        const g = gate();
        const both = q.enqueue({
            items: [identity("p"), identity("k")],
            run: async (report) => {
                report({ stage: "stopping" });
                report({ stage: "downloading", percent: 50 }, "k");
                await g.opened;
                throw new PartialUpdateError({ k: "checksum mismatch" });
            },
        });
        expect(q.snapshot().items.map((i) => [i.key, i.status, i.stage])).toEqual([["p", "running", "stopping"], ["k", "running", "downloading"]]);
        // part of a job already listed can't be listed again by itself
        expect(() => q.enqueue({ items: [identity("k"), identity("z")], run: async () => undefined })).toThrow("already in the list");
        g.open();
        expect((await both).map((i) => [i.key, i.status, i.error])).toEqual([["p", "done", null], ["k", "failed", "checksum mismatch"]]);
    });

    test("held updates waiting for the same panels are one group, said in one sentence", () => {
        const hold = (key: string, name: string, users: string[], computerId = "local"): UpdateHold =>
            ({ key, kind: "package", computerId, computerName: computerId === "local" ? null : "VPS", id: key, name, version: "2", sha256: null, users });
        const groups = groupHolds([
            hold("gs", "Game Server", ["Game Server"]),
            hold("java", "Java 21", ["Game Server"]),
            hold("node", "Node", ["Bots", "Game Server"]),
            hold("vps-java", "Java 21", ["Game Server"], "vps"),
            hold("own", "FFmpeg", ["Paperboard"]),
        ]);
        expect(groups.map((g) => g.keys)).toEqual([["gs", "java"], ["node"], ["vps-java"], ["own"]]);
        expect(groups.map(holdGroupText)).toEqual([
            "Game Server and Java 21 need updating, but Game Server is using them.",
            "Node needs updating, but Bots and Game Server are using it.",
            "Java 21 on VPS needs updating, but Game Server is using it.",
            "FFmpeg needs updating, but Paperboard's processes are using it.",
        ]);
    });

    test("a failure found outside the queue is listed once", () => {
        const { q } = queue();
        const failed = { ...identity("p"), kind: "package" as const, status: "failed" as const, stage: null, percent: null, bytesLoaded: null, bytesTotal: null, error: "rename failed" };
        q.report(failed);
        const revision = q.snapshot().revision;
        q.report(failed);
        expect(q.snapshot().revision).toBe(revision);
        expect(q.snapshot().items).toEqual([failed]);
    });
});
