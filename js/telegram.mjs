import { Bot, InputFile } from "grammy";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(projectRoot, "asset", "trading-alert.html");
const screenshotPath = path.join(projectRoot, "output.png");

async function createScreenshot() {
    const browser = await chromium.launch();

    try {
        const page = await browser.newPage({
            viewport: { width: 1200, height: 675 },
            deviceScaleFactor: 2
        });

        await page.goto(pathToFileURL(htmlPath).href, {
            waitUntil: "networkidle"
        });
        await page.screenshot({ path: screenshotPath, fullPage: false });
    } finally {
        await browser.close();
    }
}

async function main() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID;

    if (!botToken || !channelId) {
        throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID before running this script.");
    }

    await createScreenshot();

    const bot = new Bot(botToken);
    await bot.api.sendPhoto(channelId, new InputFile(screenshotPath), {
        caption: "Target reached"
    });

    console.log(`Screenshot sent to ${channelId}`);
}

main().catch((error) => {
    console.error("Telegram alert failed:", error);
    process.exitCode = 1;
});

