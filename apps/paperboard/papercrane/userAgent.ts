// Outbound requests from PaperCrane carry one identifying User-Agent, so the
// upstream service can contact us rather than block the traffic. The version
// is set with the app's by apps/paperboard/scripts/sync-versions.ts.
export const PAPERBOARD_USER_AGENT =
    "MileniumHQ/Paperboard/0.2.2 (+https://paperboard.dev)";
