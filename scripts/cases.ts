import assert from "node:assert/strict";
import type { ParseOptions } from "../src/parse";
import type { ParserOutput } from "../src/types";


export interface TestCase {
  id: string;
  name: string;
  description: string;
  pageUrl: string;
  html: string;
  options?: ParseOptions;
  verify(result: ParserOutput): void;
  humanEvaluation: {
    expectedAuthor: string;
    expectedDetails: string;
    expectedTechStack: string;
    keyObservations: string;
  };
}


const flightPayload = [
  '0:{"author":"$1","publishedAt":"2026-10-20T14:30:00Z","articles":["$2"]}',
  '1:{"name":"Elena Rostova","slug":"elena-rostova","bio":"Senior AI & Tech Reporter at The Chronicle.","email":"elena@thechronicle.tech","avatar":"https://thechronicle.tech/avatars/elena.jpg","sameAs":["https://twitter.com/erostova","https://linkedin.com/in/elena-rostova"]}',
  '2:{"title":"How Large Models Plan","url":"https://thechronicle.tech/posts/how-models-plan","publishedAt":"2026-09-15T10:00:00Z"}'
].join("\n") + "\n";

const caseData: Omit<TestCase, "verify">[] = [
  // -------------------------------------------------------------------------
  // Case 1: Next.js App Router (RSC Flight Chunks)
  // -------------------------------------------------------------------------
  {
    id: "case-1",
    name: "Next.js App Router (RSC Flight Chunks)",
    description: "Modern Next.js App Router site streaming RSC flight chunks with author entity, bio, socials, and articles",
    pageUrl: "https://thechronicle.tech/posts/future-of-agentic-ai",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>The Future of Agentic AI</title>
  <meta name="description" content="An in-depth analysis of autonomous AI agents in software engineering.">
</head>
<body>
  <div id="root">
    <main>
      <h1>The Future of Agentic AI</h1>
      <p>Autonomous AI agents are transforming how we build software...</p>
    </main>
  </div>
  <script>self.__next_f=self.__next_f||[]</script>
  <script>self.__next_f.push([1, ${JSON.stringify(flightPayload)}])</script>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Elena Rostova",
      expectedDetails: "Bio: 'Senior AI & Tech Reporter...', Email: elena@thechronicle.tech, Avatar: https://thechronicle.tech/avatars/elena.jpg, Socials: Twitter (@erostova), LinkedIn (elena-rostova), 1 Article referenced",
      expectedTechStack: "Next.js (App Router / Flight)",
      keyObservations: "Metascraper completely misses Elena Rostova because it only checks DOM bylines and standard meta tags, not Flight chunks. Omniscrape decodes Flight chunks and reconstructs references.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 2: Nuxt 3 Devalue Hydration
  // -------------------------------------------------------------------------
  {
    id: "case-2",
    name: "Nuxt 3 SSR Devalue Hydration (__NUXT_DATA__)",
    description: "Nuxt 3 site storing reactive state in __NUXT_DATA__ devalue array with reference pointers and dates",
    pageUrl: "https://vuejournal.io/articles/mastering-ssr-performance",
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Mastering SSR Performance - VueJournal</title>
  <meta name="description" content="Strategies to optimize hydration and server rendering.">
</head>
<body>
  <div id="__nuxt">
    <article>
      <h1>Mastering SSR Performance</h1>
      <p>Server-side rendering brings massive performance benefits...</p>
    </article>
  </div>
  <script id="__NUXT_DATA__" type="application/json">[
    {"data": 1, "state": 2},
    {"article": 3},
    {},
    {"title": 4, "author": 5, "publishedAt": 9},
    "Mastering SSR Performance",
    {"name": 6, "slug": 7, "bio": 8, "socials": 10},
    "Marcus Vance",
    "marcus-vance",
    "Staff Performance Architect and Tech Writer.",
    "2026-08-10T09:00:00Z",
    [11],
    "https://github.com/marcusvance"
  ]</script>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Marcus Vance",
      expectedDetails: "Bio: 'Staff Performance Architect...', GitHub social profile: https://github.com/marcusvance (handle: marcusvance)",
      expectedTechStack: "Nuxt 3",
      keyObservations: "Nuxt 3 devalue serialization uses an indexed array with pointer references. Metascraper cannot parse this. Omniscrape resolves the devalue reference graph.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 3: Complex JSON-LD Graph with Unrelated Entities & Disambiguation
  // -------------------------------------------------------------------------
  {
    id: "case-3",
    name: "Complex JSON-LD Graph with Unrelated Entities",
    description: "JSON-LD graph containing Publisher Organization, Reviewer Person, and Article Author Person",
    pageUrl: "https://globalinvestigator.org/reports/deep-sea-mining",
    html: `<!DOCTYPE html>
<html>
<head>
  <title>The Hidden Costs of Deep Sea Mining</title>
  <meta property="og:title" content="The Hidden Costs of Deep Sea Mining">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://globalinvestigator.org/#publisher",
        "name": "Global Investigator Press",
        "url": "https://globalinvestigator.org"
      },
      {
        "@type": "Person",
        "@id": "https://globalinvestigator.org/#editor-review",
        "name": "Dr. Anthony Reviewer",
        "jobTitle": "Scientific Editor"
      },
      {
        "@type": "NewsArticle",
        "@id": "https://globalinvestigator.org/reports/deep-sea-mining#article",
        "headline": "The Hidden Costs of Deep Sea Mining",
        "url": "https://globalinvestigator.org/reports/deep-sea-mining",
        "datePublished": "2026-05-12T08:00:00Z",
        "publisher": { "@id": "https://globalinvestigator.org/#publisher" },
        "reviewedBy": { "@id": "https://globalinvestigator.org/#editor-review" },
        "author": {
          "@type": "Person",
          "name": "Sophia Chen",
          "url": "https://globalinvestigator.org/staff/sophia-chen",
          "jobTitle": "Environmental Investigations Lead",
          "email": "sophia.chen@globalinvestigator.org",
          "sameAs": [
            "https://twitter.com/sophiachen_env",
            "https://linkedin.com/in/sophiachen-env"
          ]
        }
      }
    ]
  }
  </script>
</head>
<body>
  <h1>The Hidden Costs of Deep Sea Mining</h1>
  <div class="reviewed-notice">Reviewed by: Dr. Anthony Reviewer</div>
  <p>Investigation into the Pacific seabed...</p>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Sophia Chen",
      expectedDetails: "JobTitle: Environmental Investigations Lead, Email: sophia.chen@globalinvestigator.org, Socials: Twitter and LinkedIn, Publisher: Global Investigator Press",
      expectedTechStack: "Unknown (pure static / JSON-LD)",
      keyObservations: "Naive scrapers often grab the first Person encountered in JSON-LD (@graph[1]: Dr. Anthony Reviewer) or mistake the reviewer for the author. Omniscrape scopes extraction strictly to NewsArticle.author.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 4: Co-Authors / Conflicting Byline (Conservative Attribution)
  // -------------------------------------------------------------------------
  {
    id: "case-4",
    name: "Co-Authors with Equal Weight (Conservative Review Queue)",
    description: "Two distinct named co-authors with separate profile URLs; Omniscrape attribution rules require Unknown Author + Review queue",
    pageUrl: "https://sciencereview.org/articles/quantum-entanglement-breakthrough",
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Quantum Entanglement Breakthrough</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    "url": "https://sciencereview.org/articles/quantum-entanglement-breakthrough",
    "headline": "Quantum Entanglement Breakthrough",
    "author": [
      {
        "@type": "Person",
        "name": "David Kim",
        "url": "https://sciencereview.org/authors/david-kim",
        "email": "david.kim@physics.org"
      },
      {
        "@type": "Person",
        "name": "Maria Garcia",
        "url": "https://sciencereview.org/authors/maria-garcia",
        "email": "maria.garcia@quantum.org"
      }
    ]
  }
  </script>
</head>
<body>
  <h1>Quantum Entanglement Breakthrough</h1>
  <div class="byline">By <a href="/authors/david-kim">David Kim</a> and <a href="/authors/maria-garcia">Maria Garcia</a></div>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Unknown Author",
      expectedDetails: "Both David Kim and Maria Garcia placed into review queue with reason: ambiguous_identity, keeping full provenance and respective emails.",
      expectedTechStack: "Unknown",
      keyObservations: "Metascraper creates a single fake author 'David Kim and Maria Garcia'. Omniscrape safely detects co-authorship / ambiguity, assigns 'Unknown Author', and populates `review` so consumer apps can handle multi-authorship cleanly.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 5: Quintype / Bold CMS Story Page
  // -------------------------------------------------------------------------
  {
    id: "case-5",
    name: "Quintype / Bold CMS with Editorial Separation",
    description: "Quintype CMS payload with static-page / qt.data separation of author, owner, assignee, and publisher",
    pageUrl: "https://thequint.example.com/markets/central-bank-rates",
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Central Bank Raises Key Lending Rate</title>
  <script id="static-page" type="application/json">
  {
    "qt": {
      "data": {
        "story": {
          "headline": "Central Bank Raises Key Lending Rate",
          "slug": "markets/central-bank-rates",
          "author-name": "Rahul Sharma",
          "author-id": "rs-4040",
          "owner-name": "Economy & Markets Desk",
          "assignee-name": "Duty Editor",
          "publisher-name": "Quint Media",
          "first-published-at": "2026-04-10T11:00:00Z"
        }
      }
    }
  }
  </script>
</head>
<body>
  <h1>Central Bank Raises Key Lending Rate</h1>
  <div class="byline">By Rahul Sharma</div>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Rahul Sharma",
      expectedDetails: "id: rs-4040 (raw CMS ID). Editorial: ownerName: 'Economy & Markets Desk', assigneeName: 'Duty Editor', publisher: 'Quint Media'.",
      expectedTechStack: "Quintype",
      keyObservations: "Metascraper cannot parse Quintype static-page JSON. Omniscrape extracts author while strictly separating editorial owners/assignees from the byline author.",
    },
  },
  {
    id: "case-6",
    name: "Author Profile Page with Bibliography",
    description: "ProfilePage with mainEntity Person, bio, socials, and published articles list in DOM",
    pageUrl: "https://timesdaily.org/authors/clara-oswald",
    html: `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Person","name":"Clara Oswald","url":"https://timesdaily.org/authors/clara-oswald","description":"Covering European politics and humanitarian affairs since 2018.","sameAs":["https://twitter.com/clara_oswald_td","https://github.com/claraoswald","https://muckrack.com/clara-oswald"]}}</script><div class="author-profile"><h1>Clara Oswald</h1><article><h3><a href="/world/berlin-summit-agreements">Key Outcomes of the Berlin Climate Summit</a></h3></article><article><h3><a href="/world/balkan-diplomacy-update">New Diplomatic Channels Opened in the Balkans</a></h3></article><article><h3><a href="/world/geneva-humanitarian-talks">Behind Closed Doors at Geneva Talks</a></h3></article></div>`,
    humanEvaluation: {
      expectedAuthor: "Clara Oswald",
      expectedDetails: "Bio: 'Covering European politics...', Socials: Twitter (@clara_oswald_td), GitHub (claraoswald), MuckRack (clara-oswald). Articles: 3 articles correctly extracted and resolved to absolute URLs.",
      expectedTechStack: "Unknown",
      keyObservations: "Metascraper cannot extract an author's articles list on profile pages, and erroneously names the author after the first article title. Omniscrape extracts both author and bibliography.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 7: Next.js Pages Router with Large Props & DOM Override
  // -------------------------------------------------------------------------
  {
    id: "case-7",
    name: "Next.js Pages Router (__NEXT_DATA__) with Conflicting DOM Byline",
    description: "Hydration has specific author Zack Morris while DOM has vague 'Staff Reporter'; Hydration should take precedence",
    pageUrl: "https://techpulse.co/articles/edge-computing-trends",
    html: `<!DOCTYPE html>
<html>
<head>
  <title>Edge Computing Trends in 2026 - TechPulse</title>
  <meta name="author" content="Staff Reporter">
</head>
<body>
  <h1>Edge Computing Trends in 2026</h1>
  <div class="byline">By Staff Reporter</div>
  <script id="__NEXT_DATA__" type="application/json">
  {
    "props": {
      "pageProps": {
        "post": {
          "title": "Edge Computing Trends in 2026",
          "author": {
            "name": "Zack Morris",
            "slug": "zack-morris",
            "bio": "Cloud and Edge infrastructure engineer.",
            "avatarUrl": "https://techpulse.co/team/zack.png",
            "socialLinks": {
              "twitter": "https://twitter.com/zack_edge"
            }
          },
          "editorial": {
            "owner": "Cloud Infrastructure Team",
            "editor": "Sarah Jenkins"
          }
        }
      }
    },
    "page": "/articles/[slug]",
    "query": { "slug": "edge-computing-trends" }
  }
  </script>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Zack Morris",
      expectedDetails: "Bio: 'Cloud and Edge infrastructure...', Avatar: https://techpulse.co/team/zack.png, Twitter handle: zack_edge. 'Staff Reporter' in review as different identity.",
      expectedTechStack: "Next.js (Pages Router)",
      keyObservations: "Metascraper falls back to <meta name='author' content='Staff Reporter'> or DOM byline 'Staff Reporter'. Omniscrape extracts the real author Zack Morris from hydration props with high confidence.",
    },
  },

  // -------------------------------------------------------------------------
  // Case 8: Adversarial & Edge Cases (Security, XSS, Base Tag, Corrupted JSON)
  // -------------------------------------------------------------------------
  {
    id: "case-8",
    name: "Adversarial Inputs, XSS, Base Tag & Corrupted Scripts",
    description: "Broken JSON-LD script, javascript: protocol XSS in byline, share button social link, base tag relative resolution",
    pageUrl: "https://securityjournal.org/post/sandbox-escape",
    html: `<!DOCTYPE html>
<html>
<head>
  <base href="https://securityjournal.org/post/">
  <title>Analyzing Kernel Sandbox Escapes</title>
  <!-- Corrupted JSON-LD script that must not crash parser -->
  <script type="application/ld+json">
    { "bad": "json", "unclosed":
  </script>
  <!-- Second valid JSON-LD script with clean unicode name and hostile links -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Analyzing Kernel Sandbox Escapes",
    "author": {
      "@type": "Person",
      "name": "Dr. Viktor Ólafsson",
      "url": "authors/viktor-olafsson",
      "sameAs": [
        "javascript:alert(1)",
        "https://twitter.com/intent/tweet?text=share",
        "https://github.com/viktor-sec"
      ]
    }
  }
  </script>
</head>
<body>
  <h1>Analyzing Kernel Sandbox Escapes</h1>
  <div class="byline">
    By <a href="javascript:stealCookie()">Dr. Viktor Ólafsson</a>
  </div>
</body>
</html>`,
    humanEvaluation: {
      expectedAuthor: "Dr. Viktor Ólafsson",
      expectedDetails: "Corrupted script logged in `issues`. `javascript:` URLs rejected. Twitter share URL rejected (not personal). GitHub accepted: https://github.com/viktor-sec. Relative URL resolved with base URL.",
      expectedTechStack: "Unknown",
      keyObservations: "Metascraper does not validate social profiles or isolate corrupted scripts cleanly. Omniscrape safely ignores bad scripts, rejects dangerous schemes, and normalizes valid metadata.",
    },
  },
];

function extraCase(id: string, name: string, pageUrl: string, html: string, expectedAuthor: string, options?: ParseOptions): Omit<TestCase, "verify"> {
  return {
    id, name, description: name, pageUrl, html, options,
    humanEvaluation: { expectedAuthor, expectedDetails: name, expectedTechStack: "Synthetic fixture", keyObservations: "Deterministic regression contract" },
  };
}

const cmsFlat = (extra: Record<string, unknown> = {}) => ({ story: { "author-name": "Rahul Sharma", "author-id": "rs-4040", "publisher-name": "Quint Media", ...extra } });
const cmsScript = (key: string, data: unknown) => `<script>${key} = ${JSON.stringify(data)};</script>`;
const lineup = { main: [{ type: "lineup", content: Array.from({ length: 17 }, (_, index) => ({ itemType: "story", author: { name: `Card Writer ${index + 1}` } })) }] };
const twentyCards = Array.from({ length: 20 }, (_, index) => `<article class="river-item"><h2><a href="/story-${index + 1}">A sufficiently long synthetic story headline number ${index + 1}</a></h2></article>`).join("");
const threeHundredCards = Array.from({ length: 300 }, (_, index) => `<article class="river-item"><h2><a href="/story-${index + 1}">A sufficiently long synthetic story headline number ${index + 1}</a></h2><div class="byline">By Card Writer ${index + 1}</div></article>`).join("");

caseData.push(
  extraCase("case-9", "Quintype flat story author with raw CMS ID", "https://publisher.example/story", `<script id="static-page">${JSON.stringify({ qt: { data: cmsFlat() } })}</script>`, "Rahul Sharma"),
  extraCase("case-10", "Quintype window.qtData assignment", "https://publisher.example/story", cmsScript("window.qtData", { data: cmsFlat() }), "Rahul Sharma"),
  extraCase("case-11", "Quintype window.qt data-root unwrapping", "https://publisher.example/story", cmsScript("window.qt", { data: cmsFlat({ title: "Not a person", slug: "story-slug" }) }), "Rahul Sharma"),
  extraCase("case-12", "Quintype underscore author alias with zero ID", "https://publisher.example/story", `<script id="static-page">${JSON.stringify({ data: { story: { "author_name": "Avery Reporter", "author_id": 0, id: "story-id", slug: "story-slug", title: "Story title" } } })}</script>`, "Avery Reporter"),
  extraCase("case-13", "Static Fenrir declaration with trailing command setup", "https://publisher.example/story", `<script id="fenrir-client-data">const fenrirClientData = { author: { name: "Static Fenrir Writer", id: "fen-7" } }; window.Fenrir = Object.assign({}, window.Fenrir);</script>`, "Static Fenrir Writer"),
  extraCase("case-14", "Dynamic Fenrir state followed by valid author metadata", "https://publisher.example/story", `<script id="fenrir-client-data">const fenrirClientData = window.payload;</script><meta name="author" content="Later Writer">`, "Later Writer"),
  extraCase("case-15", "Biography wrapper is not a bibliography card", "https://publisher.example/profile/author-one", `<section class="author-wrapper river-item"><div class="author-description"><a href="/award">A long award mention in a biography section</a></div></section><section class="river-item"><h2><a href="/real-story">A sufficiently long genuine story headline</a></h2></section>`, "Unknown Author"),
  extraCase("case-16", "CBC lineup card author isolation", "https://publisher.example/section/world", `<script id="static-page">${JSON.stringify(lineup)}</script>${twentyCards}`, "Unknown Author"),
  extraCase("case-17", "Guardian corroborated profile section", "https://publisher.example/profile/nicola-davis", `<section class="hashed-profile"><h2>Nicola Davis</h2><picture><img alt="Headshot of Nicola Davis" src="/nicola.jpg"></picture><p>Nicola Davis is an environment correspondent covering wildlife and climate.</p></section>`, "Nicola Davis"),
  extraCase("case-18", "NPR archived biography with matching speakable pair", "https://publisher.example/people/2100394/tony-cox", `<header class="contentheader--archived-bio"><h2 class="branding__title">Tony Cox</h2></header><div class="speakable"><b data-is-speakable="true">Tony Cox</b><b data-is-speakable="true">Tony Cox has covered public radio and national affairs for decades.</b></div>`, "Tony Cox"),
  extraCase("case-19", "Encoded markup in metadata description", "https://publisher.example/story", `<meta name="description" content="A &amp;eacute; summary with &lt;a href='/person'&gt;markup&lt;/a&gt;.">`, "Unknown Author"),
  extraCase("case-20", "Encoded structured author matches Unicode byline", "https://publisher.example/story", `<script type="application/ld+json">{"@type":"NewsArticle","url":"https://publisher.example/story","author":{"@type":"Person","name":"Ren&eacute; Writer","url":"/authors/rene","email":"rene@example.org"}}</script><div class="byline"><a href="/authors/rene">René Writer</a></div>`, "René Writer"),
  extraCase("case-21", "Raw newline in direct Flight push literal", "https://publisher.example/story", `<script>self.__next_f.push([1,"0:{\\\"author\\\":\\\"$1\\\"}\n1:{\\\"name\\\":\\\"Recovered Flight Writer\\\"}"])</script>`, "Recovered Flight Writer"),
  extraCase("case-22", "Unclosed Flight literal does not suppress later byline", "https://publisher.example/story", `<script>self.__next_f.push([1,"unclosed</script><meta name="author" content="Independent Writer">`, "Independent Writer"),
  extraCase("case-23", "Cooked static Flight template chunk", "https://publisher.example/story", '<script>self.__next_f.push([1,`0:{"author":"$1"}\\n1:{"name":"Cooked Template Writer"}`])</script>', "Cooked Template Writer"),
  extraCase("case-24", "Publisher homepage metadata without author", "https://publisher.example/", `<title>Publisher Network</title><meta name="description" content="Independent reporting from around the world"><meta property="og:image" content="/logo.png"><script type="application/ld+json">{"@type":"Organization","name":"Publisher Network","logo":"/logo.png"}</script>${twentyCards}`, "Unknown Author"),
  extraCase("case-25", "Explicit institutional newsroom byline", "https://publisher.example/story", `<title>Publisher Network</title><meta name="publisher" content="Publisher Network"><div class="byline">Newsroom</div>`, "Newsroom"),
  extraCase("case-26", "Same-name distinct profile identities stay unresolved", "https://publisher.example/story", `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { author: { name: "Alex Smith", url: "https://publisher.example/authors/alex-one", email: "one@example.org" }, profile: { name: "Alex Smith", url: "https://publisher.example/authors/alex-two", email: "two@example.org" } } } })}</script>`, "Unknown Author"),
  extraCase("case-27", "Current article array of name-only co-authors", "https://publisher.example/story", `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", url: "https://publisher.example/story", author: [{ "@type": "Person", name: "Alice Reporter" }, { "@type": "Person", name: "Bob Writer" }] })}</script>`, "Unknown Author"),
  extraCase("case-28", "Conflicting email fragments for one explicit identity", "https://publisher.example/story", `<script type="application/ld+json">{"@type":"NewsArticle","url":"https://publisher.example/story","author":{"@id":"#alice"}}</script><script type="application/ld+json">{"@id":"#alice","@type":"Person","name":"Alice Reporter","email":"one@example.org"}</script><script type="application/ld+json">{"@id":"#alice","email":"two@example.org"}</script>`, "Alice Reporter"),
  extraCase("case-29", "Oversized early script followed by valid DOM target", "https://publisher.example/story", `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ author: { name: "Oversized Writer" }, padding: "x".repeat(300) })};</script><div class="byline">Later DOM Writer</div>`, "Later DOM Writer", { maxScriptBytes: 100, includeRawHydration: true }),
  extraCase("case-30", "Deep discarded hydration branch preserves shallow person", "https://publisher.example/story", `<script id="static-page">${JSON.stringify({ author: { name: "Shallow Writer", id: "writer-1" }, deep: { a: { b: { c: { name: "Too Deep Writer" } } } } })}</script>`, "Shallow Writer", { maxDecodeDepth: 2 }),
  extraCase("case-31", "Missing cyclic Flight references do not fabricate a contact", "https://publisher.example/story", `<script>self.__next_f.push([1,${JSON.stringify('0:{"author":"$99","cycle":"$1"}\\n1:{"name":"Cycle Writer","email":"fake@example.org","next":"$1"}\\n')}])</script><meta name="author" content="Independent Writer">`, "Independent Writer"),
  extraCase("case-32", "Profile header ignores 300 story-card bylines", "https://publisher.example/profile/nicola-davis", `<section class="author-profile"><h1>Nicola Davis</h1><div class="author-bio">Nicola Davis reports on science, environment, and wildlife.</div></section>${threeHundredCards}`, "Nicola Davis"),
);

export const testCases: TestCase[] = caseData.map((tc) => ({
  ...tc,
  verify: (result) => {
    assert.equal(result.author.name, tc.humanEvaluation.expectedAuthor, `${tc.id} author.name`);
    if (tc.id === "case-4") {
      assert.deepEqual(result.review.map(({ author }) => author.name).sort(), ["David Kim", "Maria Garcia"]);
      assert.deepEqual(result.review.map(({ author }) => author.email).sort(), ["david.kim@physics.org", "maria.garcia@quantum.org"]);
      assert.deepEqual(result.authors.map(({ name, email }) => [name, email]), [
        ["David Kim", "david.kim@physics.org"], ["Maria Garcia", "maria.garcia@quantum.org"],
      ]);
      assert(result.provenance.some(({ field }) => field === "authors[0].name"));
      assert(result.provenance.some(({ field }) => field === "authors[1].email"));
    }
    if (tc.id === "case-5") {
      assert.equal(result.author.id, "rs-4040");
      assert.equal(result.editorial.publisher, "Quint Media");
      assert.equal(result.editorial.ownerName, "Economy & Markets Desk");
      assert.equal(result.editorial.assigneeName, "Duty Editor");
      assert(result.provenance.some(({ field, sourcePath, entity }) => field === "author.id" && sourcePath.endsWith(".author-id") && entity?.includes("thequint.example.com")));
      assert(result.provenance.some(({ field, sourcePath }) => field === "editorial.publisher" && sourcePath.endsWith(".publisher-name")));
    }
    if (tc.id === "case-1") {
      assert.equal(result.author.email, "elena@thechronicle.tech");
      assert.equal(result.author.bio, "Senior AI & Tech Reporter at The Chronicle.");
      assert.deepEqual(result.author.socials.map(({ url }) => url), ["https://twitter.com/erostova", "https://linkedin.com/in/elena-rostova"]);
      assert.deepEqual(result.articles, [{ title: "How Large Models Plan", url: "https://thechronicle.tech/posts/how-models-plan", publishedAt: "2026-09-15T10:00:00.000Z" }]);
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.includes("#flight:")));
      assert.equal(result.issues.length, 0);
    }
    if (tc.id === "case-2") {
      assert.equal(result.author.bio, "Staff Performance Architect and Tech Writer.");
      assert.deepEqual(result.author.socials.map(({ url }) => url), ["https://github.com/marcusvance"]);
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith(".author.name")));
      assert.equal(result.issues.length, 0);
    }
    if (tc.id === "case-3") {
      assert.equal(result.author.email, "sophia.chen@globalinvestigator.org");
      assert.deepEqual(result.articles.map(({ url }) => url), ["https://globalinvestigator.org/reports/deep-sea-mining"]);
      assert.equal(result.editorial.publisher, "Global Investigator Press");
      assert.deepEqual(result.review.map(({ author, reason }) => [author.name, reason]), [["Dr. Anthony Reviewer", "different_identity"]]);
      assert(result.review[0]?.provenance.some(({ sourcePath }) => sourcePath.endsWith("@graph[1].name")));
    }
    if (tc.id === "case-6") {
      assert.deepEqual(result.articles.map(({ url }) => url), [
        "https://timesdaily.org/world/berlin-summit-agreements",
        "https://timesdaily.org/world/balkan-diplomacy-update",
        "https://timesdaily.org/world/geneva-humanitarian-talks",
      ]);
      assert.equal(result.author.bio, "Covering European politics and humanitarian affairs since 2018.");
      assert.deepEqual(result.author.socials.map(({ url }) => url), [
        "https://twitter.com/clara_oswald_td", "https://github.com/claraoswald", "https://muckrack.com/clara-oswald",
      ]);
    }
    if (tc.id === "case-7") {
      assert.equal(result.author.avatarUrl, "https://techpulse.co/team/zack.png");
      assert.deepEqual(result.review.map(({ author, reason }) => [author.name, reason]), [["Staff Reporter", "different_identity"]]);
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.avatarUrl" && sourcePath.endsWith(".avatarUrl")));
    }
    if (tc.id === "case-8") {
      assert(result.issues.some(({ sourcePath, message }) => sourcePath === "script[0]" && message === "Malformed JSON-LD"));
      assert.deepEqual(result.author.socials.map(({ url }) => url), ["https://github.com/viktor-sec"]);
      assert(result.provenance.every(({ value }) => !value.startsWith("javascript:") && !value.includes("intent/tweet")));
    }
    if (tc.id === "case-9") {
      assert.equal(result.author.id, "rs-4040");
      assert.equal(result.editorial.publisher, "Quint Media");
      assert(result.provenance.some(({ field, sourcePath, entity }) => field === "author.name" && sourcePath.endsWith(".story.author-name") && entity?.includes("publisher.example")));
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(".story.author-id")));
    }
    if (tc.id === "case-10" || tc.id === "case-11") {
      assert.equal(result.author.id, "rs-4040");
      assert.equal(result.editorial.publisher, "Quint Media");
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.includes("@window.qt")));
      assert.equal(result.techStack.cms, "Quintype (Bold)");
    }
    if (tc.id === "case-12") {
      assert.equal(result.author.id, 0);
      assert.equal(result.author.slug, undefined);
      assert.equal(result.review.length, 0);
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(".author_id")));
    }
    if (tc.id === "case-13") {
      assert.equal(result.author.id, "fen-7");
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath === "script[0]@fenrirClientData.author.name"));
      assert(result.issues.every(({ message }) => !message.includes("Malformed hydration JSON")));
    }
    if (tc.id === "case-14") assert(result.issues.some(({ message }) => message === "Unsupported static hydration initializer"));
    if (tc.id === "case-15") assert.deepEqual(result.articles.map(({ url }) => url), ["https://publisher.example/real-story"]);
    if (tc.id === "case-16") {
      assert.equal(result.review.length, 0);
      assert.equal(result.articles.length, 20);
      assert.deepEqual(result.articles.slice(0, 2).map(({ url }) => url), ["https://publisher.example/story-1", "https://publisher.example/story-2"]);
    }
    if (tc.id === "case-17") {
      assert.equal(result.author.bio, "Nicola Davis is an environment correspondent covering wildlife and climate.");
      assert.equal(result.author.avatarUrl, "https://publisher.example/nicola.jpg");
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.bio" && sourcePath.endsWith("p:nth-of-type(1)")));
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.avatarUrl" && sourcePath.endsWith("img:nth-of-type(1)")));
    }
    if (tc.id === "case-18") {
      assert.equal(result.author.bio, "Tony Cox has covered public radio and national affairs for decades.");
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith("header:nth-of-type(1) > h2:nth-of-type(1)")));
      assert(result.provenance.some(({ field, sourcePath }) => field === "author.bio" && sourcePath.includes("b:nth-of-type(2)")));
    }
    if (tc.id === "case-19") {
      assert.equal(result.metadata.description, "A é summary with markup .");
      assert.equal(result.author.bio, undefined);
    }
    if (tc.id === "case-20") {
      assert.equal(result.author.email, "rene@example.org");
      assert.equal(result.review.length, 0);
      assert.equal(result.authors.length, 1);
    }
    if (tc.id === "case-21" || tc.id === "case-22") {
      assert.equal(result.issues.filter(({ message }) => message === "Malformed Flight script").length, 1);
      assert.equal(result.author.email, undefined);
    }
    if (tc.id === "case-24") {
      assert.equal(result.metadata.title, "Publisher Network");
      assert.equal(result.metadata.description, "Independent reporting from around the world");
      assert.equal(result.author.bio, undefined);
      assert.equal(result.articles.length, 20);
    }
    if (tc.id === "case-26") {
      assert.deepEqual(result.review.map(({ author }) => author.email).sort(), ["one@example.org", "two@example.org"]);
      assert.equal(result.authors.length, 0);
    }
    if (tc.id === "case-27") {
      assert.deepEqual(result.authors.map(({ name }) => name), ["Alice Reporter", "Bob Writer"]);
      assert(result.review.every(({ reason }) => reason === "ambiguous_identity"));
    }
    if (tc.id === "case-28") {
      assert.equal(result.author.email, undefined);
      assert.deepEqual(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => [author.name, author.email]), [
        ["Alice Reporter", "one@example.org"], ["Alice Reporter", "two@example.org"],
      ]);
    }
    if (tc.id === "case-29") {
      assert(result.issues.some(({ sourcePath, message }) => sourcePath === "script[0]" && message.includes("maxScriptBytes")));
      assert.equal(result.author.name, "Later DOM Writer");
      assert(!String(JSON.stringify(result.rawHydration)).includes("Oversized Writer"));
    }
    if (tc.id === "case-30") {
      assert.equal(result.author.id, "writer-1");
      assert(result.issues.some(({ message }) => message === "Hydration depth limit exceeded"));
      assert(!result.review.some(({ author }) => author.name === "Too Deep Writer"));
    }
    if (tc.id === "case-31") {
      assert.equal(result.author.name, "Independent Writer");
      assert.equal(result.author.email, undefined);
      assert(!result.review.some(({ author }) => author.name === "Cycle Writer"));
    }
    if (tc.id === "case-32") {
      assert.equal(result.author.name, "Nicola Davis");
      assert.equal(result.review.length, 0);
      assert.equal(result.articles.length, 20);
      assert.deepEqual(result.articles.slice(0, 2).map(({ url }) => url), ["https://publisher.example/story-1", "https://publisher.example/story-2"]);
    }
  },
}));
