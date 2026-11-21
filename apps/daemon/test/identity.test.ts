// A computer's identity is read from real machines' files: these fixtures
// are what each kind of computer actually holds.
import { describe, expect, test } from "bun:test";
import { identify, parseOsRelease, WINDOWS_BIOS, WINDOWS_CURRENT_VERSION, type SystemProbe } from "../src/system/identity";

function probe(facts: Partial<Omit<SystemProbe, "read" | "exists" | "list">> & { files?: Record<string, string>; dirs?: Record<string, string[]> }): SystemProbe {
    const files = facts.files ?? {};
    const dirs = facts.dirs ?? {};
    return {
        platform: "linux",
        release: "6.12.0",
        hostname: "box-1",
        username: "pxl",
        home: "/home/pxl",
        env: {},
        registry: {},
        ...facts,
        read: (path) => files[path],
        exists: (path) => path in files || path in dirs,
        list: (dir) => dirs[dir] ?? [],
    };
}

const ARCH = 'NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\nID=arch\nBUILD_ID=rolling\n';
const DEBIAN = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\nID=debian\n';

describe("os-release", () => {
    test("reads quoted, unquoted and escaped values, and skips comments", () => {
        expect(parseOsRelease('# c\nID="rocky"\nID_LIKE=fedora\nPRETTY_NAME="Say \\"hi\\""\nNAME=\'Single\'\n')).toEqual({
            ID: "rocky",
            ID_LIKE: "fedora",
            PRETTY_NAME: 'Say "hi"',
            NAME: "Single",
        });
    });

    test("a rolling distro has no version: not the word rolling, not its kernel", () => {
        const id = identify(probe({ release: "7.2.14-arch1-1", files: { "/etc/os-release": ARCH } }));
        expect(id).toMatchObject({ os: "linux", distroId: "arch", distroName: "Arch Linux" });
        expect(id.osVersion).toBeUndefined();
    });
});

describe("flavors", () => {
    test("Omarchy is named from its pacman package, not one that shares its prefix", () => {
        const id = identify(probe({
            files: { "/etc/os-release": ARCH },
            dirs: { "/var/lib/pacman/local": ["omarchy-keyring-20250101-1", "omarchy-4.1.2-1", "hyprland-0.50.0-1"] },
        }));
        expect(id.flavor).toEqual({ id: "omarchy", name: "Omarchy", version: "4.1.2" });
        const checkout = identify(probe({ files: { "/etc/os-release": ARCH, "/home/pxl/.local/share/omarchy/version": "3.5.0\n" } }));
        expect(checkout.flavor).toEqual({ id: "omarchy", name: "Omarchy", version: "3.5.0" });
        const keyringOnly = identify(probe({ files: { "/etc/os-release": ARCH }, dirs: { "/var/lib/pacman/local": ["omarchy-keyring-20250101-1"] } }));
        expect(keyringOnly.flavor).toBeUndefined();
    });

    test("Raspberry Pi OS reports Debian, and its image leaves /etc/rpi-issue", () => {
        const id = identify(probe({
            files: {
                "/etc/os-release": DEBIAN,
                "/etc/rpi-issue": "Raspberry Pi reference 2024-11-19\n",
                "/proc/device-tree/model": "Raspberry Pi 5 Model B Rev 1.0\0",
            },
        }));
        expect(id).toMatchObject({
            distroId: "debian",
            flavor: { id: "raspberrypi", name: "Raspberry Pi OS", version: "Bookworm" },
            // a device-tree board has no DMI: its model names it
            board: "Raspberry Pi 5 Model B Rev 1.0",
        });
    });
});

