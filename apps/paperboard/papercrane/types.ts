import type { WidgetDeclaration } from "../../../packages/paperapi/src/widgetManifest";
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
    widgets?: WidgetDeclaration[];
    // kept off the store; installs still update
    unlisted?: boolean;
    // "dev" = symlinked from a working tree; registry installs carry none
    installSource?: "dev";
}

export type BoardManifest = PanelManifest;

export interface ProgressPayload {
    downloadId: string;
    stage: string;
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}
