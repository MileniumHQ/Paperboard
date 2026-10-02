// Windows executable icon patcher for the standalone PaperCrane binaries.
//
// Bun's `--windows-icon` flag is rejected unless the build runs ON Windows,
// so a cross-built `papercrane-windows-*.exe` otherwise keeps Bun's default
// logo. This replaces the PE icon resources in place after compilation,
// using the `papercrane/branding/icon.ico` artwork, on any host.
//
// It never moves sections: only the bytes inside the existing `.rsrc`
// allocation and the Resource data-directory size are rewritten. That is
// deliberate — a Bun executable appends its payload in sections after
// `.rsrc` (`.bun`), and relocating their virtual addresses breaks the
// compiled runtime. A full resource-section rebuild is refused loudly when
// the new icon does not fit the existing allocation.

import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

const RESOURCE_DIRECTORY_ENTRY = 2;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const ICON_GROUP_ID = 1;
const ICON_LANG = 1033;

const DOS_LFANEW_OFFSET = 0x3c;
const COFF_HEADER_SIZE = 20;
const PE_SIGNATURE_SIZE = 4;
const PE32_MAGIC = 0x10b;
const PE32PLUS_MAGIC = 0x20b;
const PE32_OPTIONAL_HEADER_SIZE = 96;
const PE32PLUS_OPTIONAL_HEADER_SIZE = 112;
const DATA_DIRECTORY_ENTRY_SIZE = 8;
const RESOURCE_DIRECTORY_SIZE_OFFSET = 4;

function sectionName(section: { info: { name: string } }): string {
    return section.info.name.replace(/\0+$/, "");
}

// pe-library refuses to parse resource data when a non-relocation section
// follows `.rsrc` — exactly the layout Bun produces (`.bun`). Hide those
// trailing sections from that parse only; nothing downstream writes section
// headers, so the real layout is untouched.
function parseView(exe: NtExecutable): NtExecutable {
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

function resourceDirectorySizeFieldOffset(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const peOffset = view.getUint32(DOS_LFANEW_OFFSET, true);
    const optionalHeader = peOffset + PE_SIGNATURE_SIZE + COFF_HEADER_SIZE;
    const magic = view.getUint16(optionalHeader, true);
    if (magic !== PE32_MAGIC && magic !== PE32PLUS_MAGIC) {
        throw new Error(
            `not a PE executable (optional header magic 0x${magic.toString(16)})`,
        );
    }
    const optionalHeaderSize =
        magic === PE32PLUS_MAGIC
            ? PE32PLUS_OPTIONAL_HEADER_SIZE
            : PE32_OPTIONAL_HEADER_SIZE;
    return (
        optionalHeader +
        optionalHeaderSize +
        RESOURCE_DIRECTORY_ENTRY * DATA_DIRECTORY_ENTRY_SIZE +
        RESOURCE_DIRECTORY_SIZE_OFFSET
    );
}

/**
 * Returns a copy of `exeBytes` whose icon resources are exactly the frames
 * of `icoBytes`. Pure: the input buffers are not mutated.
 */
export function patchPeIcon(exeBytes: Uint8Array, icoBytes: Uint8Array): Uint8Array {
    const exe = NtExecutable.from(exeBytes, { ignoreCert: true });
    const resources = NtExecutableResource.from(parseView(exe));
    const section = resources.sectionDataHeader;
    if (!section) throw new Error("executable has no .rsrc section to patch");

    // Drop every existing icon and icon-group resource first: replacement
    // keys off the group entry, and Bun's default group is a named entry
    // ("IDI_MYICON") that a numeric replacement would leave behind.
    const kept = resources.entries.filter(
        (entry) => entry.type !== RT_ICON && entry.type !== RT_GROUP_ICON,
    );
    resources.entries.length = 0;
    resources.entries.push(...kept);

    const iconFile = Data.IconFile.from(icoBytes);
    if (!iconFile.icons.length) throw new Error("icon file contains no frames");
    Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        ICON_GROUP_ID,
        ICON_LANG,
        iconFile.icons.map((icon) => icon.data),
    );

    const { bin, rawSize } = resources.generateResourceData(
        section.virtualAddress,
        exe.getFileAlignment(),
        true,
        true,
    );
    if (bin.byteLength > section.sizeOfRawData) {
        throw new Error(
            `icon resource data (${bin.byteLength} bytes) does not fit the existing ` +
                `.rsrc allocation (${section.sizeOfRawData} bytes)`,
        );
    }

    const out = Uint8Array.from(exeBytes);
    out.set(new Uint8Array(bin), section.pointerToRawData);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
        resourceDirectorySizeFieldOffset(out),
        rawSize,
        true,
    );
    return out;
}

/** Rewrites `exePath` in place with the icon from `icoPath`. */
export function applyWindowsIcon(exePath: string, icoPath: string): void {
    const patched = patchPeIcon(readFileSync(exePath), readFileSync(icoPath));
    const tempPath = `${exePath}.icon.tmp`;
    try {
        writeFileSync(tempPath, patched);
        renameSync(tempPath, exePath);
    } catch (err) {
        console.error(`[windowsIcon] could not replace ${exePath}:`, err);
        try {
            unlinkSync(tempPath);
        } catch (cleanupErr) {
            console.error(`[windowsIcon] could not remove ${tempPath}:`, cleanupErr);
        }
        throw err;
    }
}
