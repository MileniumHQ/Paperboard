// What the shell gets from Electron, for the tests of its Electron-only
// paths. The preload's bridge (window.paperboardShell) is stood in for by the same calls carried
// over the shell host's HTTP bridge, the boundary the browser shell crosses
// too; and a panel:// address, which Electron's protocol handler serves, is
// loaded from the host's panel folder of the same panel, which serves the
// same files.
export const ELECTRON_PRELOAD = `(() => {
    if (window.top !== window) return;
    const listeners = new Map();
    let source = null;
    const post = async (kind, channel, args) => {
        const res = await fetch("/_shell/" + kind + "/" + encodeURIComponent(channel), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ args }),
        });
        if (!res.ok) throw new Error(channel + " failed: HTTP " + res.status + " " + (await res.text()));
        return res;
    };
    window.paperboardShell = {
        async invoke(channel, args) {
            const body = await (await post("invoke", channel, args)).json();
            if (!body.ok) throw new Error(body.error || channel + " failed");
            return body.result;
        },
        send(channel, args) {
            post("send", channel, args).catch((err) => console.error(err));
        },
        on(channel, listener) {
            source ??= new EventSource("/_shell/events");
            if (!listeners.has(channel)) {
                listeners.set(channel, new Set());
                source.addEventListener(channel, (message) => {
                    for (const l of listeners.get(channel)) l(JSON.parse(message.data));
                });
            }
            listeners.get(channel).add(listener);
            return () => listeners.get(channel).delete(listener);
        },
    };
    const src = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
        ...src,
        set(url) {
            if (!String(url).startsWith("panel://")) return src.set.call(this, url);
            const panel = new URL(url);
            const dot = panel.hostname.indexOf(".");
            const computerId = panel.hostname.slice(0, dot);
            const panelId = panel.hostname.slice(dot + 1);
            src.set.call(this, location.origin + "/_panel/" + computerId + "/" + panelId + panel.pathname + panel.search);
        },
    });
})()`;
