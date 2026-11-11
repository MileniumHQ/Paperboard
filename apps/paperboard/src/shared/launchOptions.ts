// What this launch was asked to do differently, read from the command line
// by main and handed to the shell over the "launch-options" channel.

export interface LaunchOptions {
    /** true with --mobile: the phone layout, in a window shaped like an iPhone 16 Pro */
    mobile: boolean;
}

export function launchOptionsFromArgv(argv: readonly string[]): LaunchOptions {
    return {
        mobile: argv.includes("--mobile"),
    };
}
