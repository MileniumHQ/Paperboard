// A panel's page and its own service talk over internal blocks: never
// listed, refused to every other panel by the daemon. The service names
// its calls and events freely ("renameTab", "agent:entry"); each becomes a
// block id here, prefixed so it can never clash with a block the panel
// shows in the Blocks panel.

/** The internal value a panel's page reads its service's state from. */
export const STATE_VALUE = "panel-state";
/** The internal event a service's state changes travel on. */
export const STATE_EVENT = "panel-state-changed";
/** The internal value a page reads one key of its service's keyed state from, or a keyed field whole. */
export const STATE_KEY_VALUE = "panel-state-key";
/** The internal command Home asks a widget option's dropdown from. */
export const WIDGET_CHOICES_COMMAND = "widget-choices";

const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function internalId(prefix: "call-" | "emit-", name: string, what: string): string {
    if (typeof name !== "string" || !name) throw new Error(`A ${what} needs a name`);
    const kebab = name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const id = `${prefix}${kebab}`;
    if (!kebab || !BLOCK_ID.test(id)) {
        throw new Error(`The ${what} "${name}" can't be named: use letters, digits and dashes, at most ${64 - prefix.length} characters`);
    }
    return id;
}

/** The internal command a service call is registered as. */
export const callBlockId = (name: string): string => internalId("call-", name, "service call");
/** The internal event a service event is fired as. */
export const eventBlockId = (name: string): string => internalId("emit-", name, "service event");
