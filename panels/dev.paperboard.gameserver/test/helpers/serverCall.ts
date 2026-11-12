// One of a server's calls, the way its page makes it: by name, with the
// server it is for in the input.
import { serviceApi, type BlockCallOptions } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../../src/service/contract";

export const callServer = <T = unknown>(server: string, name: string, input: Record<string, unknown> = {}, options?: BlockCallOptions): Promise<T> =>
    serviceApi.call<T>(PANEL_ID, name, { ...input, server }, { timeoutMs: null, ...options });
