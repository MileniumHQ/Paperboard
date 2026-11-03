// The environment a workload starts with (supervisor.ts): the supervisor's
// own, which is the daemon's, then `extra`, then what the creator asked for.
//
// PWD names the workload's own working directory. Inherited, it would name
// the daemon's, and programs that trust PWD over getcwd (`opencode run` does)
// would work there instead of where they were started.
//
// Windows names are case-blind and its search path is usually "Path": a copy
// of process.env is a plain object, so it is found by any case, never added
// beside it (a child given both would search only one).

export function workloadEnv(
    configEnv: Record<string, string | undefined> | undefined,
    cwd: string,
    extra: Record<string, string> = {},
    base: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): Record<string, string> {
    const env = { ...base, ...extra, ...(configEnv || {}) } as Record<string, string>;
    if (configEnv?.JAVA_HOME) {
        const win = platform === "win32";
        const key = (win && Object.keys(env).find((k) => k.toUpperCase() === "PATH")) || "PATH";
        env[key] = `${configEnv.JAVA_HOME}/bin${win ? ";" : ":"}${env[key] || ""}`;
    }
    env.PWD = cwd;
    delete env.OLDPWD;
    return env;
}
