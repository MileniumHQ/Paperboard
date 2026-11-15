import { shape, type Infer } from "@mileniumhq/paperapi";

export const appUpdateState = shape.object({
    revision: shape.number(),
    status: shape.oneOf("idle", "checking", "current", "downloading", "ready", "failed", "manual"),
    // package-download: a deb or rpm from Paperboard; the user installs the new one
    installMode: shape.oneOf("automatic", "package-manager", "package-download"),
    version: shape.nullable(shape.text()),
    percent: shape.nullable(shape.number()),
    error: shape.nullable(shape.text()),
});
export type AppUpdateState = Infer<typeof appUpdateState>;

export const initialAppUpdateState: AppUpdateState = {
    revision: 0, status: "idle", installMode: "automatic", version: null, percent: null, error: null,
};
