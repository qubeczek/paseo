// Turns on the daemon-wide plugin switch (`pluginsEnabled`) without a daemon restart.
// The CLI has no command for it; the app does the same through patchDaemonConfig.
// Needs a built CLI (packages/cli/dist). Run: node fork-plugins/enable-plugins.mjs
import { connectToDaemon } from "../packages/cli/dist/utils/client.js";
import { selectDaemonTarget } from "../packages/cli/dist/utils/daemon-target.js";

const client = await connectToDaemon({ target: selectDaemonTarget({}), timeout: 15000 });
const result = await client.patchDaemonConfig({ pluginsEnabled: true });
console.log(`pluginsEnabled = ${result.config?.pluginsEnabled}`);
await client.close?.();
process.exit(result.config?.pluginsEnabled === true ? 0 : 1);
