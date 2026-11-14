import { type Component } from "solid-js";
import {
    PaperList,
    PaperListItem,
    PaperFlex,
    getVarCss,
} from "@mileniumhq/paperui";
import styles from "./ComputerHeader.module.css";
import iconStyles from "./panelIcon.module.css";
import libraryIcon from "../../assets/PanelLibrary.png";
import type { ComputerItem } from "../../App";

export interface ComputerHeaderProps {
    computer?: ComputerItem;
    selectedTab: string;
    onSelectTab: (tab: string) => void;
    /** a tab was tapped, even the one already selected (the phone layout opens it) */
    onActivateTab?: () => void;
    /** Opens the library's right-click menu (Reload), anchored at the event. */
    onLibraryContextMenu?: (e: MouseEvent) => void;
    /** the phone layout: what a tab opens covers the list, so none stays highlighted */
    buttons?: boolean;
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
        // The daemon sends the macOS major for Darwin 20 and later
        // (macosVersionFromDarwin) and the raw Darwin release before that,
        // which was macOS 10.x.
        const darwin = parseInt(version.split(".")[0], 10);
        if (version.includes(".") && darwin >= 4 && darwin < 20) version = `10.${darwin - 4}`;
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

const ComputerHeader: Component<ComputerHeaderProps> = (props) => {
    const brandInfo = () => getOsBrandInfo(props.computer);

    return (
        <PaperFlex
            direction="column"
            background="surface-inset"
            shrink={0}
            class={styles.header}
        >
            <PaperList
                name="computer-system-selection"
                value={props.selectedTab}
                onValueChange={(val) => props.onSelectTab(String(val))}
                buttons={props.buttons}
                class={styles.tabs}
            >
                <PaperListItem
                    value="settings"
                    onClick={() => props.onActivateTab?.()}
                    description={brandInfo().display}
                    class={styles.computerItem}
                    style={{ "--computer-os-color": brandInfo().color }}
                >
                    {props.computer?.name || "This Computer"}
                </PaperListItem>

                <PaperListItem
                    value="library"
                    onClick={() => props.onActivateTab?.()}
                    onContextMenu={(e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        props.onLibraryContextMenu?.(e);
                    }}
                    icon={
                        <img src={libraryIcon} alt="Panel Library" class={iconStyles.panelIcon} />
                    }
                >
                    Panel Library
                </PaperListItem>
            </PaperList>
        </PaperFlex>
    );
};

export default ComputerHeader;
