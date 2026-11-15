// Bot Creator's service whose save of a bot switched on is still on its way
// when the daemon stops the service: the save waits for SIGTERM, then goes
// on. Every other save, and everything else the service does, is the real
// thing.
import { config } from "@mileniumhq/paperapi";

const set = config.set;
const stopping = new Promise<void>((resolve) => {
    process.once("SIGTERM", () => {
        resolve();
        // a service with no stop handler of its own dies of the signal, as it would without this stand-in
        if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
    });
});
config.set = async (data, id, ...rest) => {
    if ((data as { bots?: { enabled: boolean }[] })?.bots?.some((bot) => bot.enabled)) {
        process.send?.({ type: "test:saving" });
        await stopping;
    }
    return set(data, id, ...rest);
};

await import("../../src/service");
