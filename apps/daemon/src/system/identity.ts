// Who this computer is, in layers: the OS it runs, what is built on that OS
// (Omarchy on Arch), the machine it runs in (Crostini, WSL, a cloud VM), the
// motherboard of a bare-metal box, and an autonomous agent operating it.
//
// Every rule reads facts through a SystemProbe, so the rules are one pure
// function the tests drive with a machine's real files.
import * as fs from "fs";
import * as os from "os";

export interface SystemProbe {
    platform: NodeJS.Platform;
    /** os.release(): the kernel (Linux), Darwin (macOS) or NT build (Windows) */
    release: string;
    hostname: string;
    username: string;
    home: string;
    env: Readonly<Record<string, string | undefined>>;
    /** a file's text, or undefined when there is none to read */
    read(path: string): string | undefined;
    exists(path: string): boolean;
    /** a directory's entries, or none when there is no such directory */
    list(dir: string): string[];
    /** Windows registry values by key, as `reg query` prints them; empty elsewhere */
    registry: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** macOS: whether it runs under a hypervisor (sysctl kern.hv_vmm_present) */
    macVirtual?: boolean;
}

/** One named layer of a computer's identity. */
export interface IdentityPart {
    /** stable lowercase id the shell keys its brand on */
    id: string;
    name: string;
    version?: string;
}

export interface ComputerIdentity {
    os: string;
    osVersion: string;
    distroId?: string;
    distroName?: string;
    /** what is built on the OS: Omarchy on Arch, Proxmox VE on Debian */
    flavor?: IdentityPart;
    /** what the OS runs in: ChromeOS (Crostini), WSL, a container, a cloud VM */
    machine?: IdentityPart;
    /** the motherboard, on a computer that is not a virtual machine */
    board?: string;
    /** an autonomous agent operating this computer */
    operator?: IdentityPart;
}

export const WINDOWS_CURRENT_VERSION = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
export const WINDOWS_BIOS = "HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS";

// ---------------------------------------------------------------- parsing

/** os-release(5): KEY=value lines, values optionally quoted with shell escapes. */
export function parseOsRelease(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        let value = line.slice(eq + 1).trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
            value = value.slice(1, -1);
            if (quote === '"') value = value.replace(/\\(["\\$`])/g, "$1");
        }
        out[line.slice(0, eq)] = value;
    }
    return out;
}

/** `reg query` output: `    Name    REG_SZ    Value` lines. */
export function parseRegQuery(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s+(\S(?:.*?\S)?)\s+REG_(?:SZ|EXPAND_SZ|DWORD|MULTI_SZ)\s+(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2];
    }
    return out;
}

const firstLine = (text: string | undefined): string | undefined => {
    const line = text?.split("\n")[0].replace(/\0/g, "").trim();
    return line || undefined;
};

// ---------------------------------------------------------------- macOS

// Darwin 20-24 were macOS 11-15. Apple then moved to year numbers: Darwin 25
// is macOS 26, so from there the macOS major is Darwin + 1. Older releases
// (10.x) pass the raw Darwin release through for the shell to map.
export function macosVersionFromDarwin(release: string): string {
    const darwinMajor = parseInt(release.split(".")[0], 10);
    if (isNaN(darwinMajor) || darwinMajor < 20) return release;
    return (darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor - 9).toString();
}

const MACOS_NAMES: Record<string, string> = {
    "11": "Big Sur",
    "12": "Monterey",
    "13": "Ventura",
    "14": "Sonoma",
    "15": "Sequoia",
    "26": "Tahoe",
    "27": "Golden Gate",
};

// ---------------------------------------------------------------- flavors

type Detector = (probe: SystemProbe, release: Record<string, string>) => IdentityPart | undefined;

