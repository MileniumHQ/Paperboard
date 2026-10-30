// The server's names for its ports in Paperboard's port registry.
export const JAVA_PORT_NAME = "java";
export const BEDROCK_PORT_NAME = "bedrock";

export function serverPortLabel(name: string, label: string): string {
    return `${name.slice(0, 80 - label.length - 3)} · ${label}`;
}
export function serverPortName(id: string, legacy: boolean, name: string): string {
    return legacy ? name : `${id}-${name}`;
}
