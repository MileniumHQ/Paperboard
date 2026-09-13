import { type Component } from "solid-js";
import {
    PaperList,
    PaperListItem,
    PaperText,
    PaperFlex,
    getVarCss,
} from "@paperboard-dev/paperui";
import libraryIcon from "../../assets/PanelLibrary.png";
import type { ComputerItem } from "../../App";

export interface ComputerHeaderProps {
    computer?: ComputerItem;
    selectedTab: string;
    onSelectTab: (tab: string) => void;
}

export interface OsBrandInfo {
    name: string;
    version: string;
    display: string;
    color: string;
}

const OS_BRANDS: Record<string, { name: string; color: string }> = {
    macos: { name: "macOS", color: "var(--paper-brand-os-macos)" },
    darwin: { name: "macOS", color: "var(--paper-brand-os-macos)" },
    windows: { name: "Windows", color: "var(--paper-brand-os-windows)" },
    ubuntu: { name: "Ubuntu", color: "var(--paper-brand-os-ubuntu)" },
    arch: { name: "Arch Linux", color: "var(--paper-brand-os-arch)" },
    debian: { name: "Debian", color: "var(--paper-brand-os-debian)" },
    fedora: { name: "Fedora", color: "var(--paper-brand-os-fedora)" },
    linuxmint: { name: "Linux Mint", color: "var(--paper-brand-os-linuxmint)" },
    mint: { name: "Linux Mint", color: "var(--paper-brand-os-linuxmint)" },
    zorin: { name: "Zorin OS", color: "var(--paper-brand-os-zorin)" },
    zorinos: { name: "Zorin OS", color: "var(--paper-brand-os-zorin)" },
    steamos: { name: "SteamOS", color: "var(--paper-brand-os-steamos)" },
    steamdeck: { name: "SteamOS", color: "var(--paper-brand-os-steamos)" },
    pop: { name: "Pop!_OS", color: "var(--paper-brand-os-pop)" },
    pop_os: { name: "Pop!_OS", color: "var(--paper-brand-os-pop)" },
    manjaro: { name: "Manjaro", color: "var(--paper-brand-os-manjaro)" },
    elementary: { name: "elementary OS", color: "var(--paper-brand-os-elementary)" },
    nixos: { name: "NixOS", color: "var(--paper-brand-os-nixos)" },
    raspbian: { name: "Raspberry Pi OS", color: "var(--paper-brand-os-raspbian)" },
    linux: { name: "Linux", color: "var(--paper-brand-os-linux)" },
};

export function getOsBrandInfo(comp?: ComputerItem): OsBrandInfo {
    if (!comp) {
        return {
            name: "Unknown",
            version: "",
            display: "Unknown OS",
            color: "var(--paper-brand-os-unknown)",
        };
    }

    const rawOs = (comp.os || "").toLowerCase();
    const rawDistro = (comp.distroId || "").toLowerCase();
    const key = OS_BRANDS[rawDistro]
        ? rawDistro
        : OS_BRANDS[rawOs]
          ? rawOs
          : Object.keys(OS_BRANDS).find(
                (k) => rawDistro.includes(k) || rawOs.includes(k),
            ) || (rawOs.includes("linux") ? "linux" : "");

    const brand = OS_BRANDS[key] || {
        name:
            comp.distroName ||
            (rawOs === "darwin"
                ? "macOS"
                : rawOs === "win32"
                  ? "Windows"
                  : comp.os || "System"),
        color: "var(--paper-brand-os-unknown)",
    };

    let version = comp.osVersion ? comp.osVersion.trim() : "";

    if (
        key === "macos" ||
        key === "darwin" ||
        rawOs === "darwin" ||
        rawOs.includes("mac")
    ) {
        // R10: the old heuristic (rawNum >= 20 ? rawNum - 9 : 10.x) predates
        // Apple's year-based versioning — a truthful osVersion of 26 rendered
        // as "macOS 17". Versions 26+ are already the human-facing major
        // number and pass through verbatim; the legacy map applies only to
        // the pre-Ventura range it was written for (4..19 → 10.x).
        if (!version || version.includes(".")) {
            const rawNum = parseInt(
                (version || comp.osVersion || "").split(".")[0],
                10,
            );
            if (!isNaN(rawNum) && rawNum >= 4) {
                if (rawNum >= 26) {
                    version = rawNum.toString();
                } else if (rawNum >= 20) {
                    version = (rawNum - 9).toString();
                } else {
                    version = `10.${rawNum - 4}`;
                }
            }
        }
    }

    let display = brand.name;
    if (key === "arch") {
        display = brand.name;
    } else if (key === "linux") {
        display = version ? `Linux ${version}` : "Linux";
    } else if (version) {
        display = `${brand.name} ${version}`.trim();
    }

    return {
        name: brand.name,
        version,
        display,
        color: brand.color,
    };
}

export function formatOsVersion(comp?: ComputerItem): string {
    return getOsBrandInfo(comp).display;
}

const ComputerHeader: Component<ComputerHeaderProps> = (props) => {
    const brandInfo = () => getOsBrandInfo(props.computer);

    return (
        <PaperFlex
            direction="column"
            background="definition"
            style={{
                "flex-shrink": 0,
                "border-bottom": `${getVarCss("border-width")} solid ${getVarCss("medium-border")}`,
            }}
        >
            <PaperFlex
                direction="column"
                style={{
                    padding: `${getVarCss("uigap-threefourths")} ${getVarCss("uigap-threefourths")} ${getVarCss("uigap-half")}`,
                    gap: "2px",
                    "min-width": 0,
                    background: `linear-gradient(135deg, color-mix(in srgb, ${brandInfo().color} 22%, ${getVarCss("background-definition")}) 0%, ${getVarCss("background-definition")} 100%)`,
                }}
            >
                <PaperText
                    size={3}
                    weight={700}
                    style={{
                        "white-space": "nowrap",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                    }}
                >
                    {props.computer?.name || "This Computer"}
                </PaperText>
                <PaperText
                    size={1}
                    weight={600}
                    color="light-text"
                    style={{
                        "white-space": "nowrap",
                        overflow: "hidden",
                        "text-overflow": "ellipsis",
                    }}
                >
                    {brandInfo().display}
                </PaperText>
            </PaperFlex>

            <PaperList
                name="computer-system-selection"
                value={props.selectedTab}
                onValueChange={(val) => props.onSelectTab(String(val))}
                style={{
                    width: "100%",
                    "border-right": "none",
                    height: "auto",
                    background: "transparent",
                }}
            >
                <PaperListItem
                    value="library"
                    icon={
                        <img
                            src={libraryIcon}
                            alt="Panel Library"
                            style={{
                                width: getVarCss("icon-size-large"),
                                height: getVarCss("icon-size-large"),
                                "border-radius":
                                    getVarCss("border-radius-half"),
                                "object-fit": "contain",
                            }}
                        />
                    }
                >
                    Panel Library
                </PaperListItem>

                <PaperListItem value="settings" icon="info">
                    Computer Info
                </PaperListItem>
            </PaperList>
        </PaperFlex>
    );
};

export default ComputerHeader;
