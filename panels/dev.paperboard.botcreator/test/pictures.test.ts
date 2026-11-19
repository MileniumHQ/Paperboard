// A page never loads a picture someone else chose: the service fetches
// avatars and server icons from Discord's CDN, and only from there, and hands
// the page the bytes. Everything else is refused with the reason.
import { describe, expect, test } from "bun:test";
import { discordPicture } from "../src/discordCdn";
import { recordedSession, useFakeDiscord } from "./helpers/session";

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
        await expect(discordPicture(`${cdn()}/moved.png`)).rejects.toThrow("redirected more than 0 times");

        discord().cdnAnswers.set("/cdn/page.png", () => new Response("<script>", { headers: { "content-type": "text/html" } }));
        await expect(discordPicture(`${cdn()}/page.png`)).rejects.toThrow("sent text/html where a picture should be, and it isn't one");

        discord().cdnAnswers.set("/cdn/huge.png", () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "content-type": "image/png" } }));
        await expect(discordPicture(`${cdn()}/huge.png`)).rejects.toThrow("is over 1 MB");

        // a refused fetch isn't kept: once the CDN has the picture, it shows
        discord().cdnAnswers.delete("/cdn/huge.png");
        expect(await discordPicture(`${cdn()}/huge.png`)).toMatch(/^data:image\/png;base64,/);
    });

    test("a bot that changes its picture is told, and its new picture is fetched rather than the one kept", async () => {
        const fake = discord().addBot({ username: "Painted Bot" });
        const bot = recordedSession("b-painted");
        await bot.session.start(fake.token);
        await bot.until(() => bot.session.connected(), "the bot to connect");
        const before = bot.session.info().avatar;
        await discordPicture(before);

        discord().dispatch(fake, "USER_UPDATE", { id: fake.appId, username: fake.username, discriminator: "0", global_name: null, avatar: "0123456789abcdef0123456789abcdef", bot: true });
        await bot.until(() => bot.session.info().avatar !== before, "the bot's new picture");
        const after = bot.session.info().avatar;
        expect(after).toContain(`/avatars/${fake.appId}/0123456789abcdef0123456789abcdef`);
        const asked = discord().pictures.length;
        await discordPicture(after);
        expect(discord().pictures.slice(asked)).toEqual([`/cdn/avatars/${fake.appId}/0123456789abcdef0123456789abcdef.webp?size=128`]);
    });
});
