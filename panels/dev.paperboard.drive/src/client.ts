// The page's line to its service, made from the panel's contract.
import { serviceClient } from "@mileniumhq/paperapi";
import { driveContract } from "./lib/contract";

export const drive = serviceClient(driveContract);
