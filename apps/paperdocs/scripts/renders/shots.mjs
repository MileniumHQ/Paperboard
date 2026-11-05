// Every device image on the landing, rendered by scripts/render-models.mjs.
// width × height is the studio frame; the PNG is trimmed to the model and its
// shadow, and must stay at least minWidth wide: the largest WebP copy the page
// asks for (RENDER_WIDTHS and DEVICE_WIDTHS in src/site/landing/images.ts). yaw turns the camera around the model
// (positive looks from its right), pitch raises it.
export const SHOTS = [
    {
        name: "hero",
        minWidth: 1600,
        width: 2600,
        height: 2200,
        yaw: -20,
        pitch: 12,
        items: [{ model: "all-in-one", screen: "/public/screens/gameserver.png" }],
    },
    {
        name: "laptop",
        minWidth: 960,
        width: 2000,
        height: 1700,
        yaw: 22,
        pitch: 16,
        items: [{ model: "laptop", screen: "/public/screens/botcreator.png" }],
    },
    {
        name: "mini-pc",
        minWidth: 960,
        width: 2000,
        height: 1700,
        yaw: 22,
        pitch: 16,
        items: [{ model: "mini-pc" }],
    },
    {
        name: "dev-board",
        minWidth: 960,
        width: 2000,
        height: 1700,
        yaw: 22,
        pitch: 22,
        items: [{ model: "dev-board" }],
    },
    {
        name: "desktop",
        minWidth: 960,
        width: 2000,
        height: 1700,
        yaw: -22,
        pitch: 12,
        items: [{ model: "battlestation", screen: "/public/screens/gameserver.png" }],
    },
];
