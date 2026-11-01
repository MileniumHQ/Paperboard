import type { PackageRequirement } from "./types";

/**
 * A Microsoft runtime a game's Windows server loads and doesn't carry
 * itself. Without it the server exits at once (a missing DLL, 0xC0000135,
 * or a .NET load error) and says nothing. A computer that has it installed
 * uses its own; otherwise the start installs Origami's copy and puts it
 * beside the server's executable, where Windows and .NET look first
 * (provideWindowsRuntime in windowsRuntimeInstall.ts).
 */
export interface WindowsRuntime {
    name: string;
    /** what Windows' own install puts in the Windows folder, /-separated; all must be there */
    files: readonly string[];
    package: PackageRequirement;
}

/** Visual C++ 2015–2022, 64-bit: Unreal Engine servers such as Palworld's. */
export const VISUAL_CPP_X64: WindowsRuntime = {
    name: "Microsoft Visual C++ Redistributable 2015–2022 (x64)",
    files: ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"].map(dll => `System32/${dll}`),
    package: { id: "vc-runtime", purpose: "Visual C++ runtime for the server on Windows computers without it" },
};

/** XNA Framework 4.0: Terraria's Windows server, which is 32-bit. */
export const XNA_4: WindowsRuntime = {
    name: "Microsoft XNA Framework Redistributable 4.0",
    files: ["Microsoft.NET/assembly/GAC_32/Microsoft.Xna.Framework/v4.0_4.0.0.0__842cf8be1de50553/Microsoft.Xna.Framework.dll"],
    package: { id: "xna-framework", purpose: "XNA Framework for the server on Windows computers without it" },
};