/** a pacman package's installed version: its local database entry is `<name>-<pkgver>-<pkgrel>` */
function pacmanVersion(probe: SystemProbe, pkg: string): string | undefined {
    const entry = probe.list("/var/lib/pacman/local").find((e) => {
        if (!e.startsWith(`${pkg}-`)) return false;
        // the rest is exactly "<pkgver>-<pkgrel>": a longer name like omarchy-keyring has more dashes
        return /^[^-]+-[^-]+$/.test(e.slice(pkg.length + 1));
    });
    if (!entry) return undefined;
    const pkgver = entry.slice(pkg.length + 1).split("-")[0];
    // an epoch ("1:2.0") is packaging, not the version people know
    return pkgver.replace(/^\d+:/, "");
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const FLAVORS: Detector[] = [
    // Omarchy 4 is the `omarchy` pacman package (`omarchy-dev` on the edge
    // channel), as omarchy-version reads it; 3.x was a checkout in
    // ~/.local/share/omarchy with a version file
    (probe) => {
        const version =
            pacmanVersion(probe, "omarchy") ??
            pacmanVersion(probe, "omarchy-dev") ??
            firstLine(probe.read(`${probe.home}/.local/share/omarchy/version`));
        if (version) return { id: "omarchy", name: "Omarchy", version };
        if (probe.exists("/usr/share/omarchy") || probe.exists(`${probe.home}/.local/share/omarchy`)) return { id: "omarchy", name: "Omarchy" };
        return undefined;
    },
    // Raspberry Pi OS reports Debian since bookworm; its image leaves /etc/rpi-issue
    (probe, release) => {
        if (!probe.exists("/etc/rpi-issue")) return undefined;
        const codename = release.VERSION_CODENAME;
        return { id: "raspberrypi", name: "Raspberry Pi OS", ...(codename ? { version: capitalize(codename) } : {}) };
    },
    // Proxmox VE is Debian with its own manager, whose version pve-manager builds into PVE::pvecfg
    (probe) => {
        if (!probe.exists("/usr/bin/pveversion")) return undefined;
        const version = /sub version\s*\{\s*return\s*'([^']+)'/.exec(probe.read("/usr/share/perl5/PVE/pvecfg.pm") ?? "")?.[1];
        return { id: "proxmox", name: "Proxmox VE", ...(version ? { version } : {}) };
    },
    // TrueNAS SCALE is Debian; its middleware reads the version from the manifest
    (probe) => {
        if (!probe.exists("/usr/local/bin/freenas-debug")) return undefined;
        let version: string | undefined;
        try {
            const v = (JSON.parse(probe.read("/data/manifest.json") ?? "{}") as { version?: unknown }).version;
            if (typeof v === "string" && v) version = v;
        } catch {
            version = undefined; // quiet: a manifest that is not JSON leaves the version out; TrueNAS is still named
        }
        return { id: "truenas", name: "TrueNAS", ...(version ? { version } : {}) };
    },
    // Unraid: version="7.1.4"
    (probe) => {
        const text = probe.read("/etc/unraid-version");
        if (text === undefined) return undefined;
        const version = parseOsRelease(text).version;
        return { id: "unraid", name: "Unraid", ...(version ? { version } : {}) };
    },
    // Synology DSM: productversion="7.2.2" in its VERSION file
    (probe) => {
        if (!probe.exists("/usr/syno")) return undefined;
        const version = parseOsRelease(probe.read("/etc.defaults/VERSION") ?? probe.read("/etc/VERSION") ?? "").productversion;
        return { id: "synology", name: "Synology DSM", ...(version ? { version } : {}) };
    },
];

// ---------------------------------------------------------------- machines

interface VmRule {
    id: string;
    name: string;
    vendor?: RegExp;
    product?: RegExp;
    asset?: RegExp;
    /** matched against the vendor or the product, as systemd-detect-virt does */
    either?: RegExp;
}

// DMI (Linux /sys/class/dmi/id, Windows HKLM\...\BIOS) of clouds and hypervisors.
// The first rule whose given fields all match names the machine.
const VM_RULES: VmRule[] = [
    { id: "azure", name: "Azure", asset: /^7783-7084-3265-9085-8269-3286-77$/ },
    { id: "aws", name: "AWS EC2", vendor: /^Amazon EC2$/ },
    { id: "gcp", name: "Google Cloud", product: /^Google Compute Engine$/ },
    { id: "digitalocean", name: "DigitalOcean", vendor: /^DigitalOcean$/ },
    { id: "hetzner", name: "Hetzner Cloud", vendor: /^Hetzner$/ },
    { id: "linode", name: "Akamai Cloud", vendor: /^(Linode|Akamai)$/ },
    { id: "vultr", name: "Vultr", vendor: /^Vultr$/ },
    { id: "oracle", name: "Oracle Cloud", asset: /^OracleCloud\.com$/ },
    { id: "scaleway", name: "Scaleway", vendor: /^Scaleway$/ },
    { id: "alibaba", name: "Alibaba Cloud", product: /^Alibaba Cloud ECS/ },
    { id: "openstack", name: "OpenStack", product: /^OpenStack (Nova|Compute)$/ },
    { id: "apple-virtualization", name: "Apple Virtualization", either: /^Apple Virtualization/ },
    { id: "vmware", name: "VMware", vendor: /^VMware/ },
    { id: "virtualbox", name: "VirtualBox", vendor: /^innotek GmbH$/ },
    { id: "virtualbox", name: "VirtualBox", product: /^VirtualBox$/ },
    { id: "hyperv", name: "Hyper-V", vendor: /^Microsoft Corporation$/, product: /^Virtual Machine$/ },
    { id: "bhyve", name: "bhyve", either: /^BHYVE/ },
    { id: "parallels", name: "Parallels", vendor: /^Parallels/ },
    { id: "xen", name: "Xen", vendor: /^Xen$/ },
    { id: "qemu", name: "QEMU", either: /^(QEMU|KVM|Bochs)/ },
];

