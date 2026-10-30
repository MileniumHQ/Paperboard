import type { fileApi } from "@mileniumhq/paperapi";
/** Panel-local filesystem namespace. Resolve before invoking, including transfers. */
export function scopedFiles(api: typeof fileApi, directory: () => string): typeof fileApi {
    const relative = (path: string) => {
        const root = directory();
        if (!root) return path;
        if (path.startsWith("/") || path.includes("\\") || path.split("/").includes(".."))
            throw new Error("Expected a relative server path");
        return path ? `${root}/${path}` : root;
    };
    return new Proxy(api, {
        get(target, key: keyof typeof api) {
            const method = target[key] as (...args: any[]) => any;
            if (key === "clear")
                return () => {
                    throw new Error(
                        "Clear server storage is not supported; remove the server instead",
                    );
                };
            return (...args: any[]) => {
                if (key === "download")
                    args[0] = { ...args[0], targetPath: relative(args[0].targetPath) };
                else if (
                    ["importFile", "importFiles", "importFolder", "exportFile"].includes(key)
                ) {
                    args[0] = relative(args[0]);
                } else args[0] = relative(args[0]);
                return method.apply(target, args);
            };
        },
    });
}
