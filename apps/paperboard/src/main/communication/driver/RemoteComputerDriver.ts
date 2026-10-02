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

    public async getSystemInfo(): Promise<SystemInfo> {
        const info = await this.client.getSystemInfo();
        return info ?? { hostname: this.computerId, os: "unknown", arch: "unknown" };
    }

    public async getPackageIndex(): Promise<Record<string, any>> {
        return this.client.getPackageIndex();
    }

    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: ProgressCallback,
        expectedSha256?: string,
    ): Promise<string> {
        return this.client.downloadPackage(packageName, downloadId, onProgress, expectedSha256);
    }

    public async listPanels(): Promise<PanelManifest[]> {
        return this.client.listPanels();
    }

    public async installPanel(panelId: string, expected: { version?: string; sha256?: string }): Promise<PanelManifest> {
        return this.client.installPanel(panelId, expected);
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