interface Dmi {
    /** a device-tree board's own name ("Raspberry Pi 5 Model B Rev 1.0"), where there is no DMI */
    model?: string;
    vendor?: string;
    product?: string;
    asset?: string;
    boardVendor?: string;
    boardName?: string;
}

function linuxDmi(probe: SystemProbe): Dmi {
    const at = (name: string) => firstLine(probe.read(`/sys/class/dmi/id/${name}`));
    return {
        vendor: at("sys_vendor"),
        product: at("product_name"),
        asset: at("chassis_asset_tag"),
        boardVendor: at("board_vendor"),
        boardName: at("board_name"),
        model: firstLine(probe.read("/proc/device-tree/model")),
    };
}

function windowsDmi(probe: SystemProbe): Dmi {
    const bios = probe.registry[WINDOWS_BIOS] ?? {};
    return {
        vendor: bios.SystemManufacturer?.trim() || undefined,
        product: bios.SystemProductName?.trim() || undefined,
        boardVendor: bios.BaseBoardManufacturer?.trim() || undefined,
        boardName: bios.BaseBoardProduct?.trim() || undefined,
    };
}

function vmFromDmi(dmi: Dmi): IdentityPart | undefined {
    for (const rule of VM_RULES) {
        if (!rule.vendor && !rule.product && !rule.asset && !rule.either) continue;
        if (rule.either && !((dmi.vendor && rule.either.test(dmi.vendor)) || (dmi.product && rule.either.test(dmi.product)))) continue;
        if (rule.vendor && !(dmi.vendor && rule.vendor.test(dmi.vendor))) continue;
        if (rule.product && !(dmi.product && rule.product.test(dmi.product))) continue;
        if (rule.asset && !(dmi.asset && rule.asset.test(dmi.asset))) continue;
        return { id: rule.id, name: rule.name };
    }
    return undefined;
}

/** Crostini's milestone: the Chrome major its ChromeOS shipped with. */
function crostini(probe: SystemProbe): IdentityPart | undefined {
    // the guest tools are bind-mounted in, and the container token is
    // injected; Baguette (containerless) guests keep the cros apt source
    const inside =
        probe.exists("/opt/google/cros-containers") ||
        probe.exists("/dev/.container_token") ||
        probe.exists("/etc/apt/sources.list.d/cros.list");
    if (!inside) return undefined;
    const milestone = firstLine(probe.read("/dev/.cros_milestone"));
    return { id: "chromeos", name: "ChromeOS", ...(milestone && /^\d+$/.test(milestone) ? { version: milestone } : {}) };
}

function wsl(probe: SystemProbe): IdentityPart | undefined {
    const kernel = probe.release;
    if (/microsoft-standard-WSL2/i.test(kernel)) return { id: "wsl", name: "WSL", version: "2" };
    // WSL1 runs no Linux kernel; its reported release ends in "-Microsoft"
    if (/-Microsoft$/.test(kernel)) return { id: "wsl", name: "WSL", version: "1" };
    // WSL_INTEROP is set only on WSL 2; neither variable reaches a service, so they come last
    if (probe.env.WSL_DISTRO_NAME !== undefined) return { id: "wsl", name: "WSL", ...(probe.env.WSL_INTEROP ? { version: "2" } : {}) };
    return undefined;
}

function linuxMachine(probe: SystemProbe, dmi: Dmi): IdentityPart | undefined {
    const found = crostini(probe) ?? wsl(probe);
    if (found) return found;
    if (probe.env.CODESPACES === "true") return { id: "codespaces", name: "GitHub Codespaces" };
    if (probe.env.GITPOD_WORKSPACE_ID) return { id: "gitpod", name: "Gitpod" };
    if (probe.exists("/.dockerenv")) return { id: "docker", name: "Docker" };
    if (probe.exists("/run/.containerenv")) return { id: "podman", name: "Podman" };
    const vm = vmFromDmi(dmi);
    if (vm) return vm;
    // EC2's older Xen instances name only Xen in their DMI
    if (/^ec2/i.test(firstLine(probe.read("/sys/hypervisor/uuid")) ?? "")) return { id: "aws", name: "AWS EC2" };
    // a hypervisor no rule names is still a virtual machine
    if (/^flags\s*:.*\bhypervisor\b/m.test(probe.read("/proc/cpuinfo") ?? "")) return { id: "vm", name: "Virtual machine" };
    return undefined;
}

