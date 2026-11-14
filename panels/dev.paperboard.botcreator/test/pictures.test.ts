// A page never loads a picture someone else chose: the service fetches
// avatars and server icons from Discord's CDN, and only from there, and hands
// the page the bytes. Everything else is refused with the reason.
import { describe, expect, test } from "bun:test";
import { discordPicture } from "../src/discordCdn";
import { useFakeDiscord } from "./helpers/session";

const discord = useFakeDiscord();
const cdn = () => `${new URL(discord().api).origin}/cdn`;

describe("a picture from Discord's CDN", () => {
    test("comes back as a data: address of its bytes, asked for at the size the panel draws", async () => {
        const picture = await discordPicture(`${cdn()}/avatars/1/a.png?size=4096`);
        expect(picture).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
        expect(discord().pictures).toContain("/cdn/avatars/1/a.png?size=128");
    });

    test("anything that isn't one is refused, and never fetched off the CDN", async () => {
        const before = discord().pictures.length;
        await expect(discordPicture("http://127.0.0.1:1/cdn/avatars/1/a.png")).rejects.toThrow("only shows pictures from Discord's CDN");
        await expect(discordPicture(`${new URL(discord().api).origin}/api/v10/users/@me`)).rejects.toThrow("only shows pictures from Discord's CDN");
        await expect(discordPicture("not an address")).rejects.toThrow("isn't a picture's address");
        expect(discord().pictures.length).toBe(before);

        // a redirect isn't followed, wherever it points
        discord().cdnAnswers.set("/cdn/moved.png", () => new Response(null, { status: 302, headers: { location: `${cdn()}/avatars/1/a.png` } }));
        await expect(discordPicture(`${cdn()}/moved.png`)).rejects.toThrow("couldn't be reached");

        discord().cdnAnswers.set("/cdn/page.png", () => new Response("<script>", { headers: { "content-type": "text/html" } }));
        await expect(discordPicture(`${cdn()}/page.png`)).rejects.toThrow("sent text/html that isn't a picture");

        discord().cdnAnswers.set("/cdn/huge.png", () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "content-type": "image/png" } }));
        await expect(discordPicture(`${cdn()}/huge.png`)).rejects.toThrow("bigger than");

        // a refused fetch isn't kept: once the CDN has the picture, it shows
        discord().cdnAnswers.delete("/cdn/huge.png");
        expect(await discordPicture(`${cdn()}/huge.png`)).toMatch(/^data:image\/png;base64,/);
    });
});
