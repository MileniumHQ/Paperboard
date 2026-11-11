// discord.js, loaded the first time something needs it. The library and what
// it brings with it are most of this service's memory, and a service with no
// bot running never touches Discord, so nothing here imports it up front:
// types come from `import type`, values from one of the two functions below.
type Discord = typeof import("discord.js");

let loading: Promise<Discord> | undefined;
let loaded: Discord | undefined;

/** discord.js, imported once. A failed import rejects here, and the next call tries again. */
export function loadDiscord(): Promise<Discord> {
    loading ??= import("discord.js").then(
        (lib) => (loaded = lib),
        (err) => {
            loading = undefined;
            throw err;
        },
    );
    return loading;
}

/**
 * discord.js for code that cannot wait and already holds something of a
 * bot's: a session loads the library before its client exists, so by then it
 * is here. Anything that can run with no bot started awaits loadDiscord().
 */
export function discord(): Discord {
    if (!loaded) throw new Error("discord.js is not loaded yet: no bot has been started");
    return loaded;
}
