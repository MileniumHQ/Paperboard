import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { linuxDownloads } from "../public/js/linux-downloads.mjs";
import { unsignedDownload } from "../public/js/unsigned-downloads.mjs";

const downloadsPage = readFileSync(path.join(import.meta.dir, "..", "src", "site", "pages", "downloads.md"), "utf8");
const pageLinks = new Set([...downloadsPage.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((m) => m[1]!));

const UNSIGNED = [
    ["pb", "paperboard-windows-x64-setup.exe", "windows", "Paperboard"],
    ["pb", "paperboard-macos-arm64.zip", "macos", "Paperboard"],
    ["pb", "paperboard-macos-x64.zip", "macos", "Paperboard"],
    ["crane", "crane-windows-x64.zip", "windows", "Paperboard server daemon"],
    ["crane", "crane-macos-arm64.tar.gz", "macos", "Paperboard server daemon"],
    ["crane", "crane-macos-x64.tar.gz", "macos", "Paperboard server daemon"],
] as const;

// Download helpers target exactly the real release files.
describe("download helpers target exactly the real release files", () => {
    test("the unsigned warning attaches to each Windows and macOS release link of its own app", () => {
        for (const [app, file, platform, name] of UNSIGNED) {
            const href = `https://i.paperboard.dev/${app}/latest/${file}`;
            expect(unsignedDownload(href)).toEqual({ platform, app: name, file, href });
            expect({ href, onPage: pageLinks.has(href) }).toEqual({ href, onPage: true });
        }
    });

    test("look-alike hosts, wrong paths and other files get no warning", () => {
        const refused = [
            "https://i.paperboard.dev.evil.test/pb/latest/paperboard-windows-x64-setup.exe",
            "https://evil.test/pb/latest/paperboard-windows-x64-setup.exe",
            "http://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe",
            "https://user@i.paperboard.dev:8443/pb/latest/paperboard-windows-x64-setup.exe",
            "https://i.paperboard.dev/crane/latest/paperboard-windows-x64-setup.exe",
            "https://i.paperboard.dev/pb/latest/crane-windows-x64.zip",
            "https://i.paperboard.dev/pb/0.3.0/paperboard-windows-x64-setup.exe",
            "https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe/extra",
            "https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe?x=1",
            "https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe#top",
            "https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage",
            "https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz",
            "/pb/latest/paperboard-windows-x64-setup.exe",
            "not a url",
        ];
        for (const href of refused) expect({ href, warning: unsignedDownload(href) }).toEqual({ href, warning: null });
    });

    test("a Linux AppImage link offers the AppImage, deb and rpm of the same architecture, all on the downloads page", () => {
        for (const [arch, label] of [["x64", "x64"], ["arm64", "ARM64"]] as const) {
            const offer = linuxDownloads(`https://i.paperboard.dev/pb/latest/paperboard-linux-${arch}.AppImage`);
            expect(offer?.architecture).toBe(label);
            expect(offer?.choices.map((c) => [c.id, c.file])).toEqual([
                ["appimage", `paperboard-linux-${arch}.AppImage`],
                ["deb", `paperboard-linux-${arch}.deb`],
                ["rpm", `paperboard-linux-${arch}.rpm`],
            ]);
            for (const choice of offer!.choices) {
                expect(choice.href).toBe(`https://i.paperboard.dev/pb/latest/${choice.file}`);
                expect({ href: choice.href, onPage: pageLinks.has(choice.href) }).toEqual({ href: choice.href, onPage: true });
            }
        }
    });

    test("other links get no Linux choices", () => {
        for (const href of [
            "https://i.paperboard.dev.evil.test/pb/latest/paperboard-linux-x64.AppImage",
            "https://i.paperboard.dev/pb/latest/paperboard-linux-riscv64.AppImage",
            "https://i.paperboard.dev/pb/latest/paperboard-linux-x64.deb",
            "https://i.paperboard.dev/crane/latest/paperboard-linux-x64.AppImage",
            "https://i.paperboard.dev/pb/0.3.0/paperboard-linux-x64.AppImage",
            "https://i.paperboard.dev/pb/latest/paperboard-linux-x64.AppImage?x=1",
            "https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe",
            "not a url",
        ]) {
            expect({ href, offer: linuxDownloads(href) }).toEqual({ href, offer: null });
        }
    });
});
