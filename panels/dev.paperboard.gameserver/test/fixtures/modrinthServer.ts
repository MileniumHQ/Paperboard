import { createSignal } from "solid-js";
export const [serverSoftware, setServerSoftware] = createSignal("vanilla");
export const [serverVersion, setServerVersion] = createSignal("");
export const updatePanelConfig = async () => {};
export const serverBridge = { call: async () => ({ plugins: [] }) };
