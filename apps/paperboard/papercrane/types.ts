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
    // "dev" = symlinked from a working tree; registry installs carry none
    installSource?: "dev";
}

export type BoardManifest = PanelManifest;

export interface IPtyProcess {
    // pid of the shell process, when the backend exposes it
    pid?: number;
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
