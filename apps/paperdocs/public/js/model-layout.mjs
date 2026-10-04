// Cylinders contain every model through its full hover turn, including models
// whose origins are off-centre. Layout and the animated handoff share them.
export function separatedModels(a, b) {
    if (Math.abs(a.x - b.x) > a.radius * a.scale + b.radius * b.scale) return true;
    const amin = a.y + a.minY * a.scale, bmin = b.y + b.minY * b.scale;
    return amin + a.height * a.scale < bmin || bmin + b.height * b.scale < amin;
}

export function layoutModels(items, { halfWidth, halfHeight, centerY = 0.5 }) {
    if (!items.length) return [];
    const station = items.find(item => item.id === "battlestation");
    const devices = items.filter(item => item !== station);
    const gap = 0.24;
    const connectionGap = 1.4;
    let best;
    // Keep the battlestation in its own right-hand column. Only the smaller
    // device group changes its row count when the viewport changes.
    for (let columns = 1; columns <= Math.max(1, devices.length); columns++) {
        const rows = [];
        for (let start = 0; start < devices.length; start += columns) {
            const models = devices.slice(start, start + columns);
            rows.push({
                models,
                width: models.reduce((sum, item) => sum + 2 * item.radius * item.scale, 0) + gap * (models.length - 1),
                height: Math.max(...models.map(item => item.height * item.scale)),
                depth: Math.max(...models.map(item => item.radius * item.scale)),
            });
        }
        const groupWidth = Math.max(0, ...rows.map(row => row.width));
        // A tilted camera projects depth vertically. Reserve extra room between
        // rows so their silhouettes also remain legible from that viewpoint.
        const rowGap = index => gap + (rows[index].depth + rows[index + 1].depth) * 0.22;
        const groupHeight = rows.reduce((sum, row, index) => sum + row.height + (index < rows.length - 1 ? rowGap(index) : 0), 0);
        const stationWidth = station ? 2 * station.radius * station.scale : 0;
        const width = groupWidth + stationWidth + (station && devices.length ? connectionGap : 0);
        const height = Math.max(groupHeight, station ? station.height * station.scale : 0);
        const fit = Math.min(1.5, halfWidth * 1.5 / width, halfHeight * 1.4 / height);
        // Prefer a compact cluster when two arrangements fit equally well.
        const compactness = rows.length ? groupHeight / (Math.max(groupWidth, groupHeight) || 1) : 1;
        const score = fit * (0.94 + 0.06 * compactness);
        if (best && best.score >= score) continue;
        const groupCentre = -width / 2 + groupWidth / 2;
        let top = groupHeight / 2;
        const models = rows.flatMap((row, rowIndex) => {
            const bottom = top - row.height;
            let left = -row.width / 2;
            const placed = row.models.map(item => {
                const radius = item.radius * item.scale;
                const x = left + radius;
                left += radius * 2 + gap;
                return { ...item, row: rowIndex,
                    x: 0.5 + (groupCentre + x) * fit,
                    y: centerY + (bottom - item.minY * item.scale) * fit,
                    scale: item.scale * fit };
            });
            top = bottom - (rowIndex < rows.length - 1 ? rowGap(rowIndex) : 0);
            return placed;
        });
        if (station) models.push({ ...station, row: 0,
            x: 0.5 + (width / 2 - stationWidth / 2) * fit,
            y: centerY - (station.minY + station.height / 2) * station.scale * fit,
            scale: station.scale * fit });
        // The animated main screen remains first even if models arrive late.
        best = { score, models: items.map(item => models.find(model => model.id === item.id)) };
    }
    return best?.models || [];
}
