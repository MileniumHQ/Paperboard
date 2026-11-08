export interface LinuxDownloadChoice {
    id: 'appimage' | 'deb' | 'rpm';
    label: string;
    description: string;
    file: string;
    href: string;
}
export interface LinuxDownloads {
    architecture: string;
    choices: LinuxDownloadChoice[];
}
export function linuxDownloads(href: string): LinuxDownloads | null;
