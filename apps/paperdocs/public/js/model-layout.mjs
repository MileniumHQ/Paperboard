// Cylinders contain every model through its full hover turn, including models
// whose origins are off-centre. Layout and the animated handoff share them.
export function separatedModels(a, b) {
    if (Math.abs(a.x - b.x) > a.radius * a.scale + b.radius * b.scale) return true;
    const amin = a.y + a.minY * a.scale, bmin = b.y + b.minY * b.scale;
    return amin + a.height * a.scale < bmin || bmin + b.height * b.scale < amin;
}

export function layoutModels(items, { halfWidth, halfHeight, centerY = 0.5 }) {
    const gap = 1.2;
    let best;
    // At most five models/candidates. Choose the arrangement that keeps the
    // models largest; balanced rows break ties instead of leaving a lone tile.
    for (let columns = 1; columns <= items.length; columns++) {
        const rows = [];
        for (let start = 0; start < items.length; start += columns) {
            const models = items.slice(start, start + columns);
            rows.push({
                models,
                width: models.reduce((sum, item) => sum + 2 * item.radius * item.scale, 0) + gap * (models.length - 1),
                height: Math.max(...models.map(item => item.height * item.scale)),
                depth: Math.max(...models.map(item => item.radius * item.scale)),
            });
        }
        const width = Math.max(...rows.map(row => row.width));
        // A tilted camera projects depth vertically. Reserve extra room between
        // rows so their silhouettes also remain legible from that viewpoint.
        const rowGap = index => gap + (rows[index].depth + rows[index + 1].depth) * 0.22;
        const height = rows.reduce((sum, row, index) => sum + row.height + (index < rows.length - 1 ? rowGap(index) : 0), 0);
        const fit = Math.min(1.5, halfWidth * 1.5 / width, halfHeight * 1.4 / height);
        const balance = Math.min(...rows.map(row => row.width)) / width;
        const score = fit * (0.94 + 0.06 * balance);
        if (best && best.score >= score) continue;
        let top = height / 2;
        const models = rows.flatMap((row, rowIndex) => {
            const bottom = top - row.height;
            let left = -row.width / 2;
            const placed = row.models.map(item => {
                const radius = item.radius * item.scale;
                const x = left + radius;
                left += radius * 2 + gap;
                return { ...item, row: rowIndex,
                    x: 0.5 + x * fit,
                    y: centerY + (bottom - item.minY * item.scale) * fit,
                    scale: item.scale * fit };
            });
            top = bottom - (rowIndex < rows.length - 1 ? rowGap(rowIndex) : 0);
            return placed;
        });
        best = { score, models };
    }
    return best?.models || [];
}
