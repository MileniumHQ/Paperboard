// The disks plugged into this computer: USB drives, SD cards, a second disk
// mounted for its files. Not the disk the system runs from, and not the
// filesystems an OS mounts for itself.
//
// - Linux: the mounts in /proc/self/mountinfo under /media, /run/media or
//   /mnt, where desktops and udisks put them, named by their folder (udisks
//   names that after the disk's label).
// - macOS: the folders in /Volumes on a disk other than the system's.
// - Windows: the drive letters other than the system's that hold a local
//   disk (not a network share: that's a folder to link), named by its label.
//
// Ejecting asks the system to let the disk go (udisksctl, diskutil, the
// Windows shell), so it's safe to pull.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Disk {
    /** where its files are */
    mount: string;
    /** what people call it */
    name: string;
}

// filesystems a system mounts for itself, never someone's files
const SYSTEM_TYPES = new Set([
    "autofs", "binfmt_misc", "bpf", "cgroup", "cgroup2", "configfs", "debugfs", "devpts", "devtmpfs", "efivarfs", "fusectl",
    "hugetlbfs", "mqueue", "nsfs", "overlay", "proc", "pstore", "ramfs", "rpc_pipefs", "securityfs", "squashfs", "sysfs",
    "tmpfs", "tracefs", "fuse.portal", "fuse.gvfsd-fuse",
]);
// where Linux desktops, udisks and people mount disks for their files
const LINUX_DISK_ROOTS = ["/media/", "/run/media/", "/mnt/"];

/** mountinfo writes a space, tab, newline and backslash in a path as octal */
const unescape = (field: string) => field.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

/** A Linux mount, as /proc/self/mountinfo lists it. */
export interface LinuxMount {
    mount: string;
    type: string;
    /** the device, such as /dev/sdb1 */
    source: string;
}

export function parseMountInfo(text: string): LinuxMount[] {
    const mounts: LinuxMount[] = [];
    for (const line of text.split("\n")) {
        // id parent major:minor root mountpoint options [optional...] - type source superoptions
        const dash = line.indexOf(" - ");
        if (dash < 0) continue;
        const head = line.slice(0, dash).split(" ");
        const tail = line.slice(dash + 3).split(" ");
        if (head.length < 5 || tail.length < 2) continue;
        mounts.push({ mount: unescape(head[4]), type: tail[0], source: unescape(tail[1]) });
    }
    return mounts;
}

/** The mounts that are someone's disks. */
export function linuxDisks(mounts: LinuxMount[]): (Disk & { source: string })[] {
    const disks = mounts.filter(
        (m) => !SYSTEM_TYPES.has(m.type) && LINUX_DISK_ROOTS.some((root) => m.mount.startsWith(root) && m.mount.length > root.length),
    );
    // a disk mounted twice, or over another, shows once: the last mount at a path is the one there
    const byMount = new Map(disks.map((d) => [d.mount, d]));
    return [...byMount.values()].map((d) => ({ mount: d.mount, name: path.basename(d.mount), source: d.source }));
}

// Win32_LogicalDisk's DriveType: removable (a USB stick, an SD card), local (a second disk) and a disc
const WINDOWS_DISK_TYPES = new Set([2, 3, 5]);

interface WindowsVolume {
    disk: boolean;
    label: string;
}

async function windowsVolume(letter: string): Promise<WindowsVolume> {
    const query = `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter}:'" | Select-Object DriveType, VolumeName | ConvertTo-Json -Compress`;
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { timeout: 10_000, windowsHide: true });
    const found = JSON.parse(stdout) as { DriveType?: number; VolumeName?: string | null } | null;
    return { disk: WINDOWS_DISK_TYPES.has(found?.DriveType ?? 0), label: found?.VolumeName ?? "" };
}

/** The drive letters that hold something now, with what that is: a letter's device changes with what's put in it. */
export async function windowsLetters(): Promise<{ letter: string; dev: number }[]> {
    const present = await Promise.all(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(async (letter) => {
            try {
                return { letter, dev: (await fs.promises.stat(`${letter}:\\`)).dev };
            } catch (err) {
                // quiet: a letter with nothing in it (an empty card reader) holds no files
                void err;
                return null;
            }
        }),
    );
    return present.filter((p): p is { letter: string; dev: number } => p !== null);
}

