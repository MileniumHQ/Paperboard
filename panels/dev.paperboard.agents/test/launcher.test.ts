import { describe, expect, test } from "bun:test";
import type { PageInfo } from "../src/contract";
import type { Agent } from "../src/lib/agent";
import { createLauncher } from "../src/pages/launcher";

const page = (name: string, pictureAt = 0): PageInfo => ({ name, title: name, description: "", kind: "app", picture: pictureAt > 0, pictureAt });
const later = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
};
// quiet: yields one task so queued work lands; no duration is tuned
const settle = () => new Promise((r) => setTimeout(r, 0));

function launcher(pages: () => Promise<PageInfo[]>, pagePicture: (name: string) => Promise<{ image: string }> = async () => ({ image: "" })) {
    const agent = { state: { pages: { revision: 0 } }, calls: { pages, pagePicture: ({ name }: { name: string }) => pagePicture(name) } } as unknown as Agent;
    return createLauncher(agent);
}

describe("pages launcher", () => {
    test("a read that finishes late doesn't replace a newer one", async () => {
        // the launcher reads as it is made, then twice more
        const reads = [later<PageInfo[]>(), later<PageInfo[]>(), later<PageInfo[]>()];
        let n = 0;
        const l = launcher(() => reads[n++]!.promise);
        l.reload();
        l.reload();
        reads[2]!.resolve([page("new")]);
        await settle();
        reads[1]!.resolve([page("old")]);
        reads[0]!.resolve([page("first")]);
        await settle();
        expect(l.list()!.map((p) => p.name)).toEqual(["new"]);
    });

    test("a picture is read again only when it was retaken, and a gone page's is dropped", async () => {
        const asked: string[] = [];
        const l = launcher(
            async () => [page("a", 1)],
            async (name) => {
                asked.push(name);
                return { image: `img${asked.length}` };
            },
        );
        l.reload();
        await settle();
        expect(await l.picture("a", 1)).toBe("data:image/jpeg;base64,img1");
        expect(await l.picture("a", 1)).toBe("data:image/jpeg;base64,img1");
        expect(asked).toEqual(["a"]);
        expect(await l.picture("a", 2)).toBe("data:image/jpeg;base64,img2");
        expect(asked).toEqual(["a", "a"]);
    });

    test("a page that is gone from the pages takes its picture with it", async () => {
        const asked: string[] = [];
        let pages = [page("a", 1)];
        const l = launcher(
            async () => pages,
            async (name) => {
                asked.push(name);
                return { image: "x" };
            },
        );
        l.reload();
        await settle();
        await l.picture("a", 1);
        pages = [];
        l.reload();
        await settle();
        pages = [page("a", 1)];
        l.reload();
        await settle();
        await l.picture("a", 1);
        expect(asked).toEqual(["a", "a"]);
    });
});
