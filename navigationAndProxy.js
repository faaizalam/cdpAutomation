import CDP from "chrome-remote-interface";
import { spawn } from "child_process";
import { proxyChooser } from "./utils/proxyChooser.js";

const deadline = Date.now() + 15000;
const userDataDir = process.cwd() + `\\cdp-${Math.random().toString(16).slice(2)}-profile`;
const CHROMIUM = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const startBrowser = async (i) => {
    const proxy = proxyChooser();
    const PORT = 9222 + i;

    const args = [
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${userDataDir} + ${i}`,
        `--proxy-server=http://${proxy.proxy}:${proxy.port}`,
        "--lang=en-US",
        "--accept-lang=en-US,en",
        "--proxy-bypass-list=<-loopback>",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
    ];
    spawn(CHROMIUM, args, { stdio: "ignore" });


    while (Date.now() < deadline) {
        try {
            await fetch(`http://localhost:${PORT}/json/version`);
            break;
        } catch (_) { }
        await new Promise((r) => setTimeout(r, 500));
    }

    const { webSocketDebuggerUrl } = await (
        await fetch(`http://localhost:${PORT}/json/version`)
    ).json();


    const browser = await CDP({ target: webSocketDebuggerUrl })
    const { targetInfos } = await browser.Target.getTargets();
    const pageTarget = targetInfos.find((t) => t.type === "page");
    console.log("Using existing tab:", pageTarget.targetId);


    const client = await CDP({ target: pageTarget.targetId, port: PORT });

    // Destructure domains — each becomes a clean object with methods
    const { Emulation, Network, Page, Fetch } = client;
    console.log("Connected to tab\n");

    // Fetch domain intercepts proxy auth challenges before Chrome shows its dialog
    await Fetch.enable({ handleAuthRequests: true });

    client.on("Fetch.authRequired", async ({ requestId, authChallenge }) => {
        const response = authChallenge.source === "Proxy"
            ? { response: "ProvideCredentials", username: proxy.userName, password: proxy.password }
            : { response: "CancelAuth" };
        await Fetch.continueWithAuth({ requestId, authChallengeResponse: response }).catch(() => {});
    });

    // Continue any requests paused by Fetch.enable
    
    client.on("Fetch.requestPaused", async ({ requestId }) => {
        await Fetch.continueRequest({ requestId }).catch(() => {});
    });

    await Network.enable();
    await Page.enable();
    await Page.navigate({ url:"" });
    await new Promise((resolve) => {
        client.once("Page.loadEventFired", resolve);
        setTimeout(resolve, 5000);
    });
    await new Promise((r) => setTimeout(r, 3000)); // let WebUI fully init

    
}

(async () => {
    const browsers = [];

    for (let i = 0; i < 2; i++) {
        browsers.push(startBrowser(i));
    }

    await Promise.all(browsers);
})();