// ---------------------------------------------------------------- motherboard

// what firmware leaves in a field nobody filled in
// (systemd's hwdb list, and what boards ship with in the wild)
const PLACEHOLDER = /^(to be filled by o\.?e\.?m\.?|tbd by oem|default string|system (product )?name|system manufacturer|base ?board product name|type2 - board (product name|vendor name)\d*|not (applicable|specified|available)|no asset information|n\/a|none|null|invalid|unknown|o\.e\.m\.?|oem|0+|123456789|0123456789|x+|\s*)$/i;

// legal names as the board's maker is known
const BOARD_VENDORS: [RegExp, string][] = [
    [/^ASUSTeK/i, "ASUS"],
    [/^Micro-Star/i, "MSI"],
    [/^Gigabyte/i, "Gigabyte"],
    [/^ASRock/i, "ASRock"],
    [/^Dell/i, "Dell"],
    [/^LENOVO$/i, "Lenovo"],
    [/^(HP|Hewlett-Packard)\b/i, "HP"],
    [/^Intel Corporation$/i, "Intel"],
    [/^Supermicro|^Super Micro/i, "Supermicro"],
    [/^Framework/i, "Framework"],
    [/^Valve$/i, "Valve"],
    [/^Acer$/i, "Acer"],
    [/^Biostar/i, "Biostar"],
    [/^EVGA/i, "EVGA"],
    [/^NZXT/i, "NZXT"],
    [/^Google$/i, "Google"],
    [/^Microsoft Corporation$/i, "Microsoft"],
    [/^Samsung/i, "Samsung"],
    [/^Razer/i, "Razer"],
    [/^TOSHIBA$/i, "Toshiba"],
    [/^Sony/i, "Sony"],
    [/^System76/i, "System76"],
    [/^TUXEDO/i, "TUXEDO"],
];

/** The board as people name it, "ASUS ROG STRIX B650E-F GAMING WIFI"; undefined when firmware left it blank. */
export function boardName(vendor: string | undefined, name: string | undefined): string | undefined {
    const product = name && !PLACEHOLDER.test(name) ? name.trim() : undefined;
    if (!product) return undefined;
    const rawVendor = vendor && !PLACEHOLDER.test(vendor) ? vendor.trim() : undefined;
    const maker = rawVendor ? BOARD_VENDORS.find(([re]) => re.test(rawVendor))?.[1] ?? rawVendor : undefined;
    if (!maker || product.toLowerCase().startsWith(maker.toLowerCase())) return product;
    return `${maker} ${product}`;
}

// ---------------------------------------------------------------- operators

/** Claude Duet's computer: a container whose name carries `--aibo--`, with the project uploads folder. */
function claudeDuet(probe: SystemProbe): boolean {
    if (probe.exists("/mnt/project-files/uploads/hearth")) return true;
    const info = probe.read("/container_info.json");
    if (!info) return false;
    try {
        const name = (JSON.parse(info) as { container_name?: unknown }).container_name;
        return typeof name === "string" && name.includes("--aibo--");
    } catch {
        return false; // quiet: a container_info.json that is not JSON is some other container's, not Duet's
    }
}

/** Grok Bot's computer, when at least two of its marks agree. */
function grokBot(probe: SystemProbe): boolean {
    const marks = [
        /^grok-bot-vm-/i.test(probe.hostname),
        probe.username === "box",
        Object.keys(probe.env).some((k) => k.startsWith("SAND_")),
        probe.exists("/exec-daemon"),
    ];
    return marks.filter(Boolean).length >= 2;
}

function operator(probe: SystemProbe): IdentityPart | undefined {
    if (claudeDuet(probe)) return { id: "claude-duet", name: "Claude Duet" };
    if (grokBot(probe)) return { id: "grok-bot", name: "Grok Bot" };
    // Claude Code on the web: Duet shares the variable, so it is checked after Duet
    if (probe.env.CLAUDE_CODE_REMOTE === "true") return { id: "claude-code", name: "Claude Code" };
    return undefined;
}

