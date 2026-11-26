import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const storyUrl = "https://publisher.example/stories/main-story";

describe("Issue #15 hydration & Flight hardening", () => {
  describe("React Flight decoding", () => {
    test("parses T<hexLen>, text chunks by UTF-8 byte length and blocks fake record spoofing", () => {
      const bioText = "Alice Flight is a veteran technology reporter.";
      const bioHex = Buffer.byteLength(bioText, "utf8").toString(16);
      const spoofPayload = 'Hello\n3:{"author":{"name":"Injected Fake"}}\n';
      const spoofHex = Buffer.byteLength(spoofPayload, "utf8").toString(16);
      const utf8Note = "José Éclair — reporter";
      const utf8Hex = Buffer.byteLength(utf8Note, "utf8").toString(16);

      const stream =
        `0:{"author":"$1","note":"$4"}\n` +
        `1:{"name":"Alice Flight","bio":"$2"}\n` +
        `2:T${bioHex},${bioText}\n` +
        `5:T${spoofHex},${spoofPayload}` +
        `4:T${utf8Hex},${utf8Note}\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Alice Flight");
      expect(result.author.bio).toBe(bioText);
      expect(result.authors.map(({ name }) => name)).toEqual(["Alice Flight"]);
      expect(result.review.some(({ author }) => author.name === "Injected Fake")).toBe(false);
    });

    test("resolves case-insensitive hex record IDs across $, $L, and $@ references", () => {
      const stream =
        `0:{"author":"$a","articles":["$LB"]}\n` +
        `A:{"name":"Hex Case Writer","bio":"$@c"}\n` +
        `b:{"title":"Hex Story","url":"https://publisher.example/hex-story"}\n` +
        `C:T10,Bio from upper C\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Hex Case Writer");
      expect(result.author.bio).toBe("Bio from upper C");
      expect(result.articles).toEqual([{ title: "Hex Story", url: "https://publisher.example/hex-story" }]);
    });

    test("unwraps Flight $D serialized ISO date strings", () => {
      const stream =
        `0:{"author":"$1","articles":["$2"]}\n` +
        `1:{"name":"Date Writer"}\n` +
        `2:{"title":"Dated Story","url":"https://publisher.example/dated","publishedAt":"$D2026-05-10T14:30:00.000Z"}\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Date Writer");
      expect(result.articles).toEqual([
        {
          title: "Dated Story",
          url: "https://publisher.example/dated",
          publishedAt: "2026-05-10T14:30:00.000Z",
        },
      ]);
    });

    test("does not split unclosed JSON Flight records on hex-colon prose like 10:30 AM", () => {
      const stream = '0:{"author":"$1"}\n' + '1:{"name":"Clock Writer","bio":"Updated at\n10:30 AM on Tuesday."}\n';

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Clock Writer");
      expect(result.author.bio).toBe("Updated at 10:30 AM on Tuesday.");
    });

    test("recovers multiple raw-newline Flight pushes in a single script", () => {
      const html =
        `<script>` +
        `self.__next_f.push([1,"0:{\\"author\\":\\"$1\\"}\n"]);` +
        `self.__next_f.push([1,"1:{\\"name\\":\\"Multi Push Writer\\",\\"bio\\":\\"Line one\nLine two\\"}\n"])\n` +
        `self.__next_f.push([1,"2:{\\"unused\\":\\"ok\nok\\"}\n"])` +
        `</script>`;

      const result = parseHtml({ html, pageUrl: storyUrl });
      expect(result.author.name).toBe("Multi Push Writer");
      expect(result.author.bio).toBe("Line one Line two");
      expect(result.issues.filter(({ message }) => message === "Malformed Flight script")).toHaveLength(1);
    });

    test("tracks script source paths monotonically across many Flight scripts", () => {
      const scripts = [
        `<script>self.__next_f.push([1,${JSON.stringify('0:{"author":"$2"}\n')}])</script>`,
        `<script>self.__next_f.push([1,${JSON.stringify('1:{"ignored":true}\n')}])</script>`,
        `<script>self.__next_f.push([1,${JSON.stringify('2:{"name":"Third Script Writer"}\n')}])</script>`,
      ].join("");

      const result = parseHtml({ html: scripts, pageUrl: storyUrl });
      expect(result.author.name).toBe("Third Script Writer");
      expect(
        result.provenance.some(
          ({ field, sourcePath }) => field === "author.name" && sourcePath === "script[2]#flight:2.name",
        ),
      ).toBe(true);
    });
  });

  describe("static evaluator and assignment recognition", () => {
    test("supports NaN, Infinity, static TemplateLiteral, and new Date(...) in static initializers", () => {
      const html = `<script>
        window.__NUXT__ = {
          author: { name: \`Static Template Author\`, score: NaN, rank: Infinity },
          articles: [
            { title: "ISO Date Story", url: "/iso-date", publishedAt: new Date("2025-07-01T12:00:00Z") },
            { title: "Epoch Date Story", url: "/epoch-date", publishedAt: new Date(1751371200000) }
          ]
        };
      </script>`;

      const result = parseHtml({ html, pageUrl: storyUrl });
      expect(result.author.name).toBe("Static Template Author");
      expect(result.articles).toEqual([
        {
          title: "ISO Date Story",
          url: "https://publisher.example/iso-date",
          publishedAt: "2025-07-01T12:00:00.000Z",
        },
        {
          title: "Epoch Date Story",
          url: "https://publisher.example/epoch-date",
          publishedAt: "2025-07-01T12:00:00.000Z",
        },
      ]);
    });

    test("recognizes window.Fusion.globalContent, globalThis/self globals, and var/let/const declarations", () => {
      const fusion = parseHtml({
        html: `<script>window.Fusion.globalContent = { author: { name: "Window Fusion Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(fusion.author.name).toBe("Window Fusion Writer");

      const globalThisState = parseHtml({
        html: `<script>globalThis.__INITIAL_STATE__ = { author: { name: "GlobalThis Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(globalThisState.author.name).toBe("GlobalThis Writer");

      const selfNuxt = parseHtml({
        html: `<script>self.__NUXT__ = { author: { name: "Self Nuxt Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(selfNuxt.author.name).toBe("Self Nuxt Writer");

      const constState = parseHtml({
        html: `<script>const __INITIAL_STATE__ = { author: { name: "Const State Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(constState.author.name).toBe("Const State Writer");

      const letPreloaded = parseHtml({
        html: `<script>let __PRELOADED_STATE__ = { author: { name: "Let Preloaded Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(letPreloaded.author.name).toBe("Let Preloaded Writer");

      const varQt = parseHtml({
        html: `<script>var qtData = { data: { story: { "author-name": "Var Quintype Writer", "author-id": "qt-9" } } };</script>`,
        pageUrl: storyUrl,
      });
      expect(varQt.author).toMatchObject({ name: "Var Quintype Writer", id: "qt-9" });
    });

    test("shares a single maxDecodeNodes budget across static evaluation and hydration traversal", () => {
      const padding = Array.from({ length: 20 }, (_, i) => `"k${i}": ${i}`).join(", ");
      const html =
        `<script>window.__INITIAL_STATE__ = { ${padding} };</script>` +
        `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { name: "Second Source Writer" } } },
        })}</script>`;

      const result = parseHtml({ html, pageUrl: storyUrl, maxDecodeNodes: 10 });
      expect(result.author.name).toBe("Unknown Author");
      expect(result.issues.some(({ message }) => message === "Hydration traversal limit exceeded")).toBe(true);
    });
  });

  describe("hydration attribution isolation and normalization", () => {
    test("propagates nonAuthorKeys into blocked so nested editor/owner profiles cannot leak", () => {
      const payload = {
        props: {
          pageProps: {
            story: {
              "owner-name": "News Desk",
              editor: {
                profile: { name: "Jane Editor", bio: "Managing editor" },
              },
              owner: {
                profile: { name: "Desk Owner" },
              },
              author: { name: "Real Byline Writer", id: "w-1" },
            },
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Real Byline Writer");
      expect(result.editorial.ownerName).toBe("News Desk");
      expect(result.review.some(({ author }) => ["Jane Editor", "Desk Owner"].includes(author.name))).toBe(false);
    });

    test("rejects Organizations and explicit non-person types via type and __typename", () => {
      const payload = {
        props: {
          pageProps: {
            author: { __typename: "NewsMediaOrganization", name: "Acme News Corp" },
            contributor: { type: "Publisher", name: "Daily Press" },
            profile: { "@type": "Person", type: "publisher", name: "Pat Person" },
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Pat Person");
      expect(result.review.some(({ author }) => ["Acme News Corp", "Daily Press"].includes(author.name))).toBe(false);
    });

    test("recognizes post, entry, and blogPost as story containers for co-author groups", () => {
      for (const containerKey of ["post", "entry", "blogPost"] as const) {
        const payload = {
          props: {
            pageProps: {
              [containerKey]: {
                authors: [
                  { name: "Alice Coauthor", url: "https://publisher.example/authors/alice" },
                  { name: "Bob Coauthor", url: "https://publisher.example/authors/bob" },
                ],
              },
            },
          },
        };
        const result = parseHtml({
          html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
          pageUrl: storyUrl,
        });
        expect(result.authors.map(({ name }) => name)).toEqual(["Alice Coauthor", "Bob Coauthor"]);
      }
    });

    test("synthesizes author name from givenName/familyName or firstName/lastName", () => {
      const givenFamily = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { givenName: "Ada", familyName: "Lovelace", id: "ada-1" } } },
        })}</script>`,
        pageUrl: storyUrl,
      });
      expect(givenFamily.author).toMatchObject({ name: "Ada Lovelace", id: "ada-1" });

      const firstLast = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { firstName: "Grace", lastName: "Hopper", id: "grace-1" } } },
        })}</script>`,
        pageUrl: storyUrl,
      });
      expect(firstLast.author).toMatchObject({ name: "Grace Hopper", id: "grace-1" });
    });

    test("resolves cyclic Nuxt 3 root objects without infinite recursion", () => {
      const cyclicNuxt = JSON.stringify([{ author: 0, name: 1 }, "Alice Cycle"]);
      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${cyclicNuxt}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Alice Cycle");
    });

    test("filters author profile URLs and current page URL out of hydration articles", () => {
      const payload = {
        props: {
          pageProps: {
            author: { name: "List Writer" },
            articles: [
              { title: "Self link with hash", url: `${storyUrl}/#comments` },
              { title: "Author profile link", url: "https://publisher.example/authors/bob-smith" },
              { title: "Genuine related article", url: "https://publisher.example/stories/other-story" },
            ],
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.articles).toEqual([
        { title: "Genuine related article", url: "https://publisher.example/stories/other-story" },
      ]);
    });

    test("preserves non-cyclic shared DAG references in rawHydration while marking true cycles and depth bounds", () => {
      const serialized = JSON.stringify([
        { primary: 1, duplicate: 1, cyclic: 2 },
        { name: 3 },
        { self: 2 },
        "Shared DAG Author",
      ]);

      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${serialized}</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
      });

      const rawValue = (result.rawHydration as Array<{ value: Record<string, unknown> }>)[0]!.value;
      expect(rawValue.primary).toEqual({ name: "Shared DAG Author" });
      expect(rawValue.duplicate).toEqual({ name: "Shared DAG Author" });
      expect(rawValue.cyclic).toEqual({ self: "[Circular]" });

      const deepTruncated = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { a: { b: { c: { d: { e: "deep" } } } } } },
        })}</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
        maxDecodeDepth: 3,
      });
      expect(JSON.stringify(deepTruncated.rawHydration)).toContain("[Truncated]");
    });
  });

  describe("Quintype collection correlation", () => {
    test("uses actual collection property name in provenance paths and ignores empty-string IDs", () => {
      const collectionResult = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              author: { id: 101, name: "Collection Author" },
              collection: {
                items: [
                  {
                    story: {
                      id: "s-1",
                      title: "Story One",
                      slug: "story-one",
                      authors: [{ id: 101, name: "Collection Author", email: "col@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/authors/collection-author",
      });

      expect(collectionResult.author.email).toBe("col@example.org");
      expect(
        collectionResult.provenance.some(
          ({ field, sourcePath }) =>
            field === "author.email" && sourcePath.includes(".collection.items[0].story.authors[0].email"),
        ),
      ).toBe(true);
      expect(collectionResult.provenance.some(({ sourcePath }) => sourcePath.includes(".authorCollection."))).toBe(
        false,
      );

      const emptyIdResult = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              author: { id: "", name: "Empty ID Author" },
              authorCollection: {
                items: [
                  {
                    story: {
                      id: "s-2",
                      title: "Story Two",
                      slug: "story-two",
                      "owner-id": "   ",
                      authors: [{ id: "", name: "Someone Else", email: "wrong@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/authors/empty-id-author",
      });

      expect(emptyIdResult.author.name).toBe("Empty ID Author");
      expect(emptyIdResult.author.email).toBeUndefined();
      expect(emptyIdResult.editorial.ownerEmail).toBeUndefined();
    });

    test("isolates Quintype linked-story and sidebar collection editorial fields from main story and section pages", () => {
      const storyWithSidebar = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              story: {
                id: "main-story",
                title: "Main Story",
                slug: "main-story",
                "author-name": "Main Reporter",
                "author-id": "rep-1",
                "owner-id": 10,
                "owner-name": "Main Owner",
                "publisher-name": "Main Daily",
                cards: [
                  {
                    "story-elements": [
                      {
                        metadata: {
                          "linked-story": {
                            "owner-name": "Linked Owner",
                            "publisher-name": "Linked Daily",
                            authors: [{ id: 20, name: "Linked Author" }],
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              collection: {
                items: [
                  {
                    story: {
                      id: "sidebar-story",
                      title: "Sidebar Story",
                      slug: "sidebar-story",
                      "owner-id": 99,
                      "owner-name": "Sidebar Owner",
                      "publisher-name": "Sidebar Daily",
                      authors: [{ id: 99, name: "Sidebar Owner", email: "sidebar-owner@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/stories/main-story",
      });
      expect(storyWithSidebar.author.name).toBe("Main Reporter");
      expect(storyWithSidebar.editorial).toEqual({
        ownerName: "Main Owner",
        ownerId: 10,
        publisher: "Main Daily",
      });
      expect(storyWithSidebar.issues).toEqual([]);

      const sectionPage = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              collection: {
                items: [
                  {
                    story: {
                      id: "card-1",
                      title: "Section Card",
                      slug: "section-card",
                      "owner-id": 55,
                      "owner-name": "Section Owner",
                      authors: [{ id: 55, name: "Section Owner", email: "section-owner@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/news",
      });
      expect(sectionPage.editorial.ownerEmail).toBeUndefined();
      expect(sectionPage.editorial.ownerName).toBeUndefined();
    });
  });

  describe("unit 3 hardening regressions", () => {
    test("bounds rawHydration primitive DAG clones and Nuxt preflight shallow-alias / wide-object edges", () => {
      const nuxtPrimitiveDag = JSON.stringify([
        [1, 1, 2, 2],
        Array.from({ length: 1600 }, () => 3),
        Array.from({ length: 1600 }, () => 3),
        1,
      ]);
      const dagResult = parseHtml({
        html: `<script id="__NUXT_DATA__">${nuxtPrimitiveDag}</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
        maxDecodeNodes: 4000,
      });
      expect(JSON.stringify(dagResult.rawHydration)).toContain("[Truncated]");
      expect(dagResult.issues.some(({ message }) => message === "Raw hydration snapshot truncated")).toBe(true);

      const nuxt2PrimitiveIife = parseHtml({
        html: `<script>window.__NUXT__ = (function(a){return {first:a,second:a,author:{name:"IIFE Bounded"}}}([${Array.from({ length: 1600 }, (_, i) => i).join(",")}]));</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
        maxDecodeNodes: 2000,
      });
      expect(JSON.stringify(nuxt2PrimitiveIife.rawHydration)).toContain("[Truncated]");
      expect(nuxt2PrimitiveIife.issues.some(({ message }) => message === "Raw hydration snapshot truncated")).toBe(
        true,
      );

      // Deep path appears first, shallow alias appears second: shallow alias must not mask deeper path.
      const deepBeforeShallow = JSON.stringify([
        { deep: 2, shallow: 1 },
        { nested: 3 },
        { a: 4 },
        { leaf: 5 },
        { b: 1 },
        "Deep Alias Writer",
      ]);
      const shallowMaskAttempt = parseHtml({
        html: `<script id="__NUXT_DATA__">${deepBeforeShallow}</script>`,
        pageUrl: storyUrl,
        maxDecodeDepth: 4,
      });
      expect(shallowMaskAttempt.issues.some(({ message }) => message.includes("Nuxt devalue decode failed"))).toBe(
        true,
      );

      const wideObj = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, 1]));
      const wideNuxt = JSON.stringify([wideObj, "val"]);
      const wideResult = parseHtml({
        html: `<script id="__NUXT_DATA__">${wideNuxt}</script>`,
        pageUrl: storyUrl,
        maxDecodeNodes: 10,
      });
      expect(wideResult.issues.some(({ message }) => message.includes("Nuxt devalue decode failed"))).toBe(true);
    });

    test("blocks shallow-first Nuxt DAG depth bypasses across objects, swapped keys, Set, and Map while preserving cycles and DAG speed", () => {
      const shallowFirstGraphs: Array<[string, string]> = [
        [
          "object shallow-first",
          JSON.stringify([{ a: 3, b: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, "end"]),
        ],
        [
          "object swapped keys",
          JSON.stringify([{ b: 1, a: 3 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, "end"]),
        ],
        ["Set", JSON.stringify([["Set", 3, 1], { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, "end"])],
        [
          "Map values",
          JSON.stringify([["Map", 7, 3, 8, 1], { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, "end", "k1", "k2"]),
        ],
        [
          "Map keys",
          JSON.stringify([["Map", 3, 7, 1, 7], { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, "end", "v"]),
        ],
      ];
      for (const [label, payload] of shallowFirstGraphs) {
        const res = parseHtml({
          html: `<script id="__NUXT_DATA__">${payload}</script>`,
          pageUrl: storyUrl,
          maxDecodeDepth: 4,
        });
        expect(
          res.issues.some(({ message }) => message.includes("Nuxt devalue decode failed")),
          label,
        ).toBe(true);
      }

      const shallowFirstValid = parseHtml({
        html: `<script id="__NUXT_DATA__">${JSON.stringify([{ a: 3, b: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }, { x: 6 }, { author: 7 }, { name: 8 }, "Valid Depth Author"])}</script>`,
        pageUrl: storyUrl,
        maxDecodeDepth: 8,
      });
      expect(shallowFirstValid.author.name).toBe("Valid Depth Author");

      // Valid cycle with mutual references (Author <-> Articles) remains allowed.
      const mutualCycle = parseHtml({
        html: `<script id="__NUXT_DATA__">${JSON.stringify([
          { author: 1, articles: 2 },
          { name: 5, articles: 2 },
          [3, 4],
          { title: 6, url: 7, author: 1 },
          { title: 8, url: 9, author: 1 },
          "Hub Cycle Author",
          "Article One",
          "https://publisher.example/one",
          "Article Two",
          "https://publisher.example/two",
        ])}</script>`,
        pageUrl: storyUrl,
        maxDecodeDepth: 5,
      });
      expect(mutualCycle.author.name).toBe("Hub Cycle Author");
      expect(mutualCycle.issues.some(({ message }) => message.includes("Nuxt devalue decode failed"))).toBe(false);

      // Triangle-chain DAG must not expand exponentially.
      const dagNodes: unknown[] = [];
      const chainLen = 30;
      for (let i = 0; i < chainLen; i++) {
        dagNodes.push({ shallow: i * 2 + 2, deep: i * 2 + 1 });
        dagNodes.push({ next: i * 2 + 2 });
      }
      dagNodes.push({ author: chainLen * 2 + 1 });
      dagNodes.push({ name: chainLen * 2 + 2 });
      dagNodes.push("Fast DAG Author");
      const started = performance.now();
      const dagResult = parseHtml({
        html: `<script id="__NUXT_DATA__">${JSON.stringify(dagNodes)}</script>`,
        pageUrl: storyUrl,
        maxDecodeDepth: 128,
      });
      expect(performance.now() - started).toBeLessThan(150);
      expect(dagResult.author.name).toBe("Fast DAG Author");
    });

    test("rejects a deep cyclic Nuxt graph even when shortcuts reach its nodes", () => {
      const size = 40;
      const root = Object.fromEntries(Array.from({ length: size }, (_, index) => [`node${index}`, index + 1]));
      const graph = [
        root,
        ...Array.from({ length: size }, (_, index) => ({ next: index === size - 1 ? 0 : index + 2 })),
      ];
      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${JSON.stringify(graph)}</script>`,
        pageUrl: storyUrl,
        maxDecodeDepth: 10,
        maxDecodeNodes: 1000,
        includeRawHydration: true,
      });
      expect(result.issues.some(({ message }) => message.includes("Nuxt graph limit"))).toBe(true);
      expect(result.rawHydration).toEqual([]);
    });

    test("revives Nuxt 3 Date values into articles[].publishedAt", () => {
      const serialized = JSON.stringify([
        { author: 1, articles: 2 },
        { name: 3 },
        [4],
        "Nuxt Date Writer",
        { title: 5, url: 6, publishedAt: 7 },
        "Nuxt Dated Article",
        "/nuxt-dated",
        ["Date", "2026-05-01T10:15:00.000Z"],
      ]);
      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${serialized}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Nuxt Date Writer");
      expect(result.articles).toEqual([
        {
          title: "Nuxt Dated Article",
          url: "https://publisher.example/nuxt-dated",
          publishedAt: "2026-05-01T10:15:00.000Z",
        },
      ]);
    });

    test("scopes pageProps.post.author as byline while preserving current post bio email", () => {
      const conflictWithJsonLd = parseHtml({
        html:
          `<script id="__NEXT_DATA__">${JSON.stringify({
            props: { pageProps: { post: { author: { name: "Post Author" } } } },
          })}</script>` +
          `<script type="application/ld+json">${JSON.stringify({
            "@type": "NewsArticle",
            url: storyUrl,
            author: { "@type": "Person", name: "JsonLd Author" },
          })}</script>`,
        pageUrl: storyUrl,
      });
      expect(conflictWithJsonLd.author.name).toBe("Unknown Author");
      expect(conflictWithJsonLd.review.every(({ reason }) => reason === "ambiguous_identity")).toBe(true);

      const postBioEmail = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: {
            pageProps: {
              post: {
                author: {
                  name: "Post Bio Writer",
                  bio: "Reach Post Bio Writer at postbio@example.org for tips.",
                },
              },
            },
          },
        })}</script>`,
        pageUrl: storyUrl,
      });
      expect(postBioEmail.author).toMatchObject({
        name: "Post Bio Writer",
        email: "postbio@example.org",
      });
      expect(postBioEmail.provenance.find(({ field }) => field === "author.name")?.scope).toBe("byline");
    });

    test("handles shadowed undefined/NaN/Infinity/Date/JSON and computed JSON[parse] safely in static-eval", () => {
      const shadowedParams = parseHtml({
        html: `<script>window.__INITIAL_STATE__ = (function(undefined, NaN, Infinity){return {author:{name: undefined, designation: NaN, bio: Infinity}};}("Shadow Author", "Senior Reporter", "Shadowed params work cleanly."));</script>`,
        pageUrl: storyUrl,
      });
      expect(shadowedParams.author).toMatchObject({
        name: "Shadow Author",
        designation: "Senior Reporter",
        bio: "Shadowed params work cleanly.",
      });

      const shadowedBuiltins = parseHtml({
        html: `<script>window.__INITIAL_STATE__ = (function(Date, JSON){return {author:{name:"Bad"}, d: new Date("2025-01-01"), j: JSON.parse("{}")};}("fake", {}));</script>`,
        pageUrl: storyUrl,
      });
      expect(shadowedBuiltins.author.name).toBe("Unknown Author");
      expect(
        shadowedBuiltins.issues.some(({ message }) => message === "Unsupported static hydration initializer"),
      ).toBe(true);

      const computedJson = parseHtml({
        html: `<script>window.__INITIAL_STATE__ = {author:{name: JSON["parse"]('"Computed"')}};</script>`,
        pageUrl: storyUrl,
      });
      expect(computedJson.author.name).toBe("Unknown Author");
      expect(computedJson.issues.some(({ message }) => message === "Unsupported static hydration initializer")).toBe(
        true,
      );
    });
  });
});
