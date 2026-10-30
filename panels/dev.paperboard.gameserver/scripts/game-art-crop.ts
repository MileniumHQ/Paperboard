/** Crop around the center (or a vertical focus) before resizing, without stretching. */
export function crop(width: number, height: number, focus = 0.5): string {
    const w = `min(iw,ih*${width}/${height})`;
    const h = `min(ih,iw*${height}/${width})`;
    return `crop='${w}':'${h}':(iw-ow)/2:(ih-oh)*${focus},scale=${width}:${height}:flags=lanczos`;
}
