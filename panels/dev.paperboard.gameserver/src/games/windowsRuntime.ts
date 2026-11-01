import path from "node:path";
import { exists } from "./serviceKit";

/**
 * A Microsoft runtime a game's Windows server loads from the system and
 * doesn't carry itself. Without it the server exits at once (a missing DLL,
 * 0xC0000135, or a .NET load error) and says nothing, so the start refuses
 * first and names what to install.
 */
export interface WindowsRuntime {
    name: string;
    /** what it installs, relative to the Windows folder; all must be there */
    files: readonly string[];
    download: string;
}

/** Visual C++ 2015–2022, 64-bit: Unreal Engine servers such as Palworld's. */
export const VISUAL_CPP_X64: WindowsRuntime = {
    name: "Microsoft Visual C++ Redistributable 2015–2022 (x64)",
    files: ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"].map(dll => path.join("System32", dll)),
    download: "https://aka.ms/vs/17/release/vc_redist.x64.exe",
};

/** XNA Framework 4.0: Terraria's Windows server, which is 32-bit. */
export const XNA_4: WindowsRuntime = {
    name: "Microsoft XNA Framework Redistributable 4.0",
    files: [path.join("Microsoft.NET", "assembly", "GAC_32", "Microsoft.Xna.Framework", "v4.0_4.0.0.0__842cf8be1de50553", "Microsoft.Xna.Framework.dll")],
    download: "https://www.microsoft.com/en-us/download/details.aspx?id=20914",
};

export async function assertWindowsRuntime(server: string, runtime: WindowsRuntime, windir = process.env.SystemRoot): Promise<void> {
    if (!windir) throw new Error(`Could not check for ${runtime.name}: Windows did not say where it is installed (SystemRoot is not set)`);
    for (const file of runtime.files) {
        if (await exists(path.join(windir, file))) continue;
        throw new Error(`The ${server} needs ${runtime.name}, which this computer doesn't have. Install it from ${runtime.download}, then start again.`);
    }
}
