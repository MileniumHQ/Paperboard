// A player's Steam account as the 17-digit number Steam Community's addresses
// use, from the form a game prints it in. The service takes only that form
// (service/steamAvatars.ts).

/** The 64-bit id of the first account: an account's id is this plus its number. */
const FIRST_ACCOUNT = 76561197960265728n;
const ACCOUNT_COUNT = 2n ** 32n;

const accountId = (number: bigint): string | null => (number > 0n && number < ACCOUNT_COUNT ? String(FIRST_ACCOUNT + number) : null);

/**
 * A person's 17-digit Steam id from how a game writes it: as it is, in
 * Source's `[U:1:n]` and `STEAM_0:y:z` forms, or after Palworld's `steam_`
 * and Valheim's `Steam_`.
 * Null for what is no person's Steam account, such as a bot or another
 * platform's player.
 */
export function steamAccount(id: string): string | null {
    const long = /^(?:steam_)?(\d{17})$/i.exec(id);
    if (long) return accountId(BigInt(long[1]!) - FIRST_ACCOUNT) ? long[1]! : null;
    const modern = /^\[U:1:(\d{1,10})\]$/.exec(id);
    if (modern) return accountId(BigInt(modern[1]!));
    const legacy = /^STEAM_[0-5]:([01]):(\d{1,10})$/.exec(id);
    if (legacy) return accountId(BigInt(legacy[2]!) * 2n + BigInt(legacy[1]!));
    return null;
}
