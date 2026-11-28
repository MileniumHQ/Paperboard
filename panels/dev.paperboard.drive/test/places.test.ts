// The places Drive shows: its own folder, the disks plugged in (from a disk
// reader the test holds), and folders linked from this computer, kept across
// restarts and shown as missing while they're gone.
import { describe, expect, onTestFinished, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Place } from "../src/lib/contract";
import type { Disk } from "../src/lib/disks";
import { diskId, Places } from "../src/lib/places";

async function openPlaces(dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-places-")), plugged: Disk[] = []) {
    const pushes: Place[][] = [];
    const unplugged: { id: string; name: string }[] = [];
    const places = new Places({
        root: path.join(dir, "data/Drive"),
        saved: path.join(dir, "data/places.json"),
        disks: { read: async () => [...plugged] },
        onChange: (list) => pushes.push(list),
        onUnplugged: (disk) => unplugged.push(disk),
        onProblem: () => {},
    });
    await places.open();
    onTestFinished(async () => {
        await places.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const folder = (rel: string) => {
        const full = path.join(dir, rel);
        fs.mkdirSync(full, { recursive: true });
        return fs.realpathSync(full);
    };
    return { dir, places, pushes, plugged, unplugged, folder };
}

const ids = (list: Place[]) => list.map((p) => `${p.kind}:${p.name}`);

describe("places", () => {
    test("Drive's own folder is always first, with the space left on its disk", async () => {
        const { places, pushes } = await openPlaces();
        const [own] = places.list();
        expect(own).toMatchObject({ id: "drive", kind: "own", name: "Drive", available: true });
        expect(own.free).toBeGreaterThan(0);
        expect(own.total).toBeGreaterThanOrEqual(own.free!);
        expect(pushes).toHaveLength(1);
    });

    test("a linked folder shows its files where they are, and stays linked across a restart", async () => {
        const { dir, places, folder } = await openPlaces();
        const pictures = folder("home/Pictures");
        fs.writeFileSync(path.join(pictures, "cat.jpg"), "meow");
        const place = await places.link(pictures);
        expect(place).toMatchObject({ kind: "folder", name: "Pictures", location: pictures, available: true });
        expect((await (await places.drive(place.id)).list("")).map((e) => e.name)).toEqual(["cat.jpg"]);
        await places.close();

        const again = new Places({
            root: path.join(dir, "data/Drive"),
            saved: path.join(dir, "data/places.json"),
            disks: { read: async () => [] },
            onChange: () => {},
            onUnplugged: () => {},
            onProblem: () => {},
        });
        await again.open();
        expect(again.list().find((p) => p.id === place.id)).toMatchObject({ name: "Pictures", location: pictures });
        await again.close();
    });

    test("unlinking lets the folder go and leaves its files", async () => {
        const { places, folder } = await openPlaces();
        const docs = folder("home/Documents");
        fs.writeFileSync(path.join(docs, "taxes.pdf"), "x");
        const place = await places.link(docs);
        await places.unlink(place.id);
        expect(ids(places.list())).toEqual(["own:Drive"]);
        expect(fs.readdirSync(docs)).toEqual(["taxes.pdf"]);
        await expect(places.drive(place.id)).rejects.toThrow("isn't in Drive anymore");
        await expect(places.unlink(place.id)).rejects.toThrow("isn't linked");
    });

    test("refuses what isn't a folder to link, one linked already, and Drive's own files", async () => {
        const { dir, places, folder } = await openPlaces();
        const music = folder("home/Music");
        fs.writeFileSync(path.join(dir, "home/song.mp3"), "x");
        await places.link(music);
        await expect(places.link(music)).rejects.toThrow("already linked");
        await expect(places.link("home/Music")).rejects.toThrow("Pick a folder");
        await expect(places.link(path.join(dir, "home/song.mp3"))).rejects.toThrow("isn't a folder");
        await expect(places.link(path.join(dir, "home/Nope"))).rejects.toThrow("isn't there");
        await expect(places.link(path.join(dir, "data/Drive"))).rejects.toThrow("Drive's own files");
        await expect(places.link(dir)).rejects.toThrow("Drive's own files");
    });

    test("picking a folder says why one can't be linked before Link is pressed", async () => {
        const { dir, places, folder, plugged } = await openPlaces();
        const music = folder("home/Music");
        expect((await places.browse(music)).cannotLink).toBeUndefined();
        await places.link(music);
        expect((await places.browse(music)).cannotLink).toContain("already linked");
        expect((await places.browse(dir)).cannotLink).toBe(`“${path.basename(dir)}” holds Drive's own files. Pick a folder inside it.`);
        expect((await places.browse(path.join(dir, "data/Drive"))).cannotLink).toContain("is in Drive's own files");
        const usb = folder("media/USB");
        plugged.push({ mount: usb, name: "USB" });
        await places.refresh();
        expect((await places.browse(usb)).cannotLink).toContain("is a disk");
    });

    test("links and unlinks at once (two windows) each land, in memory and across a restart", async () => {
        const { dir, places, folder } = await openPlaces();
        const [a, b, c] = ["A", "B", "C"].map((n) => folder(`home/${n}`));
        const first = await places.link(a);
        const [, second] = await Promise.all([places.unlink(first.id), places.link(b), places.link(c)]);
        // the same folder twice at once is linked once
        const twice = await Promise.allSettled([places.link(a), places.link(a)]);
        expect(twice.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        const names = (list: Place[]) => list.filter((p) => p.kind === "folder").map((p) => p.name);
        expect(names(places.list())).toEqual(["B", "C", "A"]);
        expect(second.name).toBe("B");
        await places.close();
        const again = new Places({
            root: path.join(dir, "data/Drive"),
            saved: path.join(dir, "data/places.json"),
            disks: { read: async () => [] },
            onChange: () => {},
            onUnplugged: () => {},
            onProblem: () => {},
        });
        await again.open();
        expect(names(again.list())).toEqual(["B", "C", "A"]);
        await again.close();
    });

    test("linked folders show as there from the first word to the windows, even while disks can't be read", async () => {
        const { dir, places, folder } = await openPlaces();
        const music = await places.link(folder("home/Music"));
        await places.close();
        const pushes: Place[][] = [];
        const again = new Places({
            root: path.join(dir, "data/Drive"),
            saved: path.join(dir, "data/places.json"),
            disks: {
                read: async () => {
                    throw new Error("mountinfo is gone");
                },
            },
            onChange: (list) => pushes.push(list),
            onUnplugged: () => {},
            onProblem: () => {},
        });
        await again.open();
        onTestFinished(() => again.close());
        expect(pushes.length).toBeGreaterThan(0);
        for (const list of pushes) expect(list.find((p) => p.id === music.id)).toMatchObject({ available: true });
    });

    test("two calls at once open a place's drive once", async () => {
        const { places, folder } = await openPlaces();
        const place = await places.link(folder("home/Videos"));
        const [a, b] = await Promise.all([places.drive(place.id), places.drive(place.id)]);
        expect(a).toBe(b);
    });

    test("a linked folder that goes away stays linked, says it's missing, and comes back", async () => {
        const { places, folder } = await openPlaces();
        const projects = folder("home/Projects");
        const place = await places.link(projects);
        fs.rmSync(projects, { recursive: true });
        await expect(places.drive(place.id)).rejects.toThrow("“Projects” isn't there right now");
        expect(places.list().find((p) => p.id === place.id)).toMatchObject({ available: false });
        // back: the next look finds it, without anyone opening it
        folder("home/Projects");
        await places.refresh();
        expect(places.list().find((p) => p.id === place.id)?.available).toBe(true);
        fs.rmSync(projects, { recursive: true });
        await places.refresh();
        expect(places.list().find((p) => p.id === place.id)?.available).toBe(false);
    });

    test("disks show while they're plugged in, and folders on them come and go with them", async () => {
        const { places, plugged, unplugged, folder, pushes } = await openPlaces();
        const usb = folder("media/Samsung T7");
        const photos = folder("media/Samsung T7/Photos");
        plugged.push({ mount: usb, name: "Samsung T7" });
        await places.refresh();
        expect(ids(places.list())).toEqual(["own:Drive", "disk:Samsung T7"]);
        const disk = places.list()[1];
        expect(disk).toMatchObject({ id: diskId(usb), location: usb, available: true });
        await expect(places.link(usb)).rejects.toThrow("is a disk");
        const linked = await places.link(photos);
        expect(places.list().find((p) => p.id === linked.id)?.disk).toBe(disk.id);

        // pulled out: the disk leaves, its files with it, and the folder on it is missing
        const pulled = `${usb} (pulled out)`;
        fs.renameSync(usb, pulled);
        plugged.length = 0;
        await places.refresh();
        expect(ids(places.list())).toEqual(["own:Drive", "folder:Photos"]);
        expect(places.list()[1]).toMatchObject({ available: false });
        await expect(places.drive(disk.id)).rejects.toThrow("isn't in Drive anymore");
        // nobody asked it to go, so every window is told
        expect(unplugged).toEqual([{ id: disk.id, name: "Samsung T7" }]);

        // back in: both are there again
        fs.renameSync(pulled, usb);
        plugged.push({ mount: usb, name: "Samsung T7" });
        await places.refresh();
        expect(places.list().map((p) => p.available)).toEqual([true, true, true]);

        // a read that finds nothing new tells no one
        const before = pushes.length;
        await places.refresh();
        expect(pushes.length).toBe(before);
    });

    test("picking a folder lists the folders in one, hidden ones and files left out", async () => {
        const { dir, places, folder } = await openPlaces();
        const home = folder("home");
        folder("home/Desktop");
        folder("home/.cache");
        fs.writeFileSync(path.join(home, "notes.txt"), "x");
        fs.symlinkSync(path.join(home, "Desktop"), path.join(home, "Shortcut"));
        fs.symlinkSync(path.join(home, "gone"), path.join(home, "Broken"));
        const listed = await places.browse(home);
        expect(listed).toMatchObject({ path: home, name: "home", parent: path.dirname(home) });
        expect(listed.folders.map((f) => f.name)).toEqual(["Desktop", "Shortcut"]);
        expect((await places.browse("")).path).toBe(os.homedir());
        await expect(places.browse("relative")).rejects.toThrow("not a folder on this computer");
        await expect(places.browse(path.join(home, "Nope"))).rejects.toThrow("isn't there");
    });

    test("disks that can't be read are a problem until they can be again, from the first look on", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-places-"));
        // each report the looks make, as they make it
        const reports: { key: string; error: string | null }[] = [];
        let heard: (report: { key: string; error: string | null }) => void = (report) => reports.push(report);
        const next = () => new Promise<{ key: string; error: string | null }>((resolve) => (heard = resolve));
        let broken = true;
        const pushes: string[][] = [];
        const places = new Places({
            root: path.join(dir, "data/Drive"),
            saved: path.join(dir, "data/places.json"),
            disks: {
                read: async () => {
                    if (broken) throw new Error("mountinfo is gone");
                    return [];
                },
            },
            onChange: (list) => pushes.push(list.map((p) => p.id)),
            onUnplugged: () => {},
            onProblem: (key, _title, error) => heard({ key, error: error === null ? null : String(error) }),
        });
        // the first look fails too, and Drive still opens with its own folder
        await places.open();
        onTestFinished(async () => {
            await places.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });
        expect(reports).toEqual([{ key: "look", error: "Error: mountinfo is gone" }]);
        // every window still sees Drive's own folder
        expect(pushes).toEqual([["drive"]]);
        broken = false;
        expect(await next()).toEqual({ key: "look", error: null });
    });
});
