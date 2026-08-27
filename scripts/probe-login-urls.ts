import { Impit } from "impit";

const impit = new Impit({ browser: "chrome", timeout: 20_000, followRedirects: true });
for (const url of [
  "https://www.linkedin.com/uas/login",
  "https://www.linkedin.com/checkpoint/lg/login",
  "https://www.linkedin.com/login",
]) {
  const res = await impit.fetch(url, {
    headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9" },
  });
  const html = await res.text();
  console.log({
    url,
    status: res.status,
    final: res.url,
    len: html.length,
    loginCsrfParam: html.includes("loginCsrfParam"),
    session_key: html.includes("session_key"),
    uas: html.includes("/uas/authenticate"),
    rsc: html.includes("rsc-action"),
    title: html.match(/<title[^>]*>([^<]*)/i)?.[1],
  });
}
