// Which Linux mounts are someone's disks, read as /proc/self/mountinfo
// writes them: not the system's own filesystems, and names with spaces whole.
import { describe, expect, test } from "bun:test";
import { linuxDisks, parseMountInfo, windowsDiskName } from "../src/lib/disks";

const MOUNTINFO = [
    "22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw",
    "23 22 0:21 / /proc rw,nosuid shared:5 - proc proc rw",
    "24 22 0:22 / /run rw,nosuid shared:6 - tmpfs tmpfs rw",
    "25 22 259:1 / /boot rw,relatime shared:2 - vfat /dev/nvme0n1p1 rw",
    "90 24 8:17 / /run/media/pxl/Samsung\\040T7 rw,nosuid,nodev,relatime shared:300 - exfat /dev/sdb1 rw",
    "91 22 8:33 / /media/dev/SD\\040CARD rw,nosuid shared:301 - vfat /dev/sdc1 rw",
    "92 22 8:49 / /mnt/data rw,relatime shared:302 - ext4 /dev/sdd1 rw",
    "93 22 0:50 / /mnt/ram rw shared:303 - tmpfs tmpfs rw",
    "94 22 0:51 / /media/dev/phone rw shared:304 optional:1 - fuse.gvfsd-fuse gvfsd-fuse rw",
    "95 22 8:65 / /home/pxl/stuff rw shared:305 - ext4 /dev/sde1 rw",
].join("\n");

describe("disks", () => {
    test("Linux: the mounts under /media, /run/media and /mnt that are disks, named by their folder", () => {
        expect(linuxDisks(parseMountInfo(MOUNTINFO))).toEqual([
            { mount: "/run/media/pxl/Samsung T7", name: "Samsung T7", source: "/dev/sdb1" },
            { mount: "/media/dev/SD CARD", name: "SD CARD", source: "/dev/sdc1" },
            { mount: "/mnt/data", name: "data", source: "/dev/sdd1" },
        ]);
    });

    test("Linux: a path mounted twice shows once, as the mount on top", () => {
        const twice = ["90 22 8:17 / /mnt/x rw - ext4 /dev/sdb1 rw", "91 90 8:33 / /mnt/x rw - ext4 /dev/sdc1 rw"].join("\n");
        expect(linuxDisks(parseMountInfo(twice))).toEqual([{ mount: "/mnt/x", name: "x", source: "/dev/sdc1" }]);
    });

    test("Windows: a disk is its label and letter, or Disk when it has no label", () => {
        expect(windowsDiskName("E", "Samsung T7")).toBe("Samsung T7 (E:)");
        expect(windowsDiskName("F", "")).toBe("Disk (F:)");
    });
});
