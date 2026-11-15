// Bot Creator's service whose vault won't give back a bot's token, the way a
// vault that can't be reached or decrypted refuses: every other secret, and
// everything else the service does, is the real thing.
import { secretsApi } from "@mileniumhq/paperapi";
import { tokenOwner } from "../../src/bots";

const get = secretsApi.get;
secretsApi.get = (name, panelId) =>
    tokenOwner(name)?.kind === "token" ? Promise.reject(new Error("the vault couldn't be decrypted")) : get(name, panelId);

await import("../../src/service");
