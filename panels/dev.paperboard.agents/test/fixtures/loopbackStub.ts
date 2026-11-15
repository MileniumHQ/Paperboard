// The SDK as paperapiStub.ts has it, on a device other than the agent's:
// the browser coming back to a sign-in's loopback address is caught here,
// at once, with the address it landed on.
export * from "./paperapiStub";

export const CAUGHT = "http://localhost:1455/callback?code=caught";

export function catchLoopbackRedirect(): Promise<{ status: "caught"; url: string }> {
    return Promise.resolve({ status: "caught", url: CAUGHT });
}
