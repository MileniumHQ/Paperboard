import { type Component } from "solid-js";
import {
    PaperList,
    PaperListItem,
    PaperText,
    PaperFlex,
    getVarCss,
} from "@paperboard-dev/paperui";
import libraryIcon from "../../assets/BoardLibrary.png";
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
    macos: { name: "macOS", color: "#FFFFFF" },
    darwin: { name: "macOS", color: "#FFFFFF" },
    windows: { name: "Windows", color: "#0078D4" },
    ubuntu: { name: "Ubuntu", color: "#E95420" },
    arch: { name: "Arch Linux", color: "#1793D1" },
    debian: { name: "Debian", color: "#A80030" },
    fedora: { name: "Fedora", color: "#3C6EB4" },
    linuxmint: { name: "Linux Mint", color: "#86BE43" },
    mint: { name: "Linux Mint", color: "#86BE43" },
    zorin: { name: "Zorin OS", color: "#0CC1E8" },
    zorinos: { name: "Zorin OS", color: "#0CC1E8" },
    steamos: { name: "SteamOS", color: "#1A9FFF" },
    steamdeck: { name: "SteamOS", color: "#1A9FFF" },
    pop: { name: "Pop!_OS", color: "#48B9C7" },
    pop_os: { name: "Pop!_OS", color: "#48B9C7" },
    manjaro: { name: "Manjaro", color: "#35BF5C" },
    elementary: { name: "elementary OS", color: "#64BAFF" },
    nixos: { name: "NixOS", color: "#5277C3" },
    raspbian: { name: "Raspberry Pi OS", color: "#C51A4A" },
    linux: { name: "Linux", color: "#FCC624" },
};

export function getOsBrandInfo(comp?: ComputerItem): OsBrandInfo {
    if (!comp) {
        return {
            name: "Unknown",
            version: "",
            display: "Unknown OS",
            color: "#888888",
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
        color: "#888888",
    };

    let version = comp.osVersion ? comp.osVersion.trim() : "";

    if (
        key === "macos" ||
        key === "darwin" ||
        rawOs === "darwin" ||
        rawOs.includes("mac")
    ) {
        if (!version || version.includes(".")) {
            const rawNum = parseInt(
                (version || comp.osVersion || "").split(".")[0],
                10,
            );
            if (!isNaN(rawNum) && rawNum >= 4) {
                version =
                    rawNum >= 20 ? (rawNum - 9).toString() : `10.${rawNum - 4}`;
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
