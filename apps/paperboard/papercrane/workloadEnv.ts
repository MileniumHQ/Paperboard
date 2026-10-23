// The environment a workload starts with, for both supervisors (the
// supervisor process and the embedded one in the Electron app): the daemon's
// own, then `extra`, then what the creator asked for.
//
// PWD names the workload's own working directory. Inherited, it would name
// the daemon's, and programs that trust PWD over getcwd (`opencode run` does)
// would work there instead of where they were started.

export function workloadEnv(
    configEnv: Record<string, string | undefined> | undefined,
    cwd: string,
    extra: Record<string, string> = {},
): Record<string, string> {
    const env = { ...process.env, ...extra, ...(configEnv || {}) } as Record<string, string>;
    if (configEnv?.JAVA_HOME) {
        const delim = process.platform === "win32" ? ";" : ":";
        env.PATH = `${configEnv.JAVA_HOME}/bin${delim}${env.PATH || ""}`;
    }
    env.PWD = cwd;
    delete env.OLDPWD;
    return env;
}
