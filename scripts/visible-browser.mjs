import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const chromeEndpoint =
  process.env.CRYCHART_CDP ?? "http://127.0.0.1:9223";
export async function connectVisibleChrome() {
  let available = false;
  try {
    available = (await fetch(`${chromeEndpoint}/json/version`)).ok;
  } catch {}
  if (!available) {
    const executable =
      process.env.CRYCHART_CHROME ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe";
    if (!existsSync(executable))
      throw new Error(
        "Google Chrome is required for visible testing. Set CRYCHART_CHROME to its executable.",
      );
    const profile = resolve(".cache/visible-chrome");
    mkdirSync(profile, { recursive: true });
    const processChrome = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9223",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
        "--new-window",
        "http://127.0.0.1:4178/",
      ],
      { detached: true, stdio: "ignore", windowsHide: false },
    );
    processChrome.unref();
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${chromeEndpoint}/json/version`)).ok) {
          available = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!available)
    throw new Error(
      "Visible Chrome did not expose its loopback debugging endpoint",
    );
  const metadata = await (await fetch(`${chromeEndpoint}/json/version`)).json();
  if (/HeadlessChrome/i.test(metadata["User-Agent"] ?? ""))
    throw new Error(
      "Headless Chrome cannot satisfy the visible-test requirement",
    );
  const browser = await chromium.connectOverCDP(chromeEndpoint),
    context = browser.contexts()[0];
  const page =
    context.pages().find((p) => /^http:\/\/127\.0\.0\.1:/.test(p.url())) ??
    context.pages()[0] ??
    (await context.newPage());
  await page.bringToFront();
  return { browser, page, metadata };
}
export async function showStep(page, title, detail = "", duration = 0) {
  await page.evaluate(
    ({ title, detail }) => {
      let panel = document.getElementById("crychart-visible-test");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "crychart-visible-test";
        panel.style.cssText =
          "position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:14px 20px;background:#0b263bef;border:1px solid #48dab9;border-radius:9px;color:#e8fff8;font:14px/1.6 system-ui;pointer-events:none;box-shadow:0 5px 28px #0005";
        document.body.append(panel);
      }
      panel.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = title;
      const text = document.createElement("div");
      text.textContent = detail;
      panel.append(strong, text);
    },
    { title, detail },
  );
  await page.waitForTimeout(duration);
}
export async function ensureTestServer(port = 4178) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/tests/browser.html`)).ok)
      return { close: async () => {} };
  } catch {}
  process.env.PORT = String(port);
  const { server } = await import("./serve.mjs");
  return { close: async () => new Promise((resolve) => {server.close(resolve);server.closeAllConnections();}) };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve("scripts/visible-browser.mjs")
) {
  const { browser, metadata } = await connectVisibleChrome();
  console.log(
    JSON.stringify({
      visible: true,
      browser: metadata.Browser,
      endpoint: chromeEndpoint,
    }),
  );
  await browser.close();
}
