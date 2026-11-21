// How the shell names and colors a computer from the identity its daemon
// reports (apps/daemon/src/system/identity.ts names every layer; this file
// only maps the ids it sends to a brand).
import { getVarCss } from "@mileniumhq/paperui";
import type { ComputerInfo } from "../../lib/shell";

interface Brand {
    name: string;
    /** the PaperUI identity token (`os-<token>`); a brand with no official color has none */
    color?: string;
}

// keyed by os-release ID, or by the ids identity.ts gives flavors, machines and operators
const BRANDS: Record<string, Brand> = {
    macos: { name: "macOS", color: "macos" },
    windows: { name: "Windows", color: "windows" },
    "windows-server": { name: "Windows Server", color: "windows" },

    ubuntu: { name: "Ubuntu", color: "ubuntu" },
    debian: { name: "Debian", color: "debian" },
    fedora: { name: "Fedora", color: "fedora" },
    linuxmint: { name: "Linux Mint", color: "linuxmint" },
    zorin: { name: "Zorin OS", color: "zorin" },
    pop: { name: "Pop!_OS", color: "pop" },
    elementary: { name: "elementary OS", color: "elementary" },
    neon: { name: "KDE neon", color: "neon" },
    kali: { name: "Kali Linux", color: "kali" },
    parrot: { name: "Parrot OS", color: "parrot" },
    deepin: { name: "deepin", color: "deepin" },
    vanilla: { name: "Vanilla OS" },
    pika: { name: "PikaOS" },
    anduinos: { name: "AnduinOS" },
    steamos: { name: "SteamOS", color: "steamos" },
    nixos: { name: "NixOS", color: "nixos" },
    "opensuse-tumbleweed": { name: "openSUSE Tumbleweed", color: "opensuse" },
    "opensuse-leap": { name: "openSUSE Leap", color: "opensuse" },
    "opensuse-microos": { name: "openSUSE MicroOS", color: "opensuse" },
    rocky: { name: "Rocky Linux", color: "rocky" },
    rhel: { name: "Red Hat Enterprise Linux", color: "redhat" },
    centos: { name: "CentOS Stream", color: "centos" },
    almalinux: { name: "AlmaLinux" },
    ol: { name: "Oracle Linux", color: "oracle" },
    amzn: { name: "Amazon Linux", color: "amazon" },
    alpine: { name: "Alpine Linux", color: "alpine" },
    solus: { name: "Solus", color: "solus" },
    "fedora-asahi-remix": { name: "Fedora Asahi Remix", color: "fedora" },
    nobara: { name: "Nobara" },
    bazzite: { name: "Bazzite" },
    bluefin: { name: "Bluefin" },
    aurora: { name: "Aurora" },
    ultramarine: { name: "Ultramarine" },
    "clear-linux-os": { name: "Clear Linux" },
    slackware: { name: "Slackware" },
    haos: { name: "Home Assistant OS", color: "homeassistant" },
    raspbian: { name: "Raspberry Pi OS", color: "raspberrypi" },

    arch: { name: "Arch Linux", color: "arch" },
    cachyos: { name: "CachyOS", color: "cachyos" },
    endeavouros: { name: "EndeavourOS", color: "endeavouros" },
    garuda: { name: "Garuda Linux", color: "garuda" },
    artix: { name: "Artix Linux", color: "artix" },
    manjaro: { name: "Manjaro", color: "manjaro" },
    chimera: { name: "Chimera Linux" },
    gentoo: { name: "Gentoo", color: "gentoo" },
    void: { name: "Void Linux", color: "void" },

    // flavors: what is built on the distro
    omarchy: { name: "Omarchy", color: "omarchy" },
    raspberrypi: { name: "Raspberry Pi OS", color: "raspberrypi" },
    proxmox: { name: "Proxmox VE", color: "proxmox" },
    truenas: { name: "TrueNAS", color: "truenas" },
    unraid: { name: "Unraid", color: "unraid" },
    synology: { name: "Synology DSM" },

    // machines that are the computer people think of
    chromeos: { name: "ChromeOS", color: "chromeos" },
    wsl: { name: "WSL", color: "windows" },

    // agents operating the computer
    "claude-duet": { name: "Claude Duet", color: "claude" },
    "claude-code": { name: "Claude Code", color: "claude" },
    "grok-bot": { name: "Grok Bot", color: "grok" },
};

