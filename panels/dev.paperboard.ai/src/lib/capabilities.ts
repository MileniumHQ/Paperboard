// Model capability labels shared by the browser cards and the detail view.
// Tool use ("actions") is not advertised here: approval happens per call in
// the chat itself.

export const CAPABILITY_LABELS: Record<string, { label: string; icon: string }> = {
    vision: { label: "Vision", icon: "visibility" },
    thinking: { label: "Thinking", icon: "psychology" },
    audio: { label: "Audio", icon: "graphic_eq" },
};

export function knownCapabilities(capabilities: readonly string[]): string[] {
    return capabilities.filter((c) => CAPABILITY_LABELS[c]);
}
