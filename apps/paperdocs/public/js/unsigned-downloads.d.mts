export interface UnsignedDownload {
    platform: 'windows' | 'macos';
    app: string;
    file: string;
    href: string;
}
export interface InstallationGuidance {
    label: string;
    summary: string;
    steps: string[];
    note: string;
    source: string;
    sourceLabel: string;
}
export function unsignedDownload(href: string): UnsignedDownload | null;
export const installationGuidance: Record<'windows' | 'macos', InstallationGuidance>;
export const unsignedExplanation: string;
