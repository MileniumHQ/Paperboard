import {
    ComputerDriver,
    ProgressCallback,
    SystemInfo,
} from "./ComputerDriver";
import { PaperCraneClient } from "../papercrane/PaperCraneClient";
import { PanelManifest } from "../../../../papercrane/types";

export class RemoteComputerDriver implements ComputerDriver {
    constructor(
        private readonly computerId: string,
        private readonly client: PaperCraneClient,
    ) {}

    public getId(): string {
        return this.computerId;
    }

    public async getIP(): Promise<string> {
        return this.client.getIP();
    }

    public async getSystemInfo(): Promise<SystemInfo> {
        const info = await this.client.getSystemInfo();
        return info ?? { hostname: this.computerId, os: "unknown", arch: "unknown" };
    }

    public async createTerminal(
        id: string,
        cols: number = 80,
        rows: number = 24,
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void> {
        return this.client.createTerminal(id, cols, rows, cwd, env, onData, onExit);
    }

    public writeTerminal(id: string, data: string): void {
        this.client.writeTerminal(id, data);
    }

    public resizeTerminal(id: string, cols: number, rows: number): void {
        this.client.resizeTerminal(id, cols, rows);
    }

    public destroyTerminal(id: string): void {
        this.client.destroyTerminal(id);
    }

    public async isTerminalRunning(id: string): Promise<boolean> {
        return this.client.isTerminalRunning(id);
    }

    public async startProcess(
        id: string,
        command: string,
        args: string[] = [],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void> {
        return this.client.startProcess(id, command, args, cwd, env, onData, onStdout, onStderr, onExit);
    }

    public writeProcess(id: string, data: string): void {
        this.client.writeProcess(id, data);
    }

    public killProcess(id: string, signal: string = "SIGTERM"): void {
        this.client.killProcess(id, signal);
    }

    public async isProcessRunning(id: string): Promise<boolean> {
        return this.client.isProcessRunning(id);
    }

    public async attachProcess(
        id: string,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<boolean> {
        return this.client.attachProcess(id, onData, onStdout, onStderr, onExit);
    }

    public async getFilePath(targetPath: string, appId?: string): Promise<string> {
        return this.client.getFilePath(targetPath, appId);
    }

    public async fileExists(targetPath: string, appId?: string): Promise<boolean> {
        return this.client.fileExists(targetPath, appId);
    }

    public async writeFile(targetPath: string, content: string, appId?: string): Promise<string> {
        return this.client.writeFile(targetPath, content, appId);
    }

    public async readFile(targetPath: string, appId?: string): Promise<string | null> {
        return this.client.readFile(targetPath, appId);
    }

    public async clearFiles(appId?: string): Promise<boolean> {
        return this.client.clearFiles(appId);
    }

    public async downloadFile(
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
    ): Promise<string> {
        return this.client.downloadFile(url, targetPath, appId, downloadId, options, onProgress);
    }

    public async isPackageInstalled(packageName: string, version?: string): Promise<boolean> {
        return this.client.isPackageInstalled(packageName, version);
    }

    public async getPackageIndex(): Promise<Record<string, any>> {
        return this.client.getPackageIndex();
    }

    public async getPackagePath(packageName: string): Promise<string> {
        return this.client.getPackagePath(packageName);
    }

    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: ProgressCallback,
    ): Promise<string> {
        return this.client.downloadPackage(packageName, downloadId, onProgress);
    }

    public async listPanels(): Promise<PanelManifest[]> {
        return this.client.listPanels();
    }

    public async installPanel(panelId: string, downloadUrl: string, expectedSha256?: string): Promise<PanelManifest> {
        return this.client.installPanel(panelId, downloadUrl, expectedSha256);
    }

    public async uninstallPanel(panelId: string): Promise<boolean> {
        return this.client.uninstallPanel(panelId);
    }

    public async updateCrane(version: string, downloadUrl: string, sha256?: string): Promise<void> {
        return this.client.updateCrane(version, downloadUrl, sha256);
    }

    public async getConfig(id: string): Promise<any> {
        return this.client.getConfig(id);
    }

    public async setConfig(id: string, data: any): Promise<boolean> {
        return this.client.setConfig(id, data);
    }
}
