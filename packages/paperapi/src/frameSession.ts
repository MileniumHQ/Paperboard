// The generation the shell gave this document when it challenged it.
// Requests a panel frame sends its shell carry it, so a reply meant for an
// earlier load of the same frame is never taken for this one's.
export interface FrameSession {
    generation: string;
    widget: boolean;
}

let session: FrameSession | null = null;

export function setFrameSession(next: FrameSession): void {
    session = next;
}

export function currentFrameSession(): FrameSession | null {
    return session;
}
