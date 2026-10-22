import * as http from "node:http";
import { startPaperCraneServer } from "../../papercrane/index";

const daemon = await startPaperCraneServer({ host: "127.0.0.1", port: 0, noAuth: true, headless: true, advertise: false });
try {
    const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port: daemon.port, path: "/shutdown", method: "POST", headers: {
            Host: `rebound.example:${daemon.port}`, Origin: "http://rebound.example", Authorization: "Bearer arbitrary", "x-papercrane-shutdown": "1",
        } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
        req.on("error", reject);
        req.end();
    });
    console.log(`shutdown-status=${status}`);
} finally {
    daemon.stop();
}
