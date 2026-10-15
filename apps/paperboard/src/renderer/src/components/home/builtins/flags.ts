// The flags the Flag widget can fly: horizontal stripes, top to bottom,
// equal heights (a wider band is a colour repeated). Each is its original
// design except Pride, which is drawn in PaperUI's own colours so it
// follows the theme. Apple's 1977 logo flies last.

export interface Flag {
    id: string;
    name: string;
    /** a `--paper-*` token name or a hex colour */
    stripes: string[];
}

export const FLAGS: Flag[] = [
    {
        id: "pride",
        name: "Pride",
        stripes: ["--paper-danger", "--paper-attention", "--paper-warning", "--paper-success", "--paper-primary", "--paper-extra-2"],
    },
    { id: "trans", name: "Transgender", stripes: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"] },
    { id: "bi", name: "Bisexual", stripes: ["#d60270", "#d60270", "#9b4f96", "#0038a8", "#0038a8"] },
    { id: "pan", name: "Pansexual", stripes: ["#ff218c", "#ffd800", "#21b1ff"] },
    { id: "lesbian", name: "Lesbian", stripes: ["#d52d00", "#ff9a56", "#ffffff", "#d362a4", "#a30262"] },
    { id: "gay", name: "Gay men", stripes: ["#078d70", "#26ceaa", "#98e8c1", "#ffffff", "#7bade2", "#5049cc", "#3d1a78"] },
    { id: "nonbinary", name: "Nonbinary", stripes: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"] },
    { id: "genderfluid", name: "Genderfluid", stripes: ["#ff76a4", "#ffffff", "#c011d7", "#000000", "#2f3cbe"] },
    { id: "genderqueer", name: "Genderqueer", stripes: ["#b57edc", "#ffffff", "#4a8123"] },
    { id: "agender", name: "Agender", stripes: ["#000000", "#bcc4c7", "#ffffff", "#b7f684", "#ffffff", "#bcc4c7", "#000000"] },
    { id: "asexual", name: "Asexual", stripes: ["#000000", "#a3a3a3", "#ffffff", "#800080"] },
    { id: "aromantic", name: "Aromantic", stripes: ["#3da542", "#a7d379", "#ffffff", "#a9a9a9", "#000000"] },
    { id: "apple", name: "Apple", stripes: ["#61bb46", "#fdb827", "#f5821f", "#e03a3e", "#963d97", "#009ddc"] },
];

/** A stripe as CSS: a token is read through `var()`, a hex is used as is. */
export function stripeColor(stripe: string): string {
    return stripe.startsWith("--paper-") ? `var(${stripe})` : stripe;
}

export function flagById(id: string | undefined): Flag | undefined {
    return FLAGS.find((flag) => flag.id === id);
}
