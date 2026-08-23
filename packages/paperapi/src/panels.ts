import { invoke } from "./ipc";

export interface PanelItem {
    id: string;
    name: string;
    version?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    description?: string;
    publisher?: string;
    size?: string;
    updatedAt?: string;
    isInstalled?: boolean;
}

// Panel store and lifecycle management API
export const panelsApi = {
    list: (): Promise<PanelItem[]> => invoke<PanelItem[]>("panels-list"),
    registry: (): Promise<PanelItem[]> => invoke<PanelItem[]>("panels-registry"),
    install: (panelId: string): Promise<boolean> => invoke<boolean>("panel-install", panelId),
    uninstall: (panelId: string): Promise<boolean> => invoke<boolean>("panel-uninstall", panelId),
    remove: (panelId: string): Promise<boolean> => invoke<boolean>("panel-uninstall", panelId),
};

export const panels = panelsApi;
