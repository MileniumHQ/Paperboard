// the page only reaches its service: the test asks it to fix the forecast
import { serviceApi } from "@mileniumhq/paperapi";

(window as unknown as { fix: () => Promise<unknown> }).fix = () => serviceApi.call("dev.paperboard.testproblems", "fix");
