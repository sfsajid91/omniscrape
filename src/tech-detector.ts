import type { PageContext } from "./core/context";
import type { TechStack } from "./types";

export function detectTechStack(context: PageContext): TechStack {
  const { html, scriptsById, meta, links } = context;
  const signals: string[] = [];
  let framework = "Unknown";
  let cms = "Unknown";
  let hydrationFormat: string | undefined;
  const host = new URL(context.pageUrl).hostname.replace(/^www\./, "");
  const onHost = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (scriptsById.has("__NEXT_DATA__")) {
    framework = "Next.js";
    hydrationFormat = "__NEXT_DATA__";
    signals.push("found #__NEXT_DATA__");
  } else if (html.includes("self.__next_f") || html.includes("/_next/static/")) {
    framework = "Next.js";
    hydrationFormat = "self.__next_f (Flight)";
    signals.push("found Next.js App Router markers");
  } else if (scriptsById.has("__NUXT_DATA__")) {
    framework = "Nuxt 3";
    hydrationFormat = "__NUXT_DATA__";
    signals.push("found #__NUXT_DATA__");
  } else if (html.includes("window.__NUXT__") || html.includes("/_nuxt/")) {
    framework = "Nuxt 2";
    hydrationFormat = "window.__NUXT__";
    signals.push("found Nuxt SSR markers");
  } else if (html.includes("<astro-island") || html.includes("data-astro-") || html.includes("/_astro/")) {
    framework = "Astro";
    signals.push("found Astro markers");
  } else if (html.includes("__sveltekit") || html.includes("data-sveltekit-") || html.includes("/_app/immutable/")) {
    framework = "SvelteKit";
    signals.push("found SvelteKit markers");
  }

  const executableScripts = context.scripts.filter(
    (script) => !script.type || ["text/javascript", "application/javascript", "module"].includes(script.type),
  );
  const qtAssignment = executableScripts
    .map((script) => /(?:^|[;{}])\s*((?:window\s*\.\s*)?qt(?:LoadedData|Data)?)\s*=/.exec(script.text)?.[1])
    .find((assignment) => assignment !== undefined);
  const generator = meta.get("generator")?.value.toLowerCase() ?? "";
  if (scriptsById.get("static-page")?.text.includes('"qt"') || qtAssignment) {
    cms = "Quintype (Bold)";
    hydrationFormat = scriptsById.has("static-page") ? "static-page (qt.data)" : qtAssignment?.replace(/\s/g, "");
    signals.push("found Quintype payload");
  } else if (html.includes("Fusion.globalContent")) {
    cms = "Arc XP (Fusion)";
    hydrationFormat = "Fusion.globalContent";
    signals.push("found Fusion.globalContent");
  } else if (scriptsById.has("fenrir-client-data")) {
    cms = "Axel Springer (Fenrir)";
    hydrationFormat = "fenrir-client-data";
    signals.push("found #fenrir-client-data");
  } else if (
    generator.includes("wordpress") ||
    links.some((link) => /wp-json|api\.w\.org/.test(link.rel)) ||
    html.includes("/wp-content/")
  ) {
    cms = html.includes("vip.wordpress.com") || onHost("variety.com") ? "WordPress VIP (PMC)" : "WordPress";
    signals.push("found WordPress generator/API/assets");
  } else if (generator.includes("ghost")) {
    cms = "Ghost";
    signals.push("found Ghost generator");
  } else if (html.includes("cdn.shopify.com") || html.includes("Shopify.theme")) {
    cms = "Shopify";
    signals.push("found Shopify assets");
  } else if (generator.includes("webflow") || html.includes("w-mod-")) {
    cms = "Webflow";
    signals.push("found Webflow markers");
  } else if (html.includes("c-entry-author") || onHost("thecut.com") || onHost("voxmedia.com")) {
    cms = "Vox Media (Chorus)";
    signals.push("found Chorus markers/publisher");
  } else if (onHost("jalopnik.com") || html.includes("https://kinja.com/")) {
    cms = "G/O Media (Kinja)";
    signals.push("found Kinja markers/publisher");
  } else if (onHost("si.com") || html.includes("maven-author")) {
    cms = "The Arena Group (Maven)";
    signals.push("found Maven markers/publisher");
  } else if (framework === "Next.js" || framework === "Nuxt 3") {
    cms = `Custom (${framework})`;
  } else if (html.includes("window.__INITIAL_STATE__") || html.includes("window.__PRELOADED_STATE__")) {
    cms = "Custom SSR";
    hydrationFormat = html.includes("window.__INITIAL_STATE__")
      ? "window.__INITIAL_STATE__"
      : "window.__PRELOADED_STATE__";
    signals.push("found window state payload");
  }

  return { framework, cms, hydrationFormat, signals };
}
