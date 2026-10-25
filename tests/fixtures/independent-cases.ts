import { stringify } from "devalue";

const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const nextData = (value: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(value)}</script>`;

export const independentCases = {
  linkedJsonLd: {
    pageUrl: "https://news.example/politics/city-budget",
    html: `<!doctype html><html lang="en"><head>
      <meta property="og:title" content="City budget passes after long debate">
      <meta property="og:description" content="Council approved the budget late Tuesday.">
      <meta property="og:image" content="/images/budget.jpg">
      <meta property="article:published_time" content="2025-03-04T10:30:00.000Z">
      <meta property="article:modified_time" content="2025-03-05T08:00:00.000Z">
      <link rel="canonical" href="https://news.example/politics/city-budget/">
      ${jsonLd({
      "@context": "https://schema.org", "@graph": [
        { "@type": "NewsArticle", "@id": "https://news.example/politics/city-budget#article", url: "https://news.example/politics/city-budget", headline: "City budget passes after long debate", datePublished: "2025-03-04T10:30:00.000Z", dateModified: "2025-03-05T08:00:00.000Z", author: { "@id": "#jane", "@type": "Person" }, publisher: { "@type": "NewsMediaOrganization", name: "Example News" } },
        { "@id": "#jane", "@type": "Person", name: "Jane Doe", givenName: "Jane", familyName: "Doe", url: "https://news.example/authors/jane-doe", jobTitle: "City Hall reporter", description: "Jane Doe covers city government and public finance.", image: { "@type": "ImageObject", contentUrl: "/images/jane.jpg" }, email: "mailto:Jane.Doe@News.Example", sameAs: ["https://www.linkedin.com/in/janedoe/?share=1", "https://twitter.com/janedoe"] },
      ]
    })}
      </head><body><main><article><h1>City budget passes after long debate</h1><p>Story body.</p></article></main></body></html>`,
  },
  profilePage: {
    pageUrl: "https://mag.example/people/sofia-marino",
    html: jsonLd({ "@context": "https://schema.org", "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Sofia Marino", url: "https://mag.example/people/sofia-marino", email: "sofia@mag.example", description: "Sofia Marino writes about architecture and urban design.", jobTitle: "Design critic", sameAs: ["https://www.instagram.com/sofiamarino"] } }),
  },
  nextPagesProfile: {
    pageUrl: "https://example.com/authors/morgan-lee",
    html: nextData({
      props: {
        pageProps: {
          author: { id: 501, name: "Morgan Lee", slug: "morgan-lee", role: "Investigative Reporter", bio: "Morgan Lee investigates housing and labor policy across the region.", image: { contentUrl: "/people/morgan.jpg" }, email: "morgan@example.com", twitter: "https://x.com/morganlee" },
          articles: [{ title: "Housing audit finds gaps", slug: "/investigations/housing-audit", date: "2025-01-15" }, { title: "Short", slug: "/x" }, { title: "Labor board complaint", url: "https://example.com/labor-complaint", publishedAt: "2025-02-20T09:00:00Z" }],
          currentUser: { name: "Signed In Reader", email: "reader@example.com" },
        }
      }
    }),
  },
  nuxt3Profile: {
    pageUrl: "https://example.org/authors/priya-nair",
    html: `<script id="__NUXT_DATA__" type="application/json">${stringify({ data: { author: { id: 88, name: "Priya Nair", slug: "priya-nair", jobTitle: "Climate correspondent", description: "Priya Nair reports on climate adaptation and energy policy.", image: { url: "/img/priya.png" }, socialLinks: { linkedin: "https://www.linkedin.com/in/priyanair", email: "priya@example.org" } }, articles: [{ title: "Coastal cities adapt to heat", slug: "/climate/coastal-cities", publishedAt: "2025-04-01" }, { title: "Grid upgrades accelerate", url: "/energy/grid-upgrades", date: "2025-04-02T12:00:00Z" }] } })}</script>`,
  },
  quintypeCollection: {
    pageUrl: "https://example.com/author/ada-writer",
    html: `<script id="static-page" type="application/json">${JSON.stringify({
      qt: {
        data: {
          author: { id: 12, name: "Ada Writer", bio: "Ada Writer reports on state politics and elections.", "avatar-url": { url: "/ada.jpg" } }, authorCollection: {
            items: [
              { story: { headline: "Budget fight heads to court", slug: "news/budget-fight", "first-published-at": "2024-05-01T00:00:00Z", "owner-name": "Desk One", "owner-id": 77 } },
              { story: { headline: "Election recount expands", url: "https://example.com/news/recount" } }, { story: { headline: "No route here" } },
            ]
          }
        }
      }
    })}</script>`,
  },
  fusionAssignment: {
    pageUrl: "https://example.net/author/ravi-shah",
    html: `<script>Fusion.globalContent = ${JSON.stringify({ author: { id: "r-9", name: "Ravi Shah", role: "Data reporter", bio: "Ravi Shah builds data-driven stories about transit.", twitter: "https://x.com/ravi", image: { url: "/ravi.jpg" } }, articles: [{ title: "Transit ridership climbs again", url: "/transit/ridership" }] })};</script>`,
  },
  domBylineAndMetadata: {
    pageUrl: "https://news.example/transit/plan",
    html: `<html><head><meta property="og:title" content="Council approves transit plan"><meta property="og:description" content="The plan adds bus lanes and late-night service."><meta property="article:published_time" content="2025-06-10T07:15:00.000Z"><link rel="canonical" href="https://news.example/transit/plan"><meta name="author" content="By Dana Kim"></head><body><main><article><h1>Council approves transit plan</h1><div class="byline"><a rel="author" href="/authors/dana-kim">Dana Kim</a><a href="mailto:dana@example.net">Email Dana</a><a href="https://www.linkedin.com/in/danakim">LinkedIn</a><span class="author-title">Senior reporter</span></div><p>The council voted 7-2 on Tuesday.</p></article><section><h2><a href="/transit/fare-changes">Fare changes begin next month</a></h2></section><section><h2><a href="/transit/night-buses">Night bus service expands downtown</a></h2></section><nav><h2><a href="/sections/transit">All transit coverage headlines</a></h2></nav><footer><h2><a href="/legal/privacy-policy">Privacy policy and your data choices</a></h2></footer></main></body></html>`,
  },
  domProfile: {
    pageUrl: "https://news.example/authors/carla-writer",
    html: `<html><body><header class="author-header"><img class="author-avatar" src="/carla.jpg" alt="Carla"><h1><span class="author__title-desc">Author</span> Carla Writer</h1><p class="author-bio">Carla Writer covers policy and has reported on state government for more than a decade.</p><div class="author-title">Policy Editor</div><a href="https://x.com/carlawriter">X</a><a href="mailto:carla@example.com">Email</a></header><main><article><h2><a href="/policy/story-one">A long enough policy story headline</a></h2><time datetime="2025-01-01">Jan 1</time></article><article><h2><a href="/policy/story-two">Another sufficiently descriptive headline</a></h2></article></main></body></html>`,
  },
  multipleArticleAuthors: {
    pageUrl: "https://example.com/investigations/procurement",
    html: jsonLd({ "@type": "NewsArticle", headline: "A joint investigation into procurement", url: "https://example.com/investigations/procurement", author: [{ "@type": "Person", name: "Alice Reporter", url: "/authors/alice" }, { "@type": "Person", name: "Bob Editor", url: "/authors/bob" }], datePublished: "2025-02-02T00:00:00Z" }),
  },
  conflictingEmail: {
    pageUrl: "https://example.com/authors/alice",
    html: `${nextData({ props: { pageProps: { author: { id: 7, name: "Alice Reporter", url: "https://example.com/authors/alice", email: "one@example.org" } } } })}${jsonLd({ "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Alice Reporter", url: "https://example.com/authors/alice", email: "two@example.org" } })}`,
  },
  malformedSources: {
    pageUrl: "https://example.com/",
    html: `<script type="application/ld+json">{bad json</script><script id="__NUXT_DATA__">{also bad</script><script>window.__INITIAL_STATE__ = {author:{name:"Later Writer", id:"w-1"}};</script><meta name="author" content="Meta Writer"><article><h2><a href="/story/good">A valid story headline for extraction</a></h2></article>`,
  },
  resourceLimits: {
    pageUrl: "https://example.com/authors/x",
    options: { maxScriptBytes: 100 },
    html: `${nextData({ props: { pageProps: { author: { name: "Ignored Writer", bio: "x".repeat(500) } } } })}<meta name="author" content="Meta Writer">`,
  },
  urlArticleAuthor: {
    pageUrl: "https://example.com/markets",
    html: `<meta property="article:author" content="https://facebook.com/alice"><meta name="description" content="A story summary"><h1>Markets fall after rate decision</h1><p>By <a href="https://www.linkedin.com/in/alice-reporter">Alice Reporter</a></p>`,
  },
  rawHydration: {
    pageUrl: "https://example.com/authors/raw",
    html: `<script>window.__INITIAL_STATE__ = ${JSON.stringify({ author: { name: "Raw Writer", id: 1 }, meta: { note: "x".repeat(20) } })};</script>`,
  },
  emptyDocument: { pageUrl: "https://example.com/empty", html: "" },
} as const;
