import { PanelManifest } from "../../../../papercrane/types";

export interface ProgressPayload {
    stage: "starting" | "checking" | "downloading" | "verifying" | "extracting" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export type ProgressCallback = (payload: ProgressPayload) => void;

export interface SystemInfo {
    hostname: string;
    os: "windows" | "macos" | "linux" | string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
    cpus?: number;
    totalMem?: number;
    freeMem?: number;
    uptime?: number;
}

export interface ComputerDriver {
    // Lifecycle & Identification
    getId(): string;
    getSystemInfo(): Promise<SystemInfo>;
    getIP(): Promise<string>;

    // Terminal (PTY)
    createTerminal(
        id: string,
        cols: number,
        rows: number,
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void>;
    writeTerminal(id: string, data: string): void;
    resizeTerminal(id: string, cols: number, rows: number): void;
    destroyTerminal(id: string): void;
    isTerminalRunning(id: string): Promise<boolean>;

    // Background Supervised Processes
    startProcess(
        id: string,
        command: string,
        args?: string[],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void>;
    writeProcess(id: string, data: string): void;
    killProcess(id: string, signal?: string): void;
    isProcessRunning(id: string): Promise<boolean>;
    attachProcess(
        id: string,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<boolean>;

    // Filesystem (App-Scoped)
    getFilePath(targetPath: string, appId?: string): Promise<string>;
    fileExists(targetPath: string, appId?: string): Promise<boolean>;
    writeFile(targetPath: string, content: string, appId?: string): Promise<string>;
    readFile(targetPath: string, appId?: string): Promise<string | null>;
    clearFiles(appId?: string): Promise<boolean>;
    downloadFile(
        url: string,
        targetPath: string,
        appId: string | undefined,
        downloadId: string,
        options: {
            sha1?: string;
            sha256?: string;
            checksum?: { algorithm: string; value: string };
        },
        onProgress: ProgressCallback,
    ): Promise<string>;

    // Packages (Java, Runtimes, Tools)
    isPackageInstalled(packageName: string, version?: string): Promise<boolean>;
    getPackageIndex(): Promise<Record<string, any>>;
    getPackagePath(packageName: string): Promise<string>;
    downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: ProgressCallback,
    ): Promise<string>;

    // Panels (App Registry)
    listPanels(): Promise<PanelManifest[]>;
    installPanel(
        panelId: string,
        downloadUrl: string,
        expectedSha256?: string,
    ): Promise<PanelManifest>;
    uninstallPanel(panelId: string): Promise<boolean>;

    // Config Storage
    getConfig(id: string): Promise<any>;
    setConfig(id: string, data: any): Promise<boolean>;
}
