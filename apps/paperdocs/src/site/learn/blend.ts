// A blended field (LearnPanel.blend, learn.css): one soft pool per colour,
// in list order from the top of the page down, alternating sides.
export function blendField(colors: string[]): string {
    return colors
        .map((color, index) => {
            const x = colors.length === 1 ? 50 : index % 2 ? 88 : 12;
            const y = colors.length === 1 ? 4 : 4 + (index * 74) / (colors.length - 1);
            return `radial-gradient(ellipse 70% 26% at ${x}% ${y}%, color-mix(in oklab, ${color} var(--learn-pool), var(--paper-marketing-ink)), transparent)`;
        })
        .join(", ");
}
