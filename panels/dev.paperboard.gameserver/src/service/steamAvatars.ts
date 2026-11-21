// Steam profile pictures for the Players tab. Steam's public profile XML
// (steamcommunity.com/profiles/<id>/?xml=1, no key needed) names a profile's
// picture; the service reads that, fetches the picture from Steam's avatar
// hosts under the public-address rule (service/pictures.ts) and hands the
// page a data: address, as it does a map's picture: the page never loads the
// address a web page named. A profile set to private still shows its
// picture to everyone, so the picture is there for any account Steam knows.
import { LimitedQueue, errorMessage } from "@mileniumhq/paperapi";
import { fetchPublic, PublicFetchError, type PublicFetchResponse } from "@mileniumhq/paperapi/net";
import { steamAccount } from "../games/steam/steamAccount";
import { servedPicture } from "./pictures";

/** The hosts Steam keeps avatars on (its content security policy names these three). */
export const STEAM_AVATAR_HOSTS: string[] = ["avatars.fastly.steamstatic.com", "avatars.akamai.steamstatic.com", "avatars.cloudflare.steamstatic.com"];

/** Where a profile's XML is. A test points this at a stand-in on this computer, as it adds one to STEAM_AVATAR_HOSTS. */
export const STEAM_COMMUNITY = { origin: "https://steamcommunity.com" };
/** How long a profile's picture address is kept: people change their picture rarely, and the address names the picture's content, so a change is a new address. */
const KEEP_MS = 24 * 60 * 60 * 1000;
/** How long "no profile" is kept: Steam's words for it are the same as for a profile that failed to load, so it is asked again sooner. */
const NONE_KEEP_MS = 10 * 60 * 1000;
/** How long Steam Community is left alone after it failed or asked us to slow down, so a roster of hundreds is not hundreds of requests to a site that just refused. */
const COOL_DOWN_MS = 60 * 1000;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 256 * 1024;
/** Profiles asked for at once: Steam Community limits what one address asks of it. */
const AT_ONCE = 3;
/** Profiles remembered; each is two addresses of about a hundred characters. */
const MAX_KEPT = 4096;

/** A person's account as the 17-digit number Steam Community's addresses use; anything else is refused. */
export function requireAccount(value: unknown): string {
    const account = typeof value === "string" && /^\d{17}$/.test(value) ? steamAccount(value) : null;
    if (!account) throw new Error("A Steam profile picture is asked for by the account's 17-digit Steam id");
    return account;
}

const XML_VALUE = (tag: string) => new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`);
const valueOf = (xml: string, tag: string): string | undefined => {
    const match = XML_VALUE(tag).exec(xml);
    return match ? (match[1] ?? match[2])!.trim() : undefined;
};

/** What Steam Community says of an account it has no profile for. Measured: a name that was never made gets the first in XML, an account number nobody holds gets the second as an HTML error page with a 200 status. */
const NO_PROFILE = /profile could not be found|failed loading profile data/i;

/** The sizes a page asks for: its rows draw 32 px avatars, which `medium` (64 px) fills, and an opened player 64 px, which wants `full` (184 px) on a sharper screen. */
export type AvatarSize = "medium" | "full";
export function requireSize(value: unknown): AvatarSize {
    if (value !== "medium" && value !== "full") throw new Error(`A Steam profile picture is "medium" or "full", not ${JSON.stringify(value)}`);
    return value;
}

/** The addresses of a profile's picture, by size. */
type Profile = Record<AvatarSize, string>;

/**
 * The picture addresses in a profile's XML, null for an account Steam has no
 * profile for. Anything else Steam says, or an answer with no picture in it,
 * throws: it is a failure to show, not a profile without a picture.
 */
export function parseProfile(xml: string, account: string): Profile | null {
    const failure = valueOf(xml, "error") ?? /<div class="error_ctn">[\s\S]*?<h3>([^<]*)<\/h3>/.exec(xml)?.[1]?.trim();
    if (failure !== undefined) {
        if (NO_PROFILE.test(failure)) return null;
        throw new Error(`Steam Community said: ${failure.slice(0, 200)}`);
    }
    if (valueOf(xml, "steamID64") !== account) throw new Error(`Steam Community's answer isn't the profile of ${account}`);
    const medium = valueOf(xml, "avatarMedium");
    const full = valueOf(xml, "avatarFull");
    if (!medium || !full) throw new Error(`Steam Community's profile of ${account} has no picture in it; its layout may have changed`);
    return { medium, full };
}

