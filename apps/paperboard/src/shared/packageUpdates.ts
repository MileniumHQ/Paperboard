// a runtime package update that is downloaded and verified on a computer
// but not installed yet: it waits for the panels whose processes still run
// from the installed release, or its install failed and the previous
// release kept working
export interface PackageUpdateNotice {
    computerId: string;
    computerName: string;
    packageName: string;
    version: string;
    // display names of the panels whose important or long-running
    // processes hold the update back ("Paperboard" for processes the app
    // started itself); empty when what uses it can stop for it
    panels: string[];
    error?: string;
}

export interface PackageUpdatesState {
    notices: PackageUpdateNotice[];
    // computers that answered but could not report their waiting updates
    failures: Array<{ computerId: string; computerName: string; error: string }>;
}
