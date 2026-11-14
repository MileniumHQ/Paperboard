/** a byte count as people read it: "512 B", "1.5 MB", "12 GB" */
export function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    // promote on the shown value, so 1023.6 KB reads "1 MB", not "1024 KB"
    while (Math.round(value) >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    // one decimal below ten, and none when it would be ".0"
    const shown = value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
    return `${shown} ${units[unit]}`;
}
