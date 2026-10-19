// What this launch was asked to do differently, read from the command line
// by main and handed to the shell over the "launch-options" channel.

export interface LaunchOptions {
    /** false with --no-tutorial: nothing opens a tutorial by itself (dev and agent runs) */
    firstOpenTutorials: boolean;
}

export function launchOptionsFromArgv(argv: readonly string[]): LaunchOptions {
    return { firstOpenTutorials: !argv.includes("--no-tutorial") };
}
