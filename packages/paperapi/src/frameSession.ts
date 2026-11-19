// The generation the shell gave this document when it challenged it.
// Requests a panel frame sends its shell carry it, so a reply meant for an
// earlier load of the same frame is never taken for this one's.
export interface FrameSession {
    generation: string;
    widget: boolean;
    /** what the shell calls the computer this panel runs on ("This
     * Computer", or a paired computer's name); null when it did not say */
    computerName: string | null;
}

export const COMPUTER_NAME_MAX = 120;

export function frameComputerName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const name = value.trim();
    return name ? name.slice(0, COMPUTER_NAME_MAX) : null;
}

let session: FrameSession | null = null;
let arrived: (() => void) | null = null;
const firstSession = new Promise<void>((resolve) => (arrived = resolve));

export function setFrameSession(next: FrameSession): void {
    session = next;
    arrived?.();
}

/** the shell's session once it has given one; a page outside a frame has
 * none to wait for. A panel's first reads run before the shell's
 * initialize message lands, so whatever they show from the session (the
 * computer's name) waits for it rather than read it too early. */
export async function frameSessionArrived(): Promise<FrameSession | null> {
    if (typeof window === "undefined" || window.parent === window) return session;
    await firstSession;
    return session;
}

export function currentFrameSession(): FrameSession | null {
    return session;
}
