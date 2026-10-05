// Preview/export the DMG artwork using paperdocs' real renderer and assets.
// Run: bun scripts/preview-dmg-background.ts
// Capture / at 540x380 and /?scale=2 at 1080x760, after document.fonts.ready
// and the styled-text SVG have rendered. Keep browser device scale at 1.
import { fileURLToPath } from "node:url";

const asset = (path: string) => Bun.file(fileURLToPath(new URL(path, import.meta.url)));
const publicAsset = (path: string) => asset(`../apps/paperdocs/public/${path}`);
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 8791,
    routes: {
        "/": new Response(asset("../apps/paperboard/build/background.html")),
        "/paperui/colors.css": new Response(asset("../packages/paperui/src/styles/colors.css")),
        "/css/style.css": new Response(publicAsset("css/style.css")),
        "/css/fonts.css": new Response(publicAsset("css/fonts.css")),
        "/css/styled-text.css": new Response(publicAsset("css/styled-text.css")),
        "/css/bg-overlay.css": new Response(publicAsset("css/bg-overlay.css")),
        "/html/styled-text.html": new Response(publicAsset("html/styled-text.html")),
        "/html/bg-overlay.html": new Response(publicAsset("html/bg-overlay.html")),
        "/js/styled-text.js": new Response(publicAsset("js/styled-text.js")),
        "/js/bg-overlay.js": new Response(publicAsset("js/bg-overlay.js")),
        "/fonts/Nunito.woff2": new Response(publicAsset("fonts/Nunito.woff2")),
    },
    fetch() { return new Response("Not found", { status: 404 }); },
});
process.once("SIGINT", () => server.stop(true));
process.once("SIGTERM", () => server.stop(true));
console.log(`DMG background preview: ${server.url}`);
