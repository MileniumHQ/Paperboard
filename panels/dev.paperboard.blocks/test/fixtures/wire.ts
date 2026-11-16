// A fixture page's hold on what is around it (test/browserFixture.ts sets
// it up): the calls the page sent its service, as they left on the socket;
// calls refused for real, by sending them for a project the service doesn't
// have; daemon requests refused for real, by asking for a panel that isn't there; a registry listing held on its way back; the test, doing what
// another panel or window does; and the shell the page is framed in.

/** a call of the panel's contract the page made, and its input as it was sent */
export interface SentCall {
    name: string;
    input: any;
}

interface Wire {
    calls: SentCall[];
    refuse(name: string, refused: boolean): void;
    refuseAction(action: string, refused: boolean): void;
    holdNextList(): void;
    held(): number;
    release(): void;
}

const wire = (): Wire => (window as unknown as { __wire: Wire }).__wire;

/** every call the page made of its service, oldest first */
export const calls = (): SentCall[] => wire().calls;
/** from now on the page's call `name` is refused by the service, or again goes as it is */
export const refuse = (name: string, refused: boolean): void => wire().refuse(name, refused);
/** from now on the page's daemon request `action` (such as "backup:list") is refused by the daemon, or again goes as it is */
export const refuseAction = (action: string, refused: boolean): void => wire().refuseAction(action, refused);
/** the answer to the page's next registry listing waits on the page until release() */
export const holdNextList = (): void => wire().holdNextList();
/** how many held answers have arrived */
export const held = (): number => wire().held();
/** hands the page the answers held */
export const release = (): void => wire().release();

/**
 * Asks the test to do something outside the page: another panel or window
 * (test/helpers/otherPanel.ts: "window", "fixture"), "late" ({ do: "start" }),
 * "say" ({ lines }: the service logs each line, in order) or "registry"
 * ({ away }: the service's announcements are refused).
 */
export async function ask<T = unknown>(to: string, request: Record<string, unknown>): Promise<T> {
    const answer = await fetch("/ask", { method: "POST", body: JSON.stringify({ to, request }) });
    const body = (await answer.json()) as { result?: T; error?: string };
    if (!answer.ok) throw new Error(`the test couldn't ${to} ${JSON.stringify(request)}: ${body.error}`);
    return body.result as T;
}

interface Shell {
    __unsaved: boolean;
    __askLeave(): Promise<boolean>;
}
const shell = (): Shell => window.parent as unknown as Shell;

/** what the page told its shell last: whether it holds unsaved work */
export const holdsUnsaved = (): boolean => shell().__unsaved;
/** the shell asks the page whether it may go, as before a restart: true, it may */
export const askLeave = (): Promise<boolean> => shell().__askLeave();
