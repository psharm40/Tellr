// classic content-script helper. reads the page the shopper is on.
// never clicks buy, checkout, or payment controls.
(function (global) {
  const PRICE = /(?:USD|US\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{2})?)/i;
  const PRICE_G = /(?:USD|US\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;
  const PRICE_AFTER = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:USD|dollars?)\b/gi;
  const BARE_PRICE = /(?:^|[^\d])([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})(?:[^\d]|$)/;
  const ADDON = /\b(protection plan|extended warranty|applecare|care plan|device protection|accidental damage|shipping protection|gift wrap)\b/i;
  const SUBSCRIBE = /\b(subscribe\s*(and|&)?\s*save|auto[- ]?renew|recurring|subscription)\b/i;
  const ONE_TIME = /\b(one[- ]time purchase|buy (it )?once|without subscription)\b/i;
  const SHIP_FREE = /\bfree shipping\b/i;
  const SKIP_IMG = /sprite|pixel|icon|logo|avatar|badge|spinner|1x1|tracking|placeholder|svg\+xml|data:image\/svg/i;
  const SKIP_TITLE = /^(home|shop|menu|cart|search|skip|log in|sign in|account)$/i;
  const SKIP_PRODUCT = /\b(gifts under|shop by|shop now|free shipping|% off|percent off|continue shopping|see all)\b/i;
  const CARD_SEL = [
    "[data-component-type='s-search-result']",
    "li.s-item",
    "[data-testid*='product']",
    "[class*='product-card']",
    "[class*='ProductCard']",
    "[class*='productCard']",
    "[class*='search-result']",
    "[class*='grid-item']",
    "[class*='collection-product']",
    "article",
    "li[class*='product']",
    "div[class*='product-item']",
  ].join(",");

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function meta(property) {
    const node =
      document.querySelector(`meta[property="${property}"]`) ||
      document.querySelector(`meta[name="${property}"]`);
    return node?.getAttribute("content")?.trim() || "";
  }

  function parseCents(raw) {
    if (raw == null) return null;
    const match = String(raw).replace(/,/g, "").match(/(\d+)(?:\.(\d{1,2}))?/);
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
    if (!Number.isInteger(cents) || cents < 50 || cents > 10_000_000) return null;
    return cents;
  }

  function centsFromText(value) {
    if (!value) return null;
    const priced = String(value).match(PRICE);
    return priced ? parseCents(priced[1]) : null;
  }

  function walkJsonLd(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item) => walkJsonLd(item, out));
      return;
    }
    if (typeof node !== "object") return;
    const type = node["@type"];
    const types = Array.isArray(type) ? type : type ? [type] : [];
    if (types.includes("Product") || types.includes("Offer") || types.includes("ItemList")) out.push(node);
    if (node["@graph"]) walkJsonLd(node["@graph"], out);
    if (node.offers) walkJsonLd(node.offers, out);
    if (node.itemListElement) walkJsonLd(node.itemListElement, out);
    if (node.item) walkJsonLd(node.item, out);
  }

  function jsonLdNodes() {
    const found = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walkJsonLd(JSON.parse(script.textContent), found);
      } catch {
        // ignore broken json-ld
      }
    }
    return found;
  }

  function firstImage(value) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list
      .map((item) => (typeof item === "string" ? item : item?.url || item?.contentUrl || ""))
      .filter((url) => /^https?:\/\//i.test(url));
  }

  function offerFrom(product) {
    const offers = product.offers;
    if (!offers) return null;
    return Array.isArray(offers) ? offers[0] : offers;
  }

  function imgUrl(img) {
    if (!img) return "";
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (srcset) {
      const last = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      if (last) return last;
    }
    return img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-old-src") || "";
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function pageImages() {
    const urls = [];
    const seen = new Set();
    function add(url, alt) {
      const href = absoluteUrl(url);
      if (!href || !/^https?:\/\//i.test(href)) return;
      const clean = href.split("?")[0];
      if (SKIP_IMG.test(href) || SKIP_IMG.test(alt || "") || seen.has(clean)) return;
      seen.add(clean);
      urls.push({ url: href, alt: alt || "" });
    }
    for (const node of jsonLdNodes()) {
      for (const url of firstImage(node.image)) add(url, node.name);
    }
    add(meta("og:image"), meta("og:title"));
    add(meta("og:image:secure_url"), meta("og:title"));
    const root = document.querySelector("main, #main, [role='main'], #dp, #productTitle") || document.body;
    for (const img of root.querySelectorAll("img")) {
      const src = imgUrl(img);
      const w = img.naturalWidth || Number(img.getAttribute("width")) || 0;
      const h = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      if (w && h && (w < 120 || h < 120)) continue;
      add(src, img.alt);
      if (urls.length >= 12) break;
    }
    return urls.slice(0, 12);
  }

  function heading() {
    const node = document.querySelector("#productTitle, #title, [itemprop='name'], h1");
    const fromNode = (node?.innerText || text(node)).replace(/\s+/g, " ").trim();
    return fromNode || meta("og:title") || document.title.split(/[|\-–]/)[0].trim();
  }

  function visibleText() {
    const root = document.querySelector("main, #main, [role='main'], #dp") || document.body;
    return text(root).slice(0, 1200);
  }

  function description() {
    const ld = jsonLdNodes().find((node) => node.description);
    const written =
      String(ld?.description || "") ||
      meta("og:description") ||
      meta("description") ||
      text(document.querySelector("#productDescription, #feature-bullets, [itemprop='description']"));
    return written.slice(0, 4000);
  }

  function category() {
    const crumbs = [...document.querySelectorAll("[itemtype*='Breadcrumb'], nav[aria-label*='breadcrumb' i] a, .breadcrumb a")]
      .map(text)
      .filter((label) => label && !/^home$/i.test(label));
    const ld = jsonLdNodes().find((node) => node.category);
    return String(ld?.category || crumbs[crumbs.length - 1] || "item").slice(0, 80);
  }

  function productFromLd(node) {
    const offer = offerFrom(node) || node;
    const cents = parseCents(offer.price ?? offer.lowPrice ?? node.price);
    const title = String(node.name || node.title || "").replace(/\s+/g, " ").trim();
    if (!title || cents == null) return null;
    return {
      title: title.slice(0, 160),
      priceCents: cents,
      url: absoluteUrl(node.url || offer.url || ""),
      imageUrl: firstImage(node.image)[0] || "",
    };
  }

  function productsFromJsonLd() {
    const items = [];
    for (const node of jsonLdNodes()) {
      const product = productFromLd(node);
      if (product) items.push(product);
    }
    return items;
  }

  function decodeEntities(value) {
    const box = document.createElement("textarea");
    box.innerHTML = String(value || "");
    return box.value;
  }

  function cleanTitle(value) {
    return decodeEntities(String(value || ""))
      .replace(PRICE_G, " ")
      .replace(/\s+/g, " ")
      .replace(/[·•.,;:\-–—]+$/g, "")
      .trim()
      .slice(0, 160);
  }

  function usefulTitle(value) {
    let title = cleanTitle(value);
    title = title
      .replace(/Brand Name/gi, " ")
      .replace(/Product Name/gi, " ")
      .replace(/Gender/gi, " ")
      .replace(/\bMSRP\b.*/i, " ")
      .replace(/On sale for/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 4 || SKIP_TITLE.test(title) || SKIP_PRODUCT.test(title)) return "";
    if (/^(shop now|learn more|see details|sponsored|best seller)$/i.test(title)) return "";
    return title.slice(0, 160);
  }

  function titleFromCard(card) {
    if (!card) return "";
    const headingEl = card.querySelector("h2, h3, h4, [class*='title'], [class*='Title'], a[title]");
    const fromHeading = usefulTitle(text(headingEl) || headingEl?.getAttribute?.("title"));
    if (fromHeading) return fromHeading;
    const img = card.querySelector("img[alt]");
    const fromAlt = usefulTitle(img?.alt);
    if (fromAlt) return fromAlt;
    const link = card.querySelector("a");
    return usefulTitle(link?.getAttribute("title") || text(link));
  }

  function productsFromAmazon() {
    const items = [];
    for (const card of document.querySelectorAll("[data-component-type='s-search-result'], div[data-asin]")) {
      const title = usefulTitle(text(card.querySelector("h2 a, h2 span, h2")));
      const cents = centsFromText(text(card.querySelector(".a-price .a-offscreen, .a-price")));
      if (!title || cents == null) continue;
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(card.querySelector("h2 a, a.a-link-normal")?.href || ""),
        imageUrl: imgUrl(card.querySelector("img")),
      });
      if (items.length >= 40) break;
    }
    return items;
  }

  function productsFromEbay() {
    const items = [];
    for (const card of document.querySelectorAll("li.s-item")) {
      const title = usefulTitle(text(card.querySelector(".s-item__title, .s-item__title span")));
      const cents = centsFromText(text(card.querySelector(".s-item__price")));
      if (!title || cents == null || /shop on ebay/i.test(title)) continue;
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(card.querySelector("a")?.href || ""),
        imageUrl: imgUrl(card.querySelector("img")),
      });
      if (items.length >= 40) break;
    }
    return items;
  }

  // modern shops (zappos, many next.js grids) put name + $price in one link and hash the css
  function productsFromLinks() {
    const items = [];
    const links = document.querySelectorAll("a[href]");
    const limit = Math.min(links.length, 300);
    for (let i = 0; i < limit; i++) {
      const a = links[i];
      const raw = text(a);
      if (raw.length < 8 || raw.length > 240) continue;
      if (SKIP_PRODUCT.test(raw) || /\/null\//.test(a.href)) continue;
      const match = raw.match(PRICE);
      if (!match) continue;
      const cents = parseCents(match[1]);
      const title = usefulTitle(raw);
      if (!title || cents == null) continue;
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(a.href),
        imageUrl: imgUrl(a.querySelector("img")),
      });
      if (items.length >= 40) break;
    }
    return items;
  }

  function productsFromCards() {
    const items = [];
    const cards = document.querySelectorAll(CARD_SEL);
    const limit = Math.min(cards.length, 80);
    for (let i = 0; i < limit; i++) {
      const card = cards[i];
      const priceEl = card.querySelector(".a-price .a-offscreen, .s-item__price, [class*='price'], [itemprop='price']");
      const cents = centsFromText(text(priceEl) || text(card).slice(0, 240));
      if (cents == null) continue;
      const title = titleFromCard(card);
      if (!title) continue;
      const link = card.querySelector("a[href]");
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(link?.href || ""),
        imageUrl: imgUrl(card.querySelector("img")),
      });
      if (items.length >= 40) break;
    }
    return items;
  }

  function productsFromPrices() {
    const items = [];
    const nodes = document.querySelectorAll(".a-price .a-offscreen, [class*='price'], [itemprop='price'], [data-price]");
    const limit = Math.min(nodes.length, 60);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      const snippet = text(el).slice(0, 80);
      const cents = centsFromText(snippet) ?? parseCents(el.getAttribute("content") || el.getAttribute("data-price"));
      if (cents == null) continue;
      const card = el.closest("a, article, li, [class*='product'], [class*='card'], [data-testid], [data-component-type]");
      const title = titleFromCard(card || el.parentElement) || "";
      if (!title) continue;
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(card?.href || card?.querySelector?.("a")?.href || ""),
        imageUrl: imgUrl((card || el).querySelector?.("img")),
      });
    }
    return items;
  }

  function dedupeProducts(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const key = `${item.title.toLowerCase()}|${item.priceCents}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out.slice(0, 40);
  }

  function productsFromVisibleText() {
    const blob = (document.body?.textContent || "").slice(0, 40_000);
    const items = [];
    const seen = new Set();
    function add(raw) {
      const cents = parseCents(raw);
      if (cents == null || seen.has(cents)) return;
      seen.add(cents);
      items.push({
        title: heading() || "Priced item on this page",
        priceCents: cents,
        url: location.href,
        imageUrl: "",
      });
    }
    for (const match of blob.matchAll(PRICE_G)) add(match[1]);
    for (const match of blob.matchAll(PRICE_AFTER)) add(match[1]);
    return items;
  }

  function coercePrice(value, asCents) {
    if (value == null) return null;
    if (typeof value === "object" && value !== null) {
      return coercePrice(value.value ?? value.amount ?? value.price, asCents);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (asCents) return parseCents((value / 100).toFixed(2));
      if (Number.isInteger(value) && value >= 500 && value % 1 === 0) return parseCents((value / 100).toFixed(2));
      return parseCents(String(value));
    }
    const text = String(value);
    if (PRICE.test(text) || /USD|dollars?/i.test(text)) return centsFromText(text) ?? parseCents(text);
    if (asCents && /^\d+$/.test(text.trim())) return parseCents((Number(text) / 100).toFixed(2));
    return parseCents(text);
  }

  function productsFromJsonScripts() {
    const items = [];
    const scripts = document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__, script#__PRELOADED_STATE__');
    const limit = Math.min(scripts.length, 12);
    for (let i = 0; i < limit; i++) {
      const raw = scripts[i].textContent || "";
      if (raw.length < 8 || raw.length > 400_000) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      walkCommerce(data, items, 0);
    }
    return items;
  }

  function walkCommerce(node, acc, depth) {
    if (!node || depth > 7 || acc.length >= 40) return;
    if (Array.isArray(node)) {
      node.slice(0, 40).forEach((child) => walkCommerce(child, acc, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    const title = node.name || node.title || node.productName || node.product_title || node.productTitle;
    const cents =
      coercePrice(node.price ?? node.salePrice ?? node.currentPrice ?? node.lowPrice ?? node.amount) ??
      coercePrice(node.priceCents ?? node.price_cents ?? node.current_price, true);
    if (title && cents != null) {
      acc.push({
        title: String(title).replace(/\s+/g, " ").trim().slice(0, 160),
        priceCents: cents,
        url: absoluteUrl(node.url || node.href || ""),
        imageUrl: firstImage(node.image || node.featured_image || node.imageUrl)[0] || "",
      });
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walkCommerce(value, acc, depth + 1);
    }
  }

  function productsFromAttributes() {
    const items = [];
    const nodes = document.querySelectorAll("[data-price], [data-product-price], [itemprop='price']");
    const limit = Math.min(nodes.length, 40);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      const raw = el.getAttribute("data-price") || el.getAttribute("data-product-price") || el.getAttribute("content");
      const cents = /^\d{3,}$/.test(String(raw || "")) ? coercePrice(raw, true) : coercePrice(raw);
      if (cents == null) continue;
      const title = titleFromCard(el.closest("a, article, li, [class*='product'], [class*='card']") || el.parentElement) || heading();
      items.push({ title: title || "Priced item on this page", priceCents: cents, url: location.href, imageUrl: "" });
    }
    return items;
  }

  function collectProducts() {
    const named = dedupeProducts([
      ...productsFromAmazon(),
      ...productsFromEbay(),
      ...productsFromLinks(),
      ...productsFromJsonLd(),
      ...productsFromJsonScripts(),
      ...productsFromCards(),
      ...productsFromPrices(),
      ...productsFromAttributes(),
    ]);
    if (named.length) return named;
    return dedupeProducts(productsFromVisibleText());
  }

  function pagePriceCents(products) {
    const ld = jsonLdNodes();
    for (const node of ld) {
      const offer = offerFrom(node) || node;
      const amount = offer.price ?? offer.lowPrice ?? node.price;
      const currency = String(offer.priceCurrency || node.priceCurrency || "USD").toUpperCase();
      const cents = parseCents(amount);
      if (cents != null) return { cents, currency };
    }
    const attr = document.querySelector("[itemprop='price']")?.getAttribute("content");
    const itemprop = parseCents(attr);
    if (itemprop != null) return { cents: itemprop, currency: "USD" };
    const og = parseCents(meta("product:price:amount") || meta("og:price:amount"));
    if (og != null) return { cents: og, currency: (meta("product:price:currency") || "USD").toUpperCase() };
    const amazon = centsFromText(text(document.querySelector(".a-price .a-offscreen, #corePrice_feature_div")));
    if (amazon != null) return { cents: amazon, currency: "USD" };
    const labeled = [...document.querySelectorAll("[class*='price'], [id*='price'], [data-testid*='price']")]
      .map(text)
      .find((value) => PRICE.test(value));
    const fromLabel = centsFromText(labeled);
    if (fromLabel != null) return { cents: fromLabel, currency: "USD" };
    if (products.length === 1) return { cents: products[0].priceCents, currency: "USD" };
    return { cents: null, currency: "USD" };
  }

  function nearbyPrice(pattern) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue.replace(/\s+/g, " ").trim();
      if (!pattern.test(value)) continue;
      const cents = centsFromText(value);
      if (cents != null) return cents;
      const sibling = walker.currentNode.parentElement?.parentElement;
      const nearby = centsFromText(text(sibling));
      if (nearby != null) return nearby;
    }
    return null;
  }

  function quantity() {
    const input = document.querySelector("input[name*='qty' i], input[name*='quantity' i], select[name*='qty' i], select[id*='quantity' i]");
    const n = Number(input?.value);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }

  function addOns() {
    const found = [];
    const controls = document.querySelectorAll("input[type='checkbox'], input[type='radio'], [role='checkbox'], label");
    for (const el of controls) {
      const label = text(el.closest("label") || el);
      if (!ADDON.test(label)) continue;
      const checked = el.matches("input") ? el.checked : el.getAttribute("aria-checked") === "true";
      if (!checked && !/selected|added/i.test(label)) continue;
      const priceCents = centsFromText(label) ?? 0;
      found.push({
        id: `addon_${found.length + 1}`,
        label: label.slice(0, 80),
        priceCents,
        explicitlyAccepted: false,
      });
      if (found.length >= 6) break;
    }
    return found;
  }

  function subscription() {
    const body = text(document.body).slice(0, 20_000);
    const checked = [...document.querySelectorAll("input[type='radio']:checked, input[type='checkbox']:checked")]
      .map((el) => text(el.closest("label") || el.parentElement))
      .join(" ");
    if (SUBSCRIBE.test(checked)) return true;
    if (ONE_TIME.test(checked)) return false;
    if (SUBSCRIBE.test(body) && ONE_TIME.test(body)) return null;
    if (SUBSCRIBE.test(body)) return null;
    return false;
  }

  function deliveryDate() {
    const body = text(document.body).slice(0, 20_000);
    const iso = body.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      if (
        date.getUTCFullYear() === Number(iso[1]) &&
        date.getUTCMonth() === Number(iso[2]) - 1 &&
        date.getUTCDate() === Number(iso[3])
      ) {
        return iso[0];
      }
    }
    return null;
  }

  function shippingCents() {
    if (SHIP_FREE.test(text(document.body).slice(0, 20_000))) return 0;
    return nearbyPrice(/\bshipping\b/i);
  }

  function taxCents() {
    if (/\btax (calculated|to be calculated)\b/i.test(text(document.body).slice(0, 20_000))) return null;
    return nearbyPrice(/\btax\b/i);
  }

  function extractPage() {
    const products = collectProducts();
    const title = heading() || products[0]?.title || "Untitled listing";
    const price = pagePriceCents(products);
    const itemPriceCents = price.cents ?? (products.length ? Math.min(...products.map((p) => p.priceCents)) : 0);
    const written = description();
    const catalog =
      products.length > 1
        ? products.map((p, i) => `${i + 1}. ${p.title} — $${(p.priceCents / 100).toFixed(2)}`).join("\n")
        : "";
    const cartTitle = text(document.querySelector("[data-item-title], .cart-item-title, .sc-product-title")) || title;
    const imageUrls = [
      ...products.filter((p) => p.imageUrl).map((p) => ({ url: p.imageUrl, alt: p.title })),
      ...pageImages(),
    ].slice(0, 12);
    return {
      url: location.href,
      title,
      description: [written, catalog && `Items visible on this page:\n${catalog}`, `Page text: ${visibleText()}`]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000),
      category: category() || "item",
      itemPriceCents,
      currency: price.currency || "USD",
      imageUrls,
      products,
      checkoutHints: {
        cartTitle,
        quantity: quantity(),
        unitPriceCents: itemPriceCents,
        shippingCents: shippingCents(),
        taxCents: taxCents(),
        addOns: addOns(),
        hasSubscription: subscription(),
        estimatedDeliveryDate: deliveryDate(),
      },
    };
  }

  global.TellrExtract = { extractPage };
})(globalThis);