const LINUX: Brand = { name: "Linux", color: "linux" };

interface Part {
    id: string;
    name: string;
    version?: string;
}

const named = (part: Part) => (part.version ? `${part.name} ${part.version}` : part.name);
const colorOf = (brand: Brand | undefined) => (brand?.color ? getVarCss(`os-${brand.color}`) : undefined);

/** The OS as the person knows it: "Ubuntu 24.04", "Arch Linux", "macOS 26". */
function osName(comp: ComputerInfo): string {
    const id = (comp.distroId || comp.os || "").toLowerCase();
    const brand = BRANDS[id];
    let version = comp.osVersion?.trim() || "";
    if (id === "macos" || comp.os === "darwin") {
        // The daemon sends the macOS major for Darwin 20 and later
        // (macosVersionFromDarwin) and the raw Darwin release before that,
        // which was macOS 10.x.
        const darwin = parseInt(version.split(".")[0], 10);
        if (version.includes(".") && darwin >= 4 && darwin < 20) version = `10.${darwin - 4}`;
        return version ? `macOS ${version}` : "macOS";
    }
    if (comp.os === "windows" || comp.os === "win32") {
        return named({ id, name: brand?.name ?? "Windows", version });
    }
    if (brand) return version ? `${brand.name} ${version}` : brand.name;
    // a distro with no brand here: its own PRETTY_NAME already carries its version
    if (comp.distroName) return comp.distroName;
    return comp.os === "linux" ? (version ? `Linux ${version}` : "Linux") : comp.os || "Unknown OS";
}

/** The OS line under a computer's name, and the color it is tinted with. */
export function computerLook(comp?: ComputerInfo): { line: string; color: string } {
    if (!comp) return { line: "Unknown OS", color: getVarCss("os-unknown") };
    const distro = BRANDS[(comp.distroId || comp.os || "").toLowerCase()] ?? (comp.os === "linux" ? LINUX : undefined);
    const machine = comp.machine ? BRANDS[comp.machine.id] : undefined;
    const system = comp.flavor ? named(comp.flavor) : osName(comp);
    const line = comp.operator
        ? `${comp.operator.name} · ${system}`
        : comp.machine
          ? `${system} · ${named(comp.machine)}`
          : system;
    // the most specific identity with a color tints the computer
    const color =
        colorOf(comp.operator && BRANDS[comp.operator.id]) ??
        colorOf(comp.flavor && BRANDS[comp.flavor.id]) ??
        colorOf(machine) ??
        colorOf(distro) ??
        colorOf(comp.os === "linux" ? LINUX : undefined) ??
        getVarCss("os-unknown");
    return { line, color };
}

const ARCH_NAMES: Record<string, string> = { x64: "x86-64", arm64: "ARM64", arm: "ARM", ia32: "x86", riscv64: "RISC-V 64", ppc64: "PowerPC 64", s390x: "IBM Z" };

/** The rows of a computer's System section, top to bottom; a layer the daemon didn't detect has none. */
export function computerFacts(comp: ComputerInfo): { title: string; value: string }[] {
    const rows: { title: string; value: string }[] = [];
    if (comp.operator) rows.push({ title: "Operated by", value: named(comp.operator) });
    if (comp.flavor) rows.push({ title: "System", value: named(comp.flavor) });
    const isLinux = comp.os === "linux";
    // a distro's PRETTY_NAME is its full name ("Debian GNU/Linux 12 (bookworm)"); macOS adds its name to the version
    const os = isLinux && comp.distroName
        ? comp.distroName
        : comp.os === "macos" && comp.distroName && comp.distroName !== "macOS"
          ? `${comp.distroName} ${comp.osVersion ?? ""}`.trim()
          : osName(comp);
    if (comp.os) rows.push({ title: "Operating system", value: os });
    if (comp.machine) rows.push({ title: "Runs in", value: named(comp.machine) });
    if (comp.board) rows.push({ title: "Motherboard", value: comp.board });
    if (comp.arch) rows.push({ title: "Architecture", value: ARCH_NAMES[comp.arch] ?? comp.arch });
    return rows;
}
