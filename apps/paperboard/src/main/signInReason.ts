// The reason a Google sign-in was not connected, made safe to print into
// the page the browser lands on: bounded, with markup escaped.
export function signInReasonHtml(reason: string): string {
    return reason.slice(0, 300).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
