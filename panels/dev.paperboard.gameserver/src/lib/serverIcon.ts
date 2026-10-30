// The server list icon, over the panel's bridge. The page decodes and scales
// the picked image, since the browser reads every format people have
// (PNG, JPEG, WebP, GIF); the service checks the result and writes it.
import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import { SERVER_ICON_SIZE } from "../core/serverIcon";

export const readServerIcon = () => serverBridge.call<string | null>(ACTION_IDS.readServerIcon, {});
export const removeServerIcon = () => serverBridge.call<boolean>(ACTION_IDS.removeServerIcon, {});

/**
 * The picked image as the game wants it: the centre square, at 64×64. A
 * smaller image (pixel art) is enlarged without smoothing so it stays crisp.
 */
async function scaleToServerIcon(file: File): Promise<string> {
    let bitmap: ImageBitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error(`"${file.name}" isn't an image Paperboard can read.`);
    }
    try {
        const side = Math.min(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = SERVER_ICON_SIZE;
        canvas.height = SERVER_ICON_SIZE;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The browser couldn't make a canvas to scale the icon.");
        context.imageSmoothingEnabled = side > SERVER_ICON_SIZE;
        context.imageSmoothingQuality = "high";
        context.drawImage(
            bitmap,
            (bitmap.width - side) / 2,
            (bitmap.height - side) / 2,
            side,
            side,
            0,
            0,
            SERVER_ICON_SIZE,
            SERVER_ICON_SIZE,
        );
        return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
    } finally {
        bitmap.close();
    }
}

/** replaces the icon with `file`; resolves with the new icon's data URL */
export async function setServerIconFromFile(file: File): Promise<string> {
    const png = await scaleToServerIcon(file);
    return serverBridge.call<string>(ACTION_IDS.setServerIcon, { png });
}
