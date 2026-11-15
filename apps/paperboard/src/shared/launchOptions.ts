// What this launch was asked to do differently, read from the command line
// by main and handed to the shell over the "launch-options" channel.
import { shape, type Infer } from "@mileniumhq/paperapi";

export const launchOptions = shape.object({
    /** true with --mobile: the phone layout, in a window shaped like an iPhone 16 Pro */
    mobile: shape.boolean(),
});
export type LaunchOptions = Infer<typeof launchOptions>;

export function launchOptionsFromArgv(argv: readonly string[]): LaunchOptions {
    return {
        mobile: argv.includes("--mobile"),
    };
}