// ---------------------------------------------------------------- identify

function windowsRelease(probe: SystemProbe): { id: string; name: string; version: string } {
    const build = parseInt(probe.release.split(".")[2] || "0", 10);
    const cv = probe.registry[WINDOWS_CURRENT_VERSION] ?? {};
    const display = cv.DisplayVersion;
    if (cv.InstallationType === "Server" || cv.InstallationType === "Server Core") {
        // "Windows Server 2025 Datacenter": the year is the version people know
        const year = /Windows Server (\d{4})/.exec(cv.ProductName ?? "")?.[1];
        return { id: "windows-server", name: "Windows Server", version: year ?? display ?? String(build) };
    }
    // ProductName still says "Windows 10" on 11, so the build tells them apart
    const major = build >= 22000 ? "11" : "10";
    return { id: "windows", name: "Windows", version: display ? `${major} ${display}` : major };
}

/** This computer's identity, from what the probe reads. */
export function identify(probe: SystemProbe): ComputerIdentity {
    const layers = (machine: IdentityPart | undefined, dmi: Dmi): Partial<ComputerIdentity> => {
        const board = machine ? undefined : boardName(dmi.boardVendor, dmi.boardName) ?? dmi.model;
        const op = operator(probe);
        return {
            ...(machine ? { machine } : {}),
            ...(board ? { board } : {}),
            ...(op ? { operator: op } : {}),
        };
    };

    if (probe.platform === "darwin") {
        const version = macosVersionFromDarwin(probe.release);
        const codename = MACOS_NAMES[version];
        const machine = probe.macVirtual ? { id: "vm", name: "Virtual machine" } : undefined;
        return {
            os: "macos",
            osVersion: version,
            distroId: "macos",
            distroName: codename ? `macOS ${codename}` : "macOS",
            ...layers(machine, {}),
        };
    }

    if (probe.platform === "win32") {
        const release = windowsRelease(probe);
        const dmi = windowsDmi(probe);
        return {
            os: "windows",
            osVersion: release.version,
            distroId: release.id,
            distroName: release.name,
            ...layers(vmFromDmi(dmi), dmi),
        };
    }

    if (probe.platform === "linux") {
        const text = probe.read("/etc/os-release") ?? probe.read("/usr/lib/os-release");
        const release = text ? parseOsRelease(text) : {};
        const version = release.VERSION_ID || (release.BUILD_ID && release.BUILD_ID !== "rolling" ? release.BUILD_ID : undefined);
        const flavor = FLAVORS.reduce<IdentityPart | undefined>((found, detect) => found ?? detect(probe, release), undefined);
        const dmi = linuxDmi(probe);
        return {
            os: "linux",
            osVersion: version || probe.release,
            distroId: release.ID?.toLowerCase() || "linux",
            distroName: release.PRETTY_NAME || release.NAME || "Linux",
            ...(flavor ? { flavor } : {}),
            ...layers(linuxMachine(probe, dmi), dmi),
        };
    }

    return { os: probe.platform, osVersion: probe.release, ...layers(undefined, {}) };
}

// ---------------------------------------------------------------- live probe

// a fact that is not there, or that this user may not read (some DMI fields
// are root-only), is an absent fact
const ABSENT = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EISDIR", "EINVAL"]);
const absent = (err: unknown) => ABSENT.has((err as NodeJS.ErrnoException)?.code ?? "");

/** A probe of the computer this process runs on. Windows and macOS facts are read by the caller and passed in. */
export function liveProbe(extra: { registry?: SystemProbe["registry"]; macVirtual?: boolean } = {}): SystemProbe {
    let username = process.env.USER || process.env.USERNAME || "";
    try {
        username = os.userInfo().username;
    } catch (err) {
        if (!(err as NodeJS.ErrnoException)?.code) throw err; // quiet: a uid with no passwd entry (some containers) keeps the env's name
    }
    return {
        platform: process.platform,
        release: os.release(),
        hostname: os.hostname(),
        username,
        home: os.homedir(),
        env: process.env,
        read(path) {
            try {
                return fs.readFileSync(path, "utf8");
            } catch (err) {
                if (absent(err)) return undefined; // quiet: an absent fact
                throw err;
            }
        },
        exists: (path) => fs.existsSync(path),
        list(dir) {
            try {
                return fs.readdirSync(dir);
            } catch (err) {
                if (absent(err)) return []; // quiet: an absent fact
                throw err;
            }
        },
        registry: extra.registry ?? {},
        macVirtual: extra.macVirtual,
    };
}
