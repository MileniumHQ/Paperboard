// Steam profile pictures for the Players tab. Steam's public profile XML
// (steamcommunity.com/profiles/<id>/?xml=1, no key needed) names a profile's
// picture; the service reads that, fetches the picture from Steam's avatar
// hosts under the public-address rule (service/pictures.ts) and hands the
// page a data: address, as it does a map's picture: the page never loads the
// address a web page named. A profile set to private still shows its
// picture to everyone, so the picture is there for any account Steam knows.
import { LimitedQueue, errorMessage } from "@mileniumhq/paperapi";
import { apiFetch } from "../lib/userAgent";
import { steamAccount } from "../games/steam/steamAccount";
import { servedPicture } from "./pictures";

/** The hosts Steam keeps avatars on (its content security policy names these three). */
export const STEAM_AVATAR_HOSTS: string[] = ["avatars.fastly.steamstatic.com", "avatars.akamai.steamstatic.com", "avatars.cloudflare.steamstatic.com"];

/** Where a profile's XML is. A test routes this host to a stand-in. */
const PROFILE_HOST = "https://steamcommunity.com";
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
/** Profiles remembered; each is an address of about a hundred characters. */
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

/**
 * The picture address in a profile's XML, null for an account Steam has no
 * profile for. Anything else Steam says, or an answer with no picture in it,
 * throws: it is a failure to show, not a profile without a picture.
 */
export function parseProfile(xml: string, account: string): string | null {
    const failure = valueOf(xml, "error") ?? /<div class="error_ctn">[\s\S]*?<h3>([^<]*)<\/h3>/.exec(xml)?.[1]?.trim();
    if (failure !== undefined) {
        if (NO_PROFILE.test(failure)) return null;
        throw new Error(`Steam Community said: ${failure.slice(0, 200)}`);
    }
    if (valueOf(xml, "steamID64") !== account) throw new Error(`Steam Community's answer isn't the profile of ${account}`);
    const picture = valueOf(xml, "avatarFull");
    if (!picture) throw new Error(`Steam Community's profile of ${account} has no picture in it; its layout may have changed`);
    return picture;
}

type Kept = { at: number; picture: string | null };
const kept = new Map<string, Kept>();
const inFlight = new Map<string, Promise<string | null>>();
const line = new LimitedQueue(AT_ONCE);
let coolDown: { until: number; error: Error } | null = null;

/** Steam Community failing as a whole (unreachable, limiting, down): every lookup says so until it has rested. */
function restFrom(error: Error): Error {
    coolDown = { until: Date.now() + COOL_DOWN_MS, error };
    return error;
}

async function readProfile(account: string): Promise<string | null> {
    if (coolDown && Date.now() < coolDown.until) throw coolDown.error;
    let response: Response;
    try {
        response = await apiFetch(`${PROFILE_HOST}/profiles/${account}/?xml=1`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "text/xml" } });
    } catch (err) {
        // fetch says only "fetch failed"; what failed is its cause
        const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
        throw restFrom(new Error(`Couldn't reach Steam Community for profile pictures: ${errorMessage(err)}${cause}`));
    }
    if (response.status === 429) throw restFrom(new Error("Steam Community is limiting how often profile pictures are asked for; they will load again in a minute"));
    if (!response.ok) {
        const error = new Error(`Steam Community answered HTTP ${response.status} for a profile`);
        throw response.status >= 500 ? restFrom(error) : error;
    }
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Steam Community's profile is larger than expected");
    const xml = await response.text();
    if (xml.length > MAX_BYTES) throw new Error("Steam Community's profile is larger than expected");
    return parseProfile(xml, account);
}

/** An account's picture address: from memory when read in the last day, else from Steam, asked once at a time. */
function pictureAddress(account: string): Promise<string | null> {
    const have = kept.get(account);
    if (have && Date.now() - have.at < (have.picture === null ? NONE_KEEP_MS : KEEP_MS)) return Promise.resolve(have.picture);
    let pending = inFlight.get(account);
    if (!pending) {
        pending = line
            .run(() => readProfile(account))
            .then((picture) => {
                kept.delete(account);
                kept.set(account, { at: Date.now(), picture });
                // the oldest go first
                if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
                return picture;
            })
            .finally(() => inFlight.delete(account));
        inFlight.set(account, pending);
    }
    return pending;
}

/**
 * A Steam account's profile picture as a data: address, or null when Steam has
 * none for the account: no profile, or a profile whose picture its avatar host
 * no longer has (measured: an old account's `avatarFull` is a 404 there, as it
 * is for everyone, so Steam itself has nothing to show). Throws why the
 * picture can't be had.
 */
export async function steamAvatar(raw: unknown): Promise<string | null> {
    const account = requireAccount(raw);
    const address = await pictureAddress(account);
    if (address === null) return null;
    try {
        return await servedPicture(address, STEAM_AVATAR_HOSTS, "Steam");
    } catch (err) {
        // the avatar host's own answer that there is no such picture; any other failure is shown
        if (!/ answered 404\b/.test(errorMessage(err))) throw err;
        kept.set(account, { at: Date.now(), picture: null });
        return null;
    }
}
