export interface PaperboardCopy {
  tagline: string;
  text: string;
}

export const PAPERBOARD_COPIES: PaperboardCopy[] = [
  {
    tagline: "Your computer did that. Not a server farm.",
    text: "Cloud converters make you wait in line to use their overloaded machines. Paperboard believes your own computer should run your tools, servers, and apps. Fast, private, and 100% free.",
  },
  {
    tagline: "No queue. No cloud. No monthly subscription.",
    text: "Why pay $10 a month just to change a file extension? Paperboard is the desktop workspace that lets you run real tools, background bots, and game servers right on your own hardware.",
  },
  {
    tagline: "Your file never left your desk.",
    text: "Zero bytes sent to AWS. That's the local-first philosophy behind Paperboard: bringing software back home to your device where your data stays strictly yours.",
  },
  {
    tagline: "Why send a file across the ocean just to flip a few bytes?",
    text: "It sounds absurd because it is. Paperboard builds local desktop panels and tools that actually tap into your computer's power instead of renting cloud servers.",
  },
  {
    tagline: "That took 200 milliseconds. A cloud site is still uploading.",
    text: "Paperboard brings that exact instant, local-first speed to everything: Discord bots, Minecraft servers, developer scripts, and custom desktop panels.",
  },
  {
    tagline: "Tired of 'Daily limit reached: 2 of 5 free conversions left'?",
    text: "So are we. Paperboard is building an ecosystem of desktop tools that run directly on your hardware with no artificial throttles, no paywalls, just software that works.",
  },
  {
    tagline: "Your computer has 16 cores. Let's actually use them.",
    text: "Cloud apps treat modern laptops like glorified dumb terminals. Paperboard treats your PC like the powerhouse it is, running full-featured panels without remote latency.",
  },
  {
    tagline: "Imagine if all your software was this snappy.",
    text: "No loading spinners, no privacy policies to accept, no remote downtime. Paperboard is a modular desktop app built with PaperUI to run your everyday tools locally.",
  },
  {
    tagline: "Your files are your business.",
    text: "No corporate cloud is scanning your files or training an AI on them. Paperboard is built on local-first principles: your data stays on your disk, always.",
  },
  {
    tagline: "Like this speed? You'll love Paperboard.",
    text: "From launching local Minecraft servers to managing background bots and dev workflows, Paperboard turns your computer into a self-hosted command center.",
  },
  {
    tagline: "Remember when software actually ran on your computer?",
    text: "We do. Paperboard brings back the speed, privacy, and true ownership of local software with modern SolidJS interfaces and zero cloud bloat.",
  },
  {
    tagline: "That feeling when there's no progress bar stuck at 99%.",
    text: "Because local execution doesn't depend on your Wi-Fi upload speed. Paperboard brings that zero-latency reliability to desktop panels and services.",
  },
  {
    tagline: "No login. No 'Verify you are human'. Just done.",
    text: "Paperboard eliminates cloud friction. Run your bots, local game servers, and utilities in one unified, extensible desktop workspace at paperboard.dev.",
  },
  {
    tagline: "Somewhere, an AWS bill didn't increase.",
    text: "Running tools locally isn't just faster, it's greener and cheaper. Paperboard makes it effortless to self-host developer tools and panels right on your PC.",
  },
  {
    tagline: "Cloud converters are fine. Your own CPU is better.",
    text: "Why bounce your data off three remote data centers? Paperboard is all about empowering your machine to run the tools you need without relying on someone else's servers.",
  },
  {
    tagline: "Fast enough to make you wonder why everything isn't local.",
    text: "That exact question is why we built Paperboard. We create modular desktop software and panels that put control back into your hands.",
  },
  {
    tagline: "No ads, no cookies, no 40-page terms of service.",
    text: "When software runs on your device, it doesn't need to track you to make money. Discover Paperboard, the open, local-first desktop panel platform.",
  },
  {
    tagline: "What if your server dashboard was this instant?",
    text: "Paperboard lets you launch, configure, and monitor Minecraft servers, Discord bots, and terminal sessions locally with the same effortless design you see here.",
  },
  {
    tagline: "Built for speed, not for ad impressions.",
    text: "Most web converters stall so you look at banners. Paperboard builds clean, tactile desktop software and panels using our open-source PaperUI design system.",
  },
  {
    tagline: "You just converted that file at the speed of RAM.",
    text: "Zero round-trips to Virginia or Frankfurt. Check out Paperboard to see how local-first architecture is transforming desktop tools and self-hosting.",
  },
  {
    tagline: "Your Wi-Fi could drop right now and this would still work.",
    text: "True local-first software doesn't care about your internet connection. Paperboard brings that offline reliability to your everyday tools, scripts, and panels.",
  },
  {
    tagline: "Self-hosting shouldn't require a DevOps degree.",
    text: "Paperboard gives you a gorgeous desktop interface for running local services, bots, and panels without wrestling with Docker or terminal headaches.",
  },
  {
    tagline: "The cloud is just someone else's computer.",
    text: "Why give them your files when yours is sitting right in front of you? Paperboard is the desktop home for local tools, panels, and self-hosted apps.",
  },
  {
    tagline: "That wasn't magic. That was just your hardware doing its job.",
    text: "Browsers and Web APIs can do incredible things when you stop uploading everything. Paperboard takes that idea and turns it into a complete desktop operating layer.",
  },
  {
    tagline: "Done before you could even reach for your coffee.",
    text: "Instant local execution is addicting. Dive into Paperboard to run desktop panels, terminal tools, and local game servers with the same snappy feel.",
  },
  {
    tagline: "Privacy shouldn't be a paid enterprise add-on.",
    text: "Your photos, documents, and data shouldn't live on third-party servers. Paperboard is designed from the ground up for private, local-first computing.",
  },
  {
    tagline: "One click, zero waiting, zero tracking.",
    text: "This converter is just a tiny taste of what local-first web tech and PaperUI can do. Explore the full Paperboard ecosystem at paperboard.dev.",
  },
];

export function getRandomCopy(): PaperboardCopy {
  const idx = Math.floor(Math.random() * PAPERBOARD_COPIES.length);
  return PAPERBOARD_COPIES[idx];
}
