// The libraries only some actions need, each loaded the first time one of
// those actions runs. A server panel with nothing to map, unzip or edit never
// holds them; together they were most of the idle service's memory. Types
// still come from `import type`. A load that fails rejects here, so it is the
// error of the action that asked, and the next action tries again.

/** YAML: loader settings (Paper, Spigot, Geyser) and a plugin's plugin.yml */
export const loadYaml = () => import("yaml");

/** PNG: map tiles, the server icon and player heads */
export const loadPng = () => import("pngjs");

/** ZIP: world import and export, modpacks, add-on uploads and Terraria's installer */
export const loadZip = () => import("fflate");

/** NBT: the map's chunks */
export const loadNbt = async () => (await import("prismarine-nbt")).default;
