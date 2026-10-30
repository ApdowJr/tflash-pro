import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();

process.env.APP_URL = "https://tflash.example.test";

const { default: robots } = await import("../app/robots.ts");
const { default: sitemap } = await import("../app/sitemap.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("crawlers may reach the landing page but never chat or API surfaces", () => {
  const result = robots();
  const rule = result.rules.find((entry) => entry.userAgent === "*");
  assert.ok(rule);
  assert.equal(rule.allow.includes("/"), true);
  assert.equal(rule.allow.includes("/login"), true);
  for (const privatePath of ["/s", "/api/", "/auth/", "/eve/", "/.well-known/"]) {
    assert.equal(rule.disallow.includes(privatePath), true, `missing disallow ${privatePath}`);
  }
  assert.equal(result.sitemap, "https://tflash.example.test/sitemap.xml");
});

test("the sitemap lists only public pages and needs the real origin", () => {
  const entries = sitemap();
  assert.deepEqual(entries.map((entry) => entry.url), [
    "https://tflash.example.test/",
    "https://tflash.example.test/login",
  ]);

  const previous = process.env.APP_URL;
  delete process.env.APP_URL;
  try {
    assert.deepEqual(sitemap(), [], "a guessed production domain must never be advertised");
  } finally {
    process.env.APP_URL = previous;
  }
});

test("the root route is public for visitors and unchanged for accounts", () => {
  const page = read("app/page.tsx");
  assert.match(page, /currentPrincipal\(\)/);
  assert.match(page, /<LandingPage \/>/);
  assert.match(page, /<AuthenticatedAgentChat principal=\{principal\} \/>/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
});

test("the create-account link opens the right auth tab", () => {
  const login = read("app/login/page.tsx");
  assert.match(login, /mode === "signup" \? "signup" : "signin"/);
  assert.match(login, /initialMode=\{initialMode\}/);
  assert.match(read("components/app/auth-screen.tsx"), /useState<Mode>\(initialMode\)/);
});

test("the landing page is bilingual, accessible and honest about limits", () => {
  const landing = read("components/marketing/landing-page.tsx");
  for (const copy of [
    "speaks your language.",
    "luqaddaada.",
    "Approval is the default, not a setting.",
    "Fasax waa default-ka, ma aha setting.",
    "No product can promise perfect security.",
    "Ma jiro badeecad dammaanad qaadi karta amni qumman.",
  ]) {
    assert.equal(landing.includes(copy), true, `missing copy: ${copy}`);
  }
  assert.equal(landing.includes('id="main-content"'), true);
  assert.equal(landing.includes("aria-pressed"), true);
  assert.equal(landing.includes("localStorage"), true);
});
