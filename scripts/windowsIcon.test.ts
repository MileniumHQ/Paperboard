import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { patchPeIcon } from "./windowsIcon";

const ICON_PATH = join(
    import.meta.dir,
    "..",
    "apps",
    "paperboard",
    "papercrane",
    "branding",
    "icon.ico",
);

function sectionName(section: { info: { name: string } }): string {
    return section.info.name.replace(/\0+$/, "");
}

function iconGroups(exe: NtExecutable) {
    const resource = NtExecutableResource.from(viewOf(exe));
    return Resource.IconGroupEntry.fromEntries(resource.entries);
}

// Same trailing-section filter the patcher uses, so the test can read back
// the Bun-shaped layout it builds.
function viewOf(exe: NtExecutable): NtExecutable {
    const resource = exe.getAllSections().find((s) => sectionName(s) === ".rsrc");
    if (!resource) return exe;
    const resourceVA = resource.info.virtualAddress;
    const view = Object.create(exe) as NtExecutable;
    view.getAllSections = () =>
        exe
            .getAllSections()
            .filter(
                (s) =>
                    s.info.virtualAddress <= resourceVA || sectionName(s) === ".reloc",
            );
    return view;
}

// A stand-in for a Bun-compiled executable: a named single-frame icon group
// (Bun ships "IDI_MYICON") plus a non-relocation section appended after
// `.rsrc`, which is the layout resedit's own writer refuses to touch.
function syntheticWindowsExe(icoBytes: Uint8Array): Uint8Array {
    const exe = NtExecutable.createEmpty(false, false);
    const resources = NtExecutableResource.from(exe);
    const iconFile = Data.IconFile.from(icoBytes);
    Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        "IDI_MYICON",
        1033,
        iconFile.icons.map((icon) => icon.data),
    );
    resources.outputResource(exe);
    exe.setSectionByEntry(12, {
        info: {
            name: ".bun",
            virtualSize: 0x100,
            virtualAddress: 0,
            sizeOfRawData: 0,
            pointerToRawData: 0,
            pointerToRelocations: 0,
            pointerToLineNumbers: 0,
            numberOfRelocations: 0,
            numberOfLineNumbers: 0,
            characteristics: 0x40000040,
        },
        data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
    });
    return new Uint8Array(exe.generate());
}

describe("patchPeIcon", () => {
    test("replaces the executable icon with every frame of the branding ico", () => {
        const icoBytes = readFileSync(ICON_PATH);
        const before = syntheticWindowsExe(icoBytes);
        const expectedFrames = Data.IconFile.from(icoBytes).icons.length;
        expect(expectedFrames).toBeGreaterThan(1);

        const patched = patchPeIcon(before, icoBytes);
        const groups = iconGroups(NtExecutable.from(patched, { ignoreCert: true }));

        expect(groups).toHaveLength(1);
        expect(groups[0].id).toBe(1);
        expect(groups[0].icons).toHaveLength(expectedFrames);
    });

    test("keeps the sections after .rsrc in place", () => {
        const icoBytes = readFileSync(ICON_PATH);
        const before = syntheticWindowsExe(icoBytes);
        const beforeExe = NtExecutable.from(before, { ignoreCert: true });
        const beforeBun = beforeExe
            .getAllSections()
            .find((s) => sectionName(s) === ".bun");
        expect(beforeBun).toBeDefined();

        const patched = patchPeIcon(before, icoBytes);
        const afterBun = NtExecutable.from(patched, { ignoreCert: true })
            .getAllSections()
            .find((s) => sectionName(s) === ".bun");

        expect(afterBun?.info.virtualAddress).toBe(beforeBun?.info.virtualAddress);
        expect(afterBun?.info.pointerToRawData).toBe(beforeBun?.info.pointerToRawData);
        expect(patched.byteLength).toBe(before.byteLength);
        expect(patched).not.toEqual(before);
    });

    test("does not mutate the input executable", () => {
        const icoBytes = readFileSync(ICON_PATH);
        const before = syntheticWindowsExe(icoBytes);
        const snapshot = Uint8Array.from(before);
        patchPeIcon(before, icoBytes);
        expect(before).toEqual(snapshot);
    });
});
