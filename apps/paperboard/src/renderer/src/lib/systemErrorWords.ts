// A system failure said in words. Node names one by its code and the call
// that hit it ("connect ECONNREFUSED 127.0.0.1:1", "EACCES: permission
// denied, open '/srv/a.tmp'"); here each says what happened in a sentence,
// keeping the address or path. Any other text comes back as it was.

const NETWORK = /\b(?:connect|getaddrinfo|read|write) (ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH)(?: ([^\s,]+))?/;
const FILE = /\b(EACCES|EPERM|ENOSPC|ENOENT|EROFS|EEXIST|EBUSY): [^,]+, (\w+) '([^']+)'(?: -> '[^']+')?/;

const NETWORK_WORDS: Record<string, (address: string) => string> = {
    ECONNREFUSED: (at) => `Couldn't reach ${at}. Is the server running?`,
    ENOTFOUND: (at) => `Couldn't find ${at}. Check the address.`,
    EAI_AGAIN: (at) => `Couldn't look up ${at}. Check the network connection.`,
    ETIMEDOUT: (at) => `${at} didn't answer in time.`,
    ECONNRESET: (at) => `${at} closed the connection.`,
    EHOSTUNREACH: (at) => `Couldn't reach ${at}: this computer has no route to it.`,
    ENETUNREACH: (at) => `Couldn't reach ${at}: this computer isn't on a network that leads there.`,
};

// what the call was doing to the path, for a refusal
const DOING: Record<string, string> = {
    open: "open",
    read: "read",
    write: "write",
    mkdir: "make",
    rename: "move",
    copyfile: "copy",
    unlink: "delete",
    rmdir: "delete",
    rm: "delete",
    scandir: "list",
    opendir: "list",
};

const FILE_WORDS: Record<string, (path: string, call: string) => string> = {
    EACCES: (path, call) => `Paperboard isn't allowed to ${DOING[call] ?? "use"} ${path}.`,
    EPERM: (path, call) => `Paperboard isn't allowed to ${DOING[call] ?? "use"} ${path}.`,
    ENOSPC: (path) => `The disk is full, so ${path} couldn't be written.`,
    ENOENT: (path) => `${path} doesn't exist.`,
    EROFS: (path) => `${path} is on a read-only disk.`,
    EEXIST: (path) => `${path} already exists.`,
    EBUSY: (path) => `${path} is in use by another program.`,
};

export function systemErrorWords(text: string): string {
    const network = NETWORK.exec(text);
    if (network) return text.replace(network[0], () => NETWORK_WORDS[network[1]](network[2] ?? "the server"));
    const file = FILE.exec(text);
    if (file) return text.replace(file[0], () => FILE_WORDS[file[1]](file[3], file[2]));
    return text;
}
