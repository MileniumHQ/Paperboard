// What the Palworld dedicated server prints to stdout when a player talks. With
// LogFormatType=Text it formats "[%s] [CHAT]" (the time, "%Y-%m-%d %H:%M:%S")
// and then "%s <%s> %s": the header, the player's name and the message. Chat
// that starts with "/" is a command and is not logged as chat.
const CHAT = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[CHAT\] (.*)$/;
const SAID = /^<(.*?)> (.*)$/;

export interface PalworldChat {
    sender: string;
    content: string;
}

/**
 * Reads one console line. Null for any line that is not chat. A name may
 * itself hold "> ", so the names of the players who are online are tried first.
 */
export function parseChat(line: string, online: readonly string[]): PalworldChat | null {
    const body = CHAT.exec(line)?.[1];
    if (body === undefined) return null;
    for (const name of [...online].sort((a, b) => b.length - a.length)) {
        const prefix = `<${name}> `;
        if (body.startsWith(prefix) && body.length > prefix.length) return { sender: name, content: body.slice(prefix.length) };
    }
    const said = SAID.exec(body);
    if (!said) throw new Error(`Unrecognised chat line: ${line}`);
    return { sender: said[1]!, content: said[2]! };
}
