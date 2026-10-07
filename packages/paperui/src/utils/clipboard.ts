/**
 * Copies text with the async clipboard API, falling back to a temporary
 * textarea. Returns false and logs when both fail: callers must not claim
 * success on a failed copy.
 */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (err) {
        console.debug("[paperui] clipboard write failed, falling back:", String(err));
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) {
            console.error("[paperui] clipboard copy rejected by the document");
        }
        return ok;
    } catch (err) {
        console.error("[paperui] clipboard copy failed:", err);
        return false;
    }
}

/**
 * Reads text with the async clipboard API, falling back to a temporary
 * focused textarea. Returns null, not "", when both paths fail: callers must
 * distinguish an unavailable clipboard from an empty one.
 */
export async function pasteText(): Promise<string | null> {
    try {
        if (navigator.clipboard?.readText) {
            return await navigator.clipboard.readText();
        }
    } catch (err) {
        console.debug("[paperui] clipboard read failed, falling back:", String(err));
    }

    try {
        const textarea = document.createElement("textarea");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        const ok = document.execCommand("paste");
        const text = textarea.value;
        document.body.removeChild(textarea);
        if (!ok) {
            console.error("[paperui] clipboard paste rejected by the document");
            return null;
        }
        return text;
    } catch (err) {
        console.error("[paperui] clipboard paste failed:", err);
        return null;
    }
}
