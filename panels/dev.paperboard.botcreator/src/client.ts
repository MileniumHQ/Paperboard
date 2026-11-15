// The page's and widgets' line to the service, made from the panel's
// contract: its calls and its events.
import { serviceClient } from "@mileniumhq/paperapi";
import { botCreatorContract } from "./contract";

export const botCreator = serviceClient(botCreatorContract);
