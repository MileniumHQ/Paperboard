import type { GameServerState } from "./types";
import { DEFAULT_MOTD } from "../core/motd";
export const initialServerState = (): GameServerState => ({
    serverStatus: "offline",
    serverEntries: [],
    chatMessages: [],
    localIp: "127.0.0.1",
    serverPort: "25565",
    serverMotd: DEFAULT_MOTD,
    serverSoftware: "paper",
    serverVersion: "",
    ramAllocation: 4,
    onlinePlayers: [],
    maxPlayers: null,
    seenPlayers: [],
    playerStats: {},
    playerPlaytime: {},
    playerPositions: {},
    gamerules: {},
    installProgress: null,
    modpackProgress: null,
    activeIssue: null,
    recoveryBlock: null,
});
