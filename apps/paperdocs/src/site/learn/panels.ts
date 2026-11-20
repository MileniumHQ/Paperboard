export interface PanelFeature {
    title: string;
    description: string;
    image: string;
    alt: string;
}
export interface LearnPanel {
    slug: string;
    name: string;
    seoTitle: string;
    icon: string;
    accent: string;
    headline: string;
    /** where the headline may wrap; every panel's headline is set at one size */
    headlineLines: string[];
    description: string;
    summary: string;
    image: string;
    alt: string;
    features: PanelFeature[];
    note?: string;
    /** colours the page's field blends, for a panel that stands for several others; without it the field is the accent alone */
    blend?: string[];
}

// Editorial summaries of each panel's store/about.md. Keep claims aligned with
// the shipped panel; all pages, routes and related links come from this list,
// in this order: the site lists the panels this way everywhere.
export const LEARN_PANELS: LearnPanel[] = [
    {
        slug: "agents",
        summary: "An agent you text, with a computer of its own",
        name: "Agent",
        seoTitle: "Your own AI agent | Paperboard",
        icon: "/pictures/agents.png",
        accent: "var(--paper-panel-agents)",
        headline: "An agent you text",
        headlineLines: ["An agent", "you text"],
        description:
            "Text it like a friend. It makes you apps, browses the web, and asks before it touches your computer.",
        image: "/screens/agents-5.png",
        alt: "Texting your agent to wipe a game server, and the new map it sends back",
        features: [
            {
                title: "It makes you apps",
                description:
                    "Ask for a planner, a tracker, or a list, and it builds a small app that opens beside the chat.",
                image: "/screens/agents-1.png",
                alt: "An app the agent made, open beside the chat",
            },
            {
                title: "It has a computer of its own",
                description: "It browses the web in its own browser, which you can watch and use yourself.",
                image: "/screens/agents-2.png",
                alt: "The agent's computer, a web browser you can watch and use",
            },
            {
                title: "It remembers what matters",
                description: "It keeps facts and notes as you talk. Read them all, and make it forget anything.",
                image: "/screens/agents-6.png",
                alt: "What the agent remembers: short facts and longer notes",
            },
            {
                title: "It asks before it touches your computer",
                description:
                    "To open a folder or run a command on your computer, it asks first. Allow it once, always, or decline, and change your mind on the Access page.",
                image: "/screens/agents-3.png",
                alt: "The agent asking permission to remove files in a folder, with Allow this time, Always allow and Decline",
            },
            {
                title: "It adds its own tools",
                description:
                    "Ask it to connect a service, or add a tool server yourself. Their keys stay safe in Paperboard's vault.",
                image: "/screens/agents-tools.png",
                alt: "The agent's tool servers, each with its own switch, and a way to add another",
            },
            {
                title: "It keeps your routines",
                description:
                    "Ask for a reminder or a daily check-in, and it runs on a schedule you can see and delete.",
                image: "/screens/agents-7.png",
                alt: "Routines: what the agent does on a schedule",
            },
        ],
        note: "You'll need a Codex, Claude, or OpenCode account. OpenCode also has free models.",
    },
    {
        slug: "game-server",
        summary: "Servers for Minecraft, Counter-Strike 2, Rust & more",
        name: "Game Server",
        seoTitle: "Game server manager for Minecraft, Rust and more | Paperboard",
        icon: "/pictures/game-server.png",
        accent: "var(--paper-panel-gameserver)",
        headline: "A server in minutes",
        headlineLines: ["A server", "in minutes"],
        description:
            "Run servers for Minecraft, Terraria, Palworld, Team Fortress 2, Counter-Strike 2, Garry's Mod and Rust on your own computer. Pick a game, and Paperboard sets up the rest. No terminal needed.",
        image: "/screens/gameserver-hero.png",
        alt: "Servers for Minecraft, Terraria, Palworld, Garry's Mod, Rust, Team Fortress 2 and Counter-Strike 2",
        features: [
            {
                title: "Watch it live",
                description:
                    "Start, stop, and talk to a server from its overview, with its console and players right there.",
                image: "/screens/gameserver-2.png",
                alt: "A Minecraft server's overview and live console",
            },
            {
                title: "See your world",
                description: "Explore a live map of your Minecraft world while people play.",
                image: "/screens/gameserver-3.png",
                alt: "Live map of a Minecraft world",
            },
            {
                title: "Manage your players",
                description: "See player stats, manage the whitelist, and handle moderation.",
                image: "/screens/gameserver-4.png",
                alt: "Players with their stats, whitelist and operator controls",
            },
            {
                title: "Find your plugins",
                description:
                    "Search Modrinth, install plugins and mods, and keep them updated from the panel.",
                image: "/screens/gameserver-5.png",
                alt: "Plugins installed from Modrinth",
            },
            {
                title: "More than Minecraft",
                description:
                    "Set a Rust map's size and seed and see it from above, pick maps for Counter-Strike 2 and Garry's Mod from their pictures, and wipe a Rust server in one click.",
                image: "/screens/gameserver-rust.png",
                alt: "A Rust server's map from above, with its size and seed and a Wipe button",
            },
            {
                title: "Greet every player",
                description:
                    "When someone joins, say a welcome in chat. Build it in Blocks.",
                image: "/screens/blocks-2.png",
                alt: "Blocks that welcome a player who joins a server",
            },
        ],
    },
    {
        slug: "bot-creator",
        summary: "Your own Discord bots, without code",
        name: "Bot Creator",
        seoTitle: "Discord bot builder and automation | Paperboard",
        icon: "/pictures/discord-bot.png",
        accent: "var(--paper-panel-botcreator)",
        headline: "Your own Discord bot",
        headlineLines: ["Your own", "Discord bot"],
        description:
            "Make slash commands, buttons, and polls without writing code, then decide what they do in Blocks, from starting a server to asking your agent.",
        image: "/screens/botcreator-2.png",
        alt: "A bot's overview: whether it is connected, how fast it answers, and the latest messages it heard",
        features: [
            {
                title: "Run several bots",
                description: "Each bot gets its own token and commands. Turn any of them off with one switch.",
                image: "/screens/botcreator-1.png",
                alt: "Several bots, each with its own token and commands",
            },
            {
                title: "Create commands",
                description:
                    "Build slash commands and buttons. Use Blocks for the logic behind them.",
                image: "/screens/botcreator-5.png",
                alt: "Slash commands the bot registers with Discord",
            },
            {
                title: "Browse your servers",
                description:
                    "See channels, roles, and members, and send a message from the panel.",
                image: "/screens/botcreator-4.png",
                alt: "A server's channels and roles, finding members and sending a message",
            },
            {
                title: "Decide what it does",
                description:
                    "Answer a slash command with buttons, start a game server, or ask your agent. Each bot has its own Blocks project.",
                image: "/screens/botcreator-6.png",
                alt: "A bot's games built in Blocks: a slash command answered with buttons",
            },
        ],
        note: "You'll need a Discord application and a bot token to connect. Visual workflows use the Blocks panel.",
    },
    {
        slug: "blocks",
        summary: "Automate every panel with blocks",
        name: "Blocks",
        seoTitle: "Visual block automation | Paperboard",
        icon: "/pictures/blocks.png",
        accent: "var(--paper-primary)",
        headline: "Connect your panels",
        headlineLines: ["Connect", "your panels"],
        description:
            "Snap blocks together to automate every panel. Welcome a player who joins your server, and start it again if it crashes.",
        image: "/screens/blocks-2.png",
        alt: "Blocks that welcome players and restart a game server that crashed",
        blend: [
            "var(--paper-panel-gameserver)",
            "var(--paper-panel-ai)",
            "var(--paper-panel-actions)",
            "var(--paper-panel-botcreator)",
            "var(--paper-panel-agents)",
        ],
        features: [
            {
                title: "Use any panel's blocks",
                description:
                    "The Library holds the blocks every panel adds. Pick a server or a bot, search for a block, and drag it into a project.",
                image: "/screens/blocks-3.png",
                alt: "The Library, with blocks from every panel",
            },
            {
                title: "Keep flows in projects",
                description:
                    "Every server and bot gets a project of its own, and you can make more. Each one shows a preview of its flows.",
                image: "/screens/blocks-1.png",
                alt: "Projects, each with a preview of its flows",
            },
            {
                title: "Run it and watch",
                description:
                    "Press Run to try a flow, and read what each block did in the console.",
                image: "/screens/blocks-4.png",
                alt: "Running a flow and reading its console",
            },
            {
                title: "Plan for what goes wrong",
                description:
                    "Restart a server that crashed or bring a bot back, and say what happens if that fails too.",
                image: "/screens/blocks-5.png",
                alt: "Bringing a bot back, and handling it if that fails",
            },
        ],
    },
];

// Learn pages that moved, kept as redirects so old links still land.
export const MOVED_LEARN_PAGES: { path: string; target: string }[] = [
    { path: "/ai/", target: "/agents/" },
    { path: "/actions/", target: "/blocks/" },
];

/** The longest headline line of any panel: their headlines share one size. */
export const HEADLINE_FIT_LENGTH = Math.max(...LEARN_PANELS.flatMap((panel) => panel.headlineLines.map((line) => line.length)));
