import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const effects = readFileSync(resolve(root, "visual-effects.js"), "utf8");
const notice = readFileSync(resolve(root, "THIRD_PARTY_NOTICES.md"), "utf8");
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const requiredIds = ["main", "experience", "visual-lab", "gallery", "open-source", "download", "support", "faq"];
for (const id of requiredIds) expect(new RegExp(`id=["']${id}["']`).test(html), `missing #${id}`);

const expectedEffects = ["galaxy", "aurora", "embers", "ice", "color-bends", "dot-field"];
const actualEffects = [...html.matchAll(/\sdata-effect="([^"]+)"/g)].map((match) => match[1]);
expect(JSON.stringify(actualEffects) === JSON.stringify(expectedEffects), `effect controls mismatch: ${actualEffects.join(", ")}`);
for (const key of expectedEffects) expect(new RegExp(`(?:^|\\n)\\s*${key.replace("-", "\\-")}:`).test(effects) || effects.includes(`"${key}":`), `missing effect factory: ${key}`);

const supportSection = html.match(/<section class="section support"[\s\S]*?<\/section>/)?.[0] || "";
expect(/assets\/sponsor\/alipay\.jpg/.test(supportSection), "支付宝二维码未直接出现在支持作者区域");
expect(/assets\/sponsor\/wechat\.png/.test(supportSection), "微信二维码未直接出现在支持作者区域");
expect(!/<iframe\b/i.test(html), "remote/local iframe is not allowed");
expect(!/(?:src|href)="https?:\/\/[^\"]+\.(?:js|css)(?:[?\"])/i.test(html), "remote runtime script or stylesheet detected");
expect(/import\("\.\/visual-effects\.js\?v=1144-visual-lab"\)/.test(app), "visual module is not dynamically imported");
expect(!html.slice(0, html.indexOf("</head>")).includes("visual-effects.js"), "visual module must not block the first screen");

const localPaths = new Set();
for (const match of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
  const value = match[1];
  if (/^(?:https?:|#|data:|mailto:|tel:)/.test(value)) continue;
  localPaths.add(value.split(/[?#]/)[0]);
}
for (const match of html.matchAll(/\ssrcset="([^"]+)"/g)) {
  for (const candidate of match[1].split(",")) localPaths.add(candidate.trim().split(/\s+/)[0].split(/[?#]/)[0]);
}
for (const relativePath of localPaths) expect(existsSync(resolve(root, relativePath)), `missing local asset: ${relativePath}`);

expect(html.includes("LumiField-1.1.44-Setup.exe"), "published installer filename changed");
expect(html.includes("8D68E554742F21A01B130CA76480E1F12070D45C1EEC71F794D9AFAFA00B63CA"), "published installer hash changed");
expect(html.includes("72143cbc4f4b"), "published release commit changed");
expect(html.includes("releases/download/v1.1.44/LumiField-1.1.44-Setup.exe"), "published installer URL changed");

const upstreamCommit = "4e0e030193b563be6be33d928f77d0d01cefe237";
expect(notice.includes(upstreamCommit), "React Bits pinned commit missing from notice");
for (const component of ["Galaxy", "Aurora", "Particles", "Iridescence", "ColorBends", "DotField"]) {
  expect(notice.includes(component), `React Bits notice missing ${component}`);
}
expect(notice.includes("MIT + Commons Clause License Condition v1.0"), "React Bits license label missing or inaccurate");

if (failures.length) {
  console.error(`LumiField website validation failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${requiredIds.length} sections, ${expectedEffects.length} lazy effects, ${localPaths.size} local assets, published v1.1.44 release facts, and React Bits provenance.`);
}
