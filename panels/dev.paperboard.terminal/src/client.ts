// The page's line to its service, made from the panel's contract: its calls,
// and the state every window mirrors.
import { serviceClient } from "@mileniumhq/paperapi";
import { terminalContract } from "./lib/contract";

export const terminal = serviceClient(terminalContract);
