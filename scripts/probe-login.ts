import { mkdir, writeFile } from "node:fs/promises";
import { Impit } from "impit";

const impit = new Impit({ browser: "chrome", timeout: 20_000, followRedirects: true });
const res = await impit.fetch("https://www.linkedin.com/login", {
  headers: {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  },
});
const html = await res.text();
await mkdir("data", { recursive: true });
await writeFile("data/last-login.html", html);
console.log({
  status: res.status,
  url: res.url,
  len: html.length,
  hasParam: html.includes("loginCsrfParam"),
  idx: html.indexOf("loginCsrfParam"),
});
