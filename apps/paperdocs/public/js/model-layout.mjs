// Horizontal cylinders contain the whole model through every hover rotation.
// Pack those bounds, rather than guessing spacing from a model's origin.
export function separatedModels(a, b) {
    if (Math.abs(a.x - b.x) > a.radius * a.scale + b.radius * b.scale) return true;
    const amin = a.y + a.minY * a.scale, bmin = b.y + b.minY * b.scale;
    return amin + a.height * a.scale < bmin || bmin + b.height * b.scale < amin;
}

export function layoutModels(items, { stacked, halfWidth, halfHeight }) {
    const gap = 0.24;
    const widths = stacked
        ? [0, 1].map(column => Math.max(...items.filter((_, i) => i % 2 === column).map(item => 2 * item.radius * item.scale)))
        : items.map(item => 2 * item.radius * item.scale);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
    const heights = [0, 0];
    let cursor = -totalWidth / 2;
    const columns = widths.map(width => { const centre = cursor + width / 2; cursor += width + gap; return centre; });
    const placed = items.map((item, i) => {
        const column = stacked ? i % 2 : i;
        const y = stacked ? heights[column] - item.minY * item.scale : 0;
        if (stacked) heights[column] += item.height * item.scale + gap;
        return { ...item, x: columns[column], y };
    });
    const totalHeight = stacked ? Math.max(...heights) - gap : Math.max(...items.map(item => item.height * item.scale));
    const fit = Math.min(1, halfWidth * 1.5 / totalWidth, halfHeight * 1.4 / totalHeight);
    return placed.map(item => ({
        ...item,
        x: 0.5 + item.x * fit,
        y: stacked ? 0.5 + (item.y - totalHeight / 2) * fit : item.y,
        scale: item.scale * fit,
    }));
}
