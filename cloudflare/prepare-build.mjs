import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Docker contexts exclude Git history; embed the reviewed upstream revision.
const path = "lib/riichi_advanced/constants.ex";
let source = readFileSync(path, "utf8");
const versionExpression = /\(System\.cmd\("git", \["rev-parse", "--short", "HEAD"\]\)\s*\|>\s*elem\(0\)\s*\|>\s*String\.trim\(\)\)/;
if (!versionExpression.test(source)) {
  throw new Error("Upstream version generation changed. Review cloudflare/prepare-build.mjs before building.");
}
source = source.replace(versionExpression, '"cf-47562f8"');
writeFileSync(path, source);
mkdirSync("priv/static/logs", { recursive: true });
mkdirSync("log", { recursive: true });

const endpointPath = "lib/riichi_advanced_web/endpoint.ex";
const endpoint = readFileSync(endpointPath, "utf8");
const marker = "  plug Plug.RequestId";
if (!endpoint.includes(marker)) throw new Error("The upstream endpoint layout changed; review the proxy integration.");
writeFileSync(endpointPath, endpoint.replace(marker, "  plug RiichiAdvancedWeb.CloudflareProxy\n" + marker));
writeFileSync("lib/riichi_advanced_web/cloudflare_proxy.ex", readFileSync("cloudflare/trusted_proxy.ex", "utf8"));
