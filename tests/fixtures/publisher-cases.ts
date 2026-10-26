export interface PublisherCase {
  id: string;
  pageUrl: string;
  html: string;
}

const cards = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<article class="river-item"><h2><a href="/world/story-${index + 1}">World headline number ${index + 1} reports on a significant local development</a></h2></article>`,
  ).join("");

export const publisherCases: readonly PublisherCase[] = [
  {
    id: "BI wrapped Fenrir profile",
    pageUrl: "https://www.businessinsider.example/author/alex-rivera",
    html: `<html><head><title>Alex Rivera - Business Insider</title><meta name="description" content="Alex Rivera reports on business and technology."><link rel="canonical" href="https://www.businessinsider.example/author/alex-rivera"><script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Person","name":"Alex Rivera","url":"https://www.businessinsider.example/author/alex-rivera"}}</script><script id="fenrir-client-data">const fenrirClientData = {"config":{"site":"business-insider","build":"fixture"}}; window.Fenrir = Object.assign({}, {ready: true});</script></head><body><section class="author-wrapper river-item"><h1>Alex Rivera</h1><div class="author-description"><p>Alex Rivera covers business and technology, with a focus on the people and companies shaping the global economy.</p><a href="/awards/one">A long award citation connected to the author's biography and career</a><a href="/awards/two">A second long award citation connected to the author's reporting work</a></div></section><section class="river-item"><h2><a href="/markets/first">Markets rise as investors assess the latest corporate earnings</a></h2></section><section class="river-item"><h2><a href="/technology/second">Technology companies announce new products for global customers</a></h2></section></body></html>`,
  },
  {
    id: "CBC lineup with story cards",
    pageUrl: "https://www.cbc.example/news/world",
    html: `<html><head><title>World News | CBC</title><meta name="description" content="The latest world news and analysis from CBC."><link rel="canonical" href="https://www.cbc.example/news/world"><script id="static-page">${JSON.stringify({ main: { content: [{ type: "lineup", content: Array.from({ length: 17 }, (_, index) => ({ itemType: "story", author: { name: `Card Reporter ${index + 1}` } })) }] } })}</script></head><body>${Array.from({ length: 20 }, (_, index) => `<article class="card"><h2><a href="/news/story-${index + 1}">CBC story headline number ${index + 1} covers a significant event around the world</a></h2></article>`).join("")}</body></html>`,
  },
  {
    id: "Guardian Nicola Davis profile",
    pageUrl: "https://www.theguardian.example/profile/nicola-davis",
    html: `<html><head><title>Nicola Davis | The Guardian</title><meta name="description" content="&lt;p&gt;Nicola Davis writes about science and the natural world.&lt;/p&gt;"><link rel="canonical" href="https://www.theguardian.example/profile/nicola-davis"></head><body><section class="hashed-author-profile"><h2>Nicola Davis</h2><picture><img alt="Headshot of Nicola Davis" src="/images/nicola-davis.jpg"></picture><p>Nicola Davis is a science correspondent covering wildlife, climate and the natural world.</p></section></body></html>`,
  },
  {
    id: "NPR archived Tony Cox profile",
    pageUrl: "https://www.npr.example/people/2100394/tony-cox",
    html: `<html><head><title>Tony Cox : NPR</title><meta name="description" content="Tony Cox is an award-winning journalist."><link rel="canonical" href="https://www.npr.example/people/2100394/tony-cox"></head><body><header class="contentheader--archived-bio"><h2 class="branding__title">Tony Cox</h2></header><div class="speakable"><b data-is-speakable="true">Tony Cox</b><b data-is-speakable="true">Tony Cox has covered public radio, national affairs and culture for more than three decades.</b></div></body></html>`,
  },
  {
    id: "Guardian world listing",
    pageUrl: "https://www.theguardian.example/world",
    html: `<html><head><title>World news | The Guardian</title><meta name="description" content="Latest international news, analysis and features."><link rel="canonical" href="https://www.theguardian.example/world"></head><body><main>${cards(17)}</main></body></html>`,
  },
];
