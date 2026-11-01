import { describe, expect, it } from "bun:test";
import { buildWindowsRuntimeRecord, buildWindowsRuntimeRecords, WINDOWS_RUNTIMES } from "../scripts/update-windows-runtimes";

// The pins are reviewed upstream facts: a record carries only bytes that hash
// to them, for the Windows x64 hosts the Game Server panel runs these servers on.
describe("update-windows-runtimes", () => {
    const pinned = (name: string) => WINDOWS_RUNTIMES.find((r) => r.name === name)!;
    it("builds XNA Framework 4.0 from its MSI and the Visual C++ CRT from Visual Studio's catalog", () => {
        const xna = buildWindowsRuntimeRecord(pinned("xna-framework"), { sha256: pinned("xna-framework").sha256, size: 10 });
        expect(Object.keys(xna.platforms)).toEqual(["windows-x64"]);
        expect(xna.platforms["windows-x64"]?.recipe).toEqual({
            unpack: "msi",
            take: {
                "bin/Microsoft.Xna.Framework.dll": "Microsoft_Xna_Framework_dll_GAC",
                "bin/Microsoft.Xna.Framework.Game.dll": "Microsoft_Xna_Framework_Game_dll_GAC",
                "bin/Microsoft.Xna.Framework.Graphics.dll": "Microsoft_Xna_Framework_Graphics_dll_GAC",
                "bin/Microsoft.Xna.Framework.Xact.dll": "Microsoft_Xna_Framework_Xact_dll_GAC",
                "bin/XnaNative.dll": "XnaNative_dll_File",
                "bin/msvcr100.dll": "F_CENTRAL_msvcr100_x86.DF495DFD_79F6_34DF_BB1E_E58DB5BDCF2C",
                "bin/msvcp100.dll": "F_CENTRAL_msvcp100_x86.DF495DFD_79F6_34DF_BB1E_E58DB5BDCF2C",
            },
        });
        const crt = buildWindowsRuntimeRecord(pinned("vc-runtime"), { sha256: pinned("vc-runtime").sha256, size: 10 });
        expect(crt.version).toBe("14.44.35211");
        expect(crt.platforms["windows-x64"]?.recipe).toEqual({ unpack: "zip", take: { bin: "Contents/VC/Redist/MSVC/14.44.35112/x64/Microsoft.VC143.CRT" } });
    });
    it("refuses changed downloads and HTTP errors", async () => {
        expect(() => buildWindowsRuntimeRecord(pinned("vc-runtime"), { sha256: "0".repeat(64), size: 10 })).toThrow(/reviewed pin/);
        await expect(buildWindowsRuntimeRecords((async () => new Response("changed")) as unknown as typeof fetch)).rejects.toThrow(/reviewed pin/);
        await expect(buildWindowsRuntimeRecords((async () => new Response("missing", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    });
});
