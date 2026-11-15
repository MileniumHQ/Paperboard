// The SDK as paperapiStub.ts has it, on a device other than the agent's:
// this page is both the panel's frame and its shell, and the shell catches
// the browser coming back to a sign-in's loopback address at once, with the
// address it landed on. The sign-in itself is PaperAPI's own
// catchLoopbackSignIn, asking over postMessage as it does in Paperboard.
import { setFrameSession } from "../../../../packages/paperapi/src/frameSession";

export * from "./paperapiStub";
export { catchLoopbackSignIn } from "../../../../packages/paperapi/src/loopback";

export const CAUGHT = "http://localhost:1455/callback?code=caught";

setFrameSession({ generation: "fixture", widget: false, computerName: null });
window.addEventListener("message", (event) => {
    if (event.data?.type !== "paperboard:loopback-redirect") return;
    const { generation, requestId } = event.data;
    window.postMessage({ type: "paperboard:loopback-redirect-result", generation, requestId, result: { status: "caught", url: CAUGHT } }, "*");
});
