// Outbound requests from PaperCrane carry one identifying User-Agent, so the
// upstream service can contact us rather than block the traffic. Keep the
// version in sync with apps/paperboard/package.json.
export const PAPERBOARD_USER_AGENT =
    "MileniumHQ/Paperboard/3.0.0-alpha (+https://paperboard.dev)";