describe("machines and motherboards", () => {
    test("Crostini names ChromeOS and its milestone", () => {
        const id = identify(probe({ files: { "/etc/os-release": DEBIAN, "/opt/google/cros-containers": "", "/dev/.cros_milestone": "142\n" } }));
        expect(id.machine).toEqual({ id: "chromeos", name: "ChromeOS", version: "142" });
    });

    test("WSL 2 is read from its kernel", () => {
        const id = identify(probe({ release: "6.6.87.2-microsoft-standard-WSL2", files: { "/etc/os-release": DEBIAN } }));
        expect(id.machine).toEqual({ id: "wsl", name: "WSL", version: "2" });
    });

    test("a cloud VM is named by its DMI, and has no motherboard", () => {
        const id = identify(probe({
            files: {
                "/etc/os-release": DEBIAN,
                "/sys/class/dmi/id/sys_vendor": "Hetzner\n",
                "/sys/class/dmi/id/product_name": "vServer\n",
                "/sys/class/dmi/id/board_vendor": "QEMU\n",
                "/sys/class/dmi/id/board_name": "Standard PC (Q35 + ICH9, 2009)\n",
            },
        }));
        expect(id.machine).toEqual({ id: "hetzner", name: "Hetzner Cloud" });
        expect(id.board).toBeUndefined();
    });

    test("a hypervisor no rule names is still a virtual machine", () => {
        const id = identify(probe({ files: { "/etc/os-release": DEBIAN, "/proc/cpuinfo": "processor : 0\nflags : fpu vme hypervisor lahf_lm\n" } }));
        expect(id.machine).toEqual({ id: "vm", name: "Virtual machine" });
    });

    test("a retail board is named by its maker; laptops, prebuilts and placeholders have none", () => {
        const board = (dmi: Record<string, string>) =>
            identify(probe({ files: Object.fromEntries(Object.entries(dmi).map(([k, v]) => [`/sys/class/dmi/id/${k}`, `${v}\n`])) })).board;
        expect(board({ board_vendor: "ASUSTeK COMPUTER INC.", board_name: "ROG STRIX B650E-F GAMING WIFI", product_name: "System Product Name", chassis_type: "3" }))
            .toBe("ASUS ROG STRIX B650E-F GAMING WIFI");
        expect(board({ board_vendor: "ASRock", board_name: "B850M Pro-A WiFi", product_name: "B850M Pro-A WiFi", chassis_type: "3" })).toBe("ASRock B850M Pro-A WiFi");
        expect(board({ board_vendor: "Micro-Star International Co., Ltd.", board_name: "MAG B550 TOMAHAWK (MS-7C91)", product_name: "MS-7C91" }))
            .toBe("MSI MAG B550 TOMAHAWK (MS-7C91)");
        // part numbers: a laptop's, a prebuilt's, a Mac's
        expect(board({ board_vendor: "ASUSTeK COMPUTER INC.", board_name: "G513QY", product_name: "ROG Strix G513QY", chassis_type: "10" })).toBeUndefined();
        expect(board({ board_vendor: "Dell Inc.", board_name: "0KFHNV", product_name: "XPS 13 9310" })).toBeUndefined();
        expect(board({ board_vendor: "Apple Inc.", board_name: "Mac-189A3D4F975D5FFC", product_name: "MacBookPro11,1" })).toBeUndefined();
        expect(board({ board_vendor: "To be filled by O.E.M.", board_name: "Default string" })).toBeUndefined();
    });
});

describe("operators", () => {
    test("Claude Duet's container is named in /container_info.json", () => {
        const id = identify(probe({
            env: { CLAUDE_CODE_REMOTE: "true" },
            files: { "/etc/os-release": DEBIAN, "/container_info.json": '{"container_name":"user--aibo--1234"}' },
        }));
        expect(id.operator).toEqual({ id: "claude-duet", name: "Claude Duet" });
    });

    test("Claude Code on the web shares Duet's variable without Duet's container", () => {
        const id = identify(probe({ env: { CLAUDE_CODE_REMOTE: "true" }, files: { "/etc/os-release": DEBIAN, "/container_info.json": '{"container_name":"session-1"}' } }));
        expect(id.operator).toEqual({ id: "claude-code", name: "Claude Code" });
    });

    test("Grok Bot needs two of its marks: a user named box alone is anyone's", () => {
        expect(identify(probe({ username: "box" })).operator).toBeUndefined();
        const id = identify(probe({ username: "box", hostname: "grok-bot-vm-abc123" }));
        expect(id.operator).toEqual({ id: "grok-bot", name: "Grok Bot" });
    });
});

describe("Windows and macOS", () => {
    test("Windows 11 is told by its build, and Hyper-V by its BIOS", () => {
        const id = identify(probe({
            platform: "win32",
            release: "10.0.26100",
            registry: {
                [WINDOWS_CURRENT_VERSION]: { ProductName: "Windows 10 Pro", DisplayVersion: "24H2", InstallationType: "Client" },
                [WINDOWS_BIOS]: { SystemManufacturer: "Microsoft Corporation", SystemProductName: "Virtual Machine", BaseBoardManufacturer: "Microsoft Corporation", BaseBoardProduct: "Virtual Machine" },
            },
        }));
        expect(id).toMatchObject({ os: "windows", distroId: "windows", osVersion: "11 24H2", machine: { id: "hyperv", name: "Hyper-V" } });
        expect(id.board).toBeUndefined();
    });

    test("Windows Server is named by its year", () => {
        const id = identify(probe({
            platform: "win32",
            release: "10.0.26100",
            registry: { [WINDOWS_CURRENT_VERSION]: { ProductName: "Windows Server 2025 Datacenter", DisplayVersion: "24H2", InstallationType: "Server" } },
        }));
        expect(id).toMatchObject({ distroId: "windows-server", distroName: "Windows Server", osVersion: "2025" });
    });

    test("macOS 26 is Tahoe", () => {
        expect(identify(probe({ platform: "darwin", release: "25.1.0" }))).toMatchObject({ os: "macos", osVersion: "26", distroName: "macOS Tahoe" });
    });
});
