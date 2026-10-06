import { type Component } from "solid-js";
import {
    PaperList,
    PaperListItem,
    PaperFlex,
    getVarCss,
} from "@mileniumhq/paperui";
import styles from "./ComputerHeader.module.css";
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
    macos: { name: "macOS", color: `${getVarCss("os-macos")}` },
    darwin: { name: "macOS", color: `${getVarCss("os-macos")}` },
    windows: { name: "Windows", color: `${getVarCss("os-windows")}` },
    ubuntu: { name: "Ubuntu", color: `${getVarCss("os-ubuntu")}` },
    arch: { name: "Arch Linux", color: `${getVarCss("os-arch")}` },
    debian: { name: "Debian", color: `${getVarCss("os-debian")}` },
    fedora: { name: "Fedora", color: `${getVarCss("os-fedora")}` },
    linuxmint: { name: "Linux Mint", color: `${getVarCss("os-linuxmint")}` },
    mint: { name: "Linux Mint", color: `${getVarCss("os-linuxmint")}` },
    zorin: { name: "Zorin OS", color: `${getVarCss("os-zorin")}` },
    zorinos: { name: "Zorin OS", color: `${getVarCss("os-zorin")}` },
    steamos: { name: "SteamOS", color: `${getVarCss("os-steamos")}` },
    steamdeck: { name: "SteamOS", color: `${getVarCss("os-steamos")}` },
    pop: { name: "Pop!_OS", color: `${getVarCss("os-pop")}` },
    pop_os: { name: "Pop!_OS", color: `${getVarCss("os-pop")}` },
    manjaro: { name: "Manjaro", color: `${getVarCss("os-manjaro")}` },
    elementary: { name: "elementary OS", color: `${getVarCss("os-elementary")}` },
    nixos: { name: "NixOS", color: `${getVarCss("os-nixos")}` },
    raspbian: { name: "Raspberry Pi OS", color: `${getVarCss("os-raspbian")}` },
    linux: { name: "Linux", color: `${getVarCss("os-linux")}` },
};

export function getOsBrandInfo(comp?: ComputerItem): OsBrandInfo {
    if (!comp) {
        return {
            name: "Unknown",
            version: "",
            display: "Unknown OS",
            color: `${getVarCss("os-unknown")}`,
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
        color: `${getVarCss("os-unknown")}`,
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
            background="surface-inset"
            style={{
                "flex-shrink": 0,
                "border-bottom": `${getVarCss("border-width")} solid ${getVarCss("border")}`,
            }}
        >
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
                    value="settings"
                    description={brandInfo().display}
                    class={styles.computerItem}
                    style={{ "--computer-os-color": brandInfo().color }}
                >
                    {props.computer?.name || "This Computer"}
                </PaperListItem>

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
            </PaperList>
        </PaperFlex>
    );
};

export default ComputerHeader;
