// The page's line to its service: every window mirrors the service's state
// and makes the calls of the panel's contract through one client.
import { serviceClient } from "@mileniumhq/paperapi";
import { blocksContract } from "./panel";

const client = serviceClient(blocksContract);
export const service = client.calls;
export const serviceState = client.state;

/** What finished or failed: a title naming the operation, and what happened. */
export interface Notice {
    kind: "done" | "failed";
    title: string;
    text: string;
}
