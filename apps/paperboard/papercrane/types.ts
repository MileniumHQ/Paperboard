export interface PanelManifest {
    id: string;
    name: string;
    base?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    version?: string;
    publisher?: string;
    size?: string;
    updatedAt?: string;
    isInstalled?: boolean;
    isDevLink?: boolean;
    isLinked?: boolean;
    service?: string;
    autostart?: boolean;
    // network egress declaration, preserved verbatim
    // from the manifest by validatePanelManifest (surfaced at install,
    // enforced by the panel CSP — never granted here)
    network?: { hosts?: string[]; mode?: string };
    // daemon-recorded install provenance: "registry" (reviewed, closed
    // registry), "direct" (checksummed URL install, not reviewed), "dev"
    // (symlinked dev link). Absent for panels installed before provenance
    // shipped — the renderer says "Unsigned" for those, honestly.
    installSource?: "registry" | "direct" | "dev";
}

export type BoardManifest = PanelManifest;

export interface IPtyProcess {
    write(data: string): void;
    resize(cols: number, rows: number): void;
    onData(callback: (data: string) => void): void;
    onExit(callback: (code: number) => void): void;
    kill(): void;
}

export interface ProgressPayload {
    downloadId: string;
    stage: string;
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}