type Kept = { at: number; profile: Profile | null };
const kept = new Map<string, Kept>();
const inFlight = new Map<string, Promise<Profile | null>>();
const line = new LimitedQueue(AT_ONCE);
let coolDown: { until: number; error: Error } | null = null;

/** Steam Community failing as a whole (unreachable, limiting, down): every lookup says so until it has rested. */
function restFrom(error: Error): Error {
    coolDown = { until: Date.now() + COOL_DOWN_MS, error };
    return error;
}

async function readProfile(account: string): Promise<Profile | null> {
    if (coolDown && Date.now() < coolDown.until) throw coolDown.error;
    let answer: PublicFetchResponse;
    try {
        answer = await fetchPublic(`${STEAM_COMMUNITY.origin}/profiles/${account}/?xml=1`, {
            maxBytes: MAX_BYTES,
            timeoutMs: TIMEOUT_MS,
            accept: "text/xml",
            // https, every redirect too; only a stand-in on this computer answers over http
            requireHttps: STEAM_COMMUNITY.origin.startsWith("https:"),
        });
    } catch (err) {
        if (!(err instanceof PublicFetchError)) throw err;
        // Steam Community failing as a whole rests the service; any other answer is shown as it is
        if (err.status === 429) throw restFrom(new Error("Steam Community is limiting how often profile pictures are asked for; they will load again in a minute"));
        if (err.code === "unreachable" || err.code === "timeout") throw restFrom(new Error(`Couldn't load profile pictures from Steam Community: ${err.message}`));
        if (err.status !== undefined) {
            const error = new Error(`Steam Community answered HTTP ${err.status} for a profile`);
            throw err.status >= 500 ? restFrom(error) : error;
        }
        if (err.code === "too-large") throw new Error("Steam Community's profile is larger than expected");
        throw new Error(`Couldn't read Steam Community's profile of ${account}: ${err.message}`);
    }
    return parseProfile(new TextDecoder().decode(answer.body), account);
}

/** An account's picture addresses: from memory when read in the last day, else from Steam, asked once at a time. */
function profileOf(account: string): Promise<Profile | null> {
    const have = kept.get(account);
    if (have && Date.now() - have.at < (have.profile === null ? NONE_KEEP_MS : KEEP_MS)) return Promise.resolve(have.profile);
    let pending = inFlight.get(account);
    if (!pending) {
        pending = line
            .run(() => readProfile(account))
            .then((profile) => {
                kept.delete(account);
                kept.set(account, { at: Date.now(), profile });
                // the oldest go first
                if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
                return profile;
            })
            .finally(() => inFlight.delete(account));
        inFlight.set(account, pending);
    }
    return pending;
}

/**
 * A Steam account's profile picture, in the `size` asked for, as a data:
 * address, or null when Steam has none for the account: no profile, or a
 * profile whose picture its avatar host no longer has (measured: an old
 * account's `avatarFull` is a 404 there, as it is for everyone, so Steam
 * itself has nothing to show). Throws why the picture can't be had.
 */
export async function steamAvatar(raw: unknown, size: unknown): Promise<string | null> {
    const account = requireAccount(raw);
    const wanted = requireSize(size);
    const profile = await profileOf(account);
    if (profile === null) return null;
    try {
        return await servedPicture(profile[wanted], STEAM_AVATAR_HOSTS, "Steam");
    } catch (err) {
        // the avatar host's own answer that there is no such picture; any other failure is shown
        if (!(err instanceof Error && err.cause instanceof PublicFetchError && err.cause.status === 404)) throw err;
        kept.set(account, { at: Date.now(), profile: null });
        return null;
    }
}