export function windowsDiskName(letter: string, label: string): string {
    return `${label || "Disk"} (${letter}:)`;
}

/** Reads the disks plugged in now, on this system. */
export class DiskReader {
    // a volume is read once per letter and disk: PowerShell is slow to start
    private volumes = new Map<string, WindowsVolume>();

    async read(): Promise<Disk[]> {
        if (process.platform === "linux") return linuxDisks(parseMountInfo(await fs.promises.readFile("/proc/self/mountinfo", "utf8")));
        if (process.platform === "darwin") return this.mac();
        if (process.platform === "win32") return this.windows();
        return [];
    }

    private async mac(): Promise<Disk[]> {
        const system = (await fs.promises.stat("/")).dev;
        const names = await fs.promises.readdir("/Volumes");
        const disks = await Promise.all(
            names.map(async (name): Promise<Disk | null> => {
                const mount = path.join("/Volumes", name);
                // the system's own volume is a link back to /
                const st = await fs.promises.lstat(mount).catch((err: unknown) => {
                    // a disk ejected between listing and looking isn't there
                    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
                    throw err;
                });
                if (!st?.isDirectory() || st.dev === system) return null;
                return { mount, name };
            }),
        );
        return disks.filter((d): d is Disk => d !== null);
    }

    private async windows(): Promise<Disk[]> {
        const system = (process.env.SystemDrive ?? "C:").slice(0, 1).toUpperCase();
        const disks: Disk[] = [];
        for (const { letter, dev } of await windowsLetters()) {
            if (letter === system) continue;
            const key = `${letter}:${dev}`;
            let volume = this.volumes.get(key);
            if (!volume) {
                volume = await windowsVolume(letter).catch((err: unknown) => {
                    // quiet: a volume Windows can't describe is still a disk with files on it, named by its letter
                    void err;
                    return { disk: true, label: "" };
                });
                this.volumes.set(key, volume);
            }
            if (volume.disk) disks.push({ mount: `${letter}:\\`, name: windowsDiskName(letter, volume.label) });
        }
        return disks;
    }
}

/** Asks the system to let a disk go, so it can be pulled out. */
export async function ejectDisk(mount: string): Promise<void> {
    try {
        if (process.platform === "linux") {
            const disk = linuxDisks(parseMountInfo(await fs.promises.readFile("/proc/self/mountinfo", "utf8"))).find((d) => d.mount === mount);
            if (!disk) throw new Error("It isn't plugged in.");
            if (!disk.source.startsWith("/dev/")) throw new Error("It isn't a disk this computer can eject.");
            await run("udisksctl", ["unmount", "--no-user-interaction", "-b", disk.source], { timeout: 60_000 });
            // a disk with nothing mounted can be powered off; some (an SD card in a built-in reader) can't, and that's fine
            await run("udisksctl", ["power-off", "--no-user-interaction", "-b", disk.source], { timeout: 60_000 }).catch((err: unknown) => {
                // quiet: the disk is unmounted, which is what makes it safe to pull
                console.warn(`[drive] ${disk.source} is unmounted, but couldn't be powered off:`, err);
            });
            return;
        }
        if (process.platform === "darwin") {
            await run("diskutil", ["eject", mount], { timeout: 60_000 });
            return;
        }
        if (process.platform === "win32") {
            const letter = mount.slice(0, 2);
            const script = `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${letter}').InvokeVerb('Eject')`;
            await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 60_000, windowsHide: true });
            // the shell ejects in the background, and says nothing when it can't
            for (let waited = 0; waited < 15_000; waited += 500) {
                if (!fs.existsSync(mount)) return;
                await new Promise((r) => setTimeout(r, 500));
            }
            throw new Error("Windows didn't let it go. Close anything using its files, then try again.");
        }
        throw new Error("This system can't eject disks from Paperboard.");
    } catch (err) {
        const failure = err as { code?: string; stderr?: string; message?: string };
        if (failure.code === "ENOENT") throw new Error("This computer has no tool to eject disks with.");
        const said = failure.stderr?.trim().split("\n").at(-1);
        if (/busy/i.test(said ?? "")) throw new Error("Something is still using its files. Close it, then try again.");
        throw said ? new Error(said) : err;
    }
}
