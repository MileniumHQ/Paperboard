import type { LaunchCommand } from "../serviceTypes";

/**
 * Terraria and tModLoader set Console.InputEncoding to Unicode on Windows,
 * so their console reads commands as UTF-16; sent as UTF-8 a command never
 * forms a line and the server ignores it.
 */
export const consoleInput = (os: string): LaunchCommand["inputEncoding"] => os === "win32" ? "utf16le" : "utf8";
