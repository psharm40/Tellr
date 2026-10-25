// classic content-script helper. reads the page the shopper is on.
// never clicks buy, checkout, or payment controls.
(function (global) {
  const PRICE = /(?:USD|US\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{2})?)/i;
  const PRICE_G = /(?:USD|US\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;
  const PRICE_AFTER = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:USD|dollars?)\b/gi;
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
    // lazy galleries keep the real photo in data-* until it's scrolled to
    const lazy = img.getAttribute("data-zoom-src") || img.getAttribute("data-src") || img.getAttribute("data-old-src") || "";
    const src = img.currentSrc || img.src || "";
    return !src || src.startsWith("data:") ? lazy : src;
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  // the same photo at another size is still one photo: ebay's s-l64 and s-l1600, amazon's _AC_ sizes
  function photoKey(href) {
    const clean = href.split("?")[0];
    return clean.match(/ebayimg\.com\/(?:images\/g|thumbs\/images\/g)\/([^/]+)\//i)?.[1] || clean.replace(/\._[^/]*?_\.(jpe?g|png|webp)$/i, ".$1");
  }
  // gallery thumbnails from these hosts are small on the page but get fetched full size
  const RESIZABLE = /(^|\.)(ebayimg\.com|media-amazon\.com|ssl-images-amazon\.com)\//i;

  function pageImages() {
    const urls = [];
    const seen = new Set();
    function add(url, alt) {
      const href = absoluteUrl(url);
      if (!href || !/^https?:\/\//i.test(href)) return;
      const key = photoKey(href);
      if (SKIP_IMG.test(href) || SKIP_IMG.test(alt || "") || seen.has(key)) return;
      seen.add(key);
      urls.push({ url: href, alt: alt || "" });
    }
    for (const node of jsonLdNodes()) {
      for (const url of firstImage(node.image)) add(url, node.name);
    }
    add(meta("og:image"), meta("og:title"));
    add(meta("og:image:secure_url"), meta("og:title"));
    const root = document.querySelector("main, #main, [role='main'], #dp, #productTitle") || document.body;
    for (const img of root.querySelectorAll("img")) {
      // photos that link to a different listing ("similar items") are not this item
      if (linksToOtherItem(img)) continue;
      const src = imgUrl(img);
      const w = img.naturalWidth || Number(img.getAttribute("width")) || 0;
      const h = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      if (w && h && (w < 120 || h < 120) && !RESIZABLE.test(src.replace(/^https?:\/\//, ""))) continue;
      add(src, img.alt);
      if (urls.length >= 12) break;
    }
    return urls.slice(0, 12);
  }

  // --- photos of the listing itself. layout-based, so it works on any store: find the product
  // section (the title and its photo), take the main photo there, then the photo gallery around
  // it. swatches and the size picker sit with the title and price; reviews, ads, and similar
  // items sit outside the section or link to other products. none of those are this item.
  const MIN_MAIN_PHOTO = 150;
  const GALLERY_TEXT_LIMIT = 300;

  function titleElement() {
    const node = document.querySelector("#productTitle, #title, [itemprop='name'], h1");
    return node && !node.closest("#tellr-root") ? node : null;
  }

  // a link that leads to some other product (a recommendation, an ad, the seller's other items),
  // as opposed to a gallery link that opens a bigger photo or does nothing
  function linksElsewhere(anchor) {
    const href = anchor.href || "";
    if (!/^https?:/i.test(href) || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(href)) return false;
    try {
      const there = new URL(href);
      if (there.origin === location.origin && there.pathname === location.pathname) return false;
      const thisItem = location.href.match(ITEM_PATH)?.[1];
      const thatItem = href.match(ITEM_PATH)?.[1];
      if (thisItem && thatItem) return thisItem !== thatItem;
      // only links that wrap a picture look like product cards; plain text links are navigation
      return Boolean(anchor.querySelector("img"));
    } catch {
      return false;
    }
  }

  function insideOtherProduct(el) {
    const anchor = el.closest("a[href]");
    return Boolean(anchor && linksElsewhere(anchor));
  }

  function shownSize(img) {
    const box = img.getBoundingClientRect();
    return {
      width: box.width || img.naturalWidth || Number(img.getAttribute("width")) || 0,
      height: box.height || img.naturalHeight || Number(img.getAttribute("height")) || 0,
    };
  }

  // the main photo: the biggest picture in the same section as the product title, never one
  // that links to another product. with no title to anchor on, nothing is assumed.
  function mainProductPhoto() {
    const title = titleElement();
    if (!title) return null;
    let section = title.parentElement;
    for (let depth = 0; section && depth < 10; depth += 1, section = section.parentElement) {
      const pictures = [...section.querySelectorAll("img")]
        .filter((img) => !img.closest("#tellr-root") && !insideOtherProduct(img) && imgUrl(img))
        .map((img) => ({ img, ...shownSize(img) }))
        .filter(({ width, height }) => width >= MIN_MAIN_PHOTO && height >= MIN_MAIN_PHOTO);
      if (pictures.length) {
        pictures.sort((a, b) => b.width * b.height - a.width * a.height);
        return pictures[0].img;
      }
      if (section === document.body) break;
    }
    return null;
  }

  // the widest container around the main photo that is still only photos: it stops before the
  // title, prices, text fields and pickers, a block of text, or a link to another product
  function galleryAround(photo) {
    const title = titleElement();
    let gallery = photo.parentElement;
    for (let next = gallery?.parentElement; next && next !== document.body; next = next.parentElement) {
      if (title && next.contains(title)) break;
      if (next.querySelector("select, textarea, input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='radio'])")) break;
      if (PRICE.test(text(next))) break;
      if (text(next).length > GALLERY_TEXT_LIMIT) break;
      if ([...next.querySelectorAll("a[href]")].some(linksElsewhere)) break;
      gallery = next;
    }
    return gallery;
  }

  // one key per photo, whatever size the site serves it at: ebay's s-l64 / s-l1600, amazon's
  // ._AC_SX679_. suffix, and common "_800x" / "?width=" sizing on other stores
  function listingPhotoKey(href) {
    const clean = href.split("?")[0].split("#")[0].toLowerCase();
    const ebay = clean.match(/ebayimg\.com\/(?:images\/g|thumbs\/images\/g)\/([^/]+)\//)?.[1];
    if (ebay) return ebay;
    return clean.replace(/\._[^/]*?_\.(jpe?g|png|webp)$/, ".$1").replace(/[_-]\d{2,4}x\d{0,4}(?=\.\w+$)/, "");
  }

  function words(value) {
    return new Set(String(value || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  }

  function sameProductName(a, b) {
    const x = words(a);
    const y = words(b);
    if (!x.size || !y.size) return false;
    const shared = [...x].filter((w) => y.has(w)).length;
    return shared / Math.min(x.size, y.size) >= 0.6;
  }

  // the store's own photo list (json-ld) is only used when it is provably this listing: same
  // product name, and it includes the photo on screen now, so a different color's set is ignored
  function structuredPhotos(title, shownKey) {
    for (const node of jsonLdNodes()) {
      const urls = firstImage(node.image);
      if (!urls.length || !sameProductName(node.name, title)) continue;
      if (shownKey && urls.some((url) => listingPhotoKey(url) === shownKey)) return urls;
    }
    return [];
  }

  function listingPhotos() {
    const photos = [];
    const seen = new Set();
    function add(url, alt) {
      const href = absoluteUrl(url);
      if (!href || !/^https?:\/\//i.test(href) || SKIP_IMG.test(href) || SKIP_IMG.test(alt || "")) return;
      const key = listingPhotoKey(href);
      if (seen.has(key)) return;
      seen.add(key);
      photos.push({ url: href, alt: alt || "" });
    }
    const title = heading();
    const named = titleElement();
    const main = mainProductPhoto();
    if (main) {
      add(imgUrl(main), main.alt);
      for (const img of galleryAround(main).querySelectorAll("img")) {
        if (!insideOtherProduct(img)) add(imgUrl(img), img.alt);
      }
    } else {
      // no product section found: the share-preview photo, only if it names this product.
      // otherwise no photos, which tellr reports, rather than a guess
      // a real product name on the page is required: comparing og:title with itself proves nothing
      if (named && sameProductName(meta("og:title"), text(named))) add(meta("og:image"), meta("og:title"));
    }
    const shownKey = photos[0] ? listingPhotoKey(photos[0].url) : null;
    for (const url of structuredPhotos(title, shownKey)) add(url, title);
    return photos.slice(0, 12);
  }

  // listing pages on marketplaces: /itm/<id> on ebay, /dp/<asin> on amazon
  const ITEM_PATH = /\/(?:itm|dp|gp\/product)\/(?:[^/]*\/)?([A-Za-z0-9]{6,})/;

  function linksToOtherItem(img) {
    const href = img.closest("a[href]")?.href;
    if (!href) return false;
    const here = location.href.match(ITEM_PATH)?.[1];
    const there = href.match(ITEM_PATH)?.[1];
    return !!there && there !== here;
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

  // ebay has used both "s-item" and newer "s-card" result markup; read either. the item link is
  // the one pointing at /itm/ (the first link in a card can be an image or a "sponsored" link).
  function productsFromEbay() {
    const items = [];
    for (const card of document.querySelectorAll("li.s-item, li.s-card, div.s-card")) {
      const title = usefulTitle(
        text(card.querySelector(".s-item__title, .s-card__title, [role='heading']"))
          .replace(/^new listing\s*/i, "")
          .replace(/\s*opens in a new window or tab$/i, ""),
      );
      const cents = centsFromText(text(card.querySelector(".s-item__price, .s-card__price")));
      if (!title || cents == null || /shop on ebay/i.test(title)) continue;
      items.push({
        title,
        priceCents: cents,
        url: absoluteUrl(card.querySelector("a[href*='/itm/']")?.href || card.querySelector("a")?.href || ""),
        imageUrl: imgUrl(card.querySelector("img")),
        // "Pre-owned", "New (Other)": helps with "the less worn ones"
        condition: text(card.querySelector(".s-item__subtitle .SECONDARY_INFO, .SECONDARY_INFO, .s-card__subtitle")).slice(0, 80),
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
    // on big marketplaces the generic scrapers also catch promo tiles (ebay live auctions,
    // sponsored banners). real listings link to an item page, so keep only those when we can.
    const itemLink = /(^|\.)ebay\./i.test(location.hostname)
      ? /\/itm\//i
      : /(^|\.)amazon\./i.test(location.hostname)
        ? /\/(dp|gp\/product)\//i
        : null;
    if (itemLink) {
      const listings = named.filter((item) => itemLink.test(item.url || ""));
      if (listings.length) return listings;
    }
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

  // a money row: a short label ("Tax", "Estimated tax:", "Shipping") with its price on the
  // same row. fine print like "sales tax may apply" is skipped: taking whatever price sat near
  // it read a $14.99 shipping cost as tax.
  function labeledPrice(label) {
    const whole = new RegExp(`^${label.source}\\s*:?\\s*(.*)$`, "i");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue.replace(/\s+/g, " ").trim();
      if (!value || value.length > 40) continue;
      const match = value.match(whole);
      if (!match) continue;
      const rest = match[1];
      if (rest) {
        const inline = centsFromText(rest);
        if (inline != null) return inline;
        // "(estimated)" is still a label; anything else is a sentence, not a row
        if (!/^\(?(estimated|est\.?)\)?:?$/i.test(rest)) continue;
      }
      // the price that follows the label in its row ("Shipping: US $9.45 (approx C $12.95) USPS…"),
      // never one from before it or far after it, so a long row still reads right
      let row = walker.currentNode.parentElement;
      for (let depth = 0; depth < 3 && row; depth += 1, row = row.parentElement) {
        const rowText = text(row);
        if (rowText.length > 600) break;
        const at = rowText.indexOf(value);
        const after = at >= 0 ? rowText.slice(at + value.length, at + value.length + 80) : "";
        const cents = centsFromText(after);
        if (cents != null) return cents;
      }
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
    return labeledPrice(/(?:estimated |est\.? )?(?:shipping|delivery|postage)(?: (?:and|&) handling)?(?: (?:cost|fee|price))?/);
  }

  function taxCents() {
    if (/\btax (calculated|to be calculated)\b/i.test(text(document.body).slice(0, 20_000))) return null;
    return labeledPrice(/(?:estimated |est\.? )?(?:sales )?tax(?:es)?(?: \(estimated\))?/);
  }

  // --- facts on a listing, grouped by topic: the seller's track record, how popular the item
  // is, condition, returns, shipping, and the item's specifics. read as written on the page;
  // nothing here is a judgement.
  const FACT_GROUP = [
    ["condition", /\bcondition\b/i],
    ["returns", /\breturns?\b/i],
    ["shipping", /\b(shipping|delivery|located in|ships (from|to)|postage|handling time)\b/i],
    ["payment", /\b(payments?|pay later|financing)\b/i],
  ];

  function labelValuePairs() {
    const pairs = [];
    const add = (label, value) => {
      label = label.replace(/\s*:\s*$/, "").trim();
      value = value.replace(/\s+/g, " ").replace(/\bSee (all )?details\b.*$/i, "").replace(/\bRead more\b.*$/i, "").trim();
      if (!label || !value || label.length > 40 || value.length > 300) return;
      if (pairs.some((p) => p.label.toLowerCase() === label.toLowerCase())) return;
      pairs.push({ label, value });
    };
    // ebay item specifics and the shipping / returns rows
    for (const row of document.querySelectorAll(".ux-labels-values, .ux-layout-section-evo__row > div")) {
      const label = text(row.querySelector(".ux-labels-values__labels"));
      const value = text(row.querySelector(".ux-labels-values__values"));
      if (label && value) add(label, value);
    }
    for (const dt of document.querySelectorAll("dl dt")) {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === "DD") add(text(dt), text(dd));
    }
    // amazon detail tables and "label : value" bullets
    for (const tr of document.querySelectorAll("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr, table.a-keyvalue tr")) {
      add(text(tr.querySelector("th, td:first-child")), text(tr.querySelector("td:last-child")));
    }
    for (const li of document.querySelectorAll("#detailBullets_feature_div li")) {
      const [label, ...rest] = text(li).split(/\s*:\s*/);
      if (rest.length) add(label.replace(/[‎‏]/g, ""), rest.join(": ").replace(/[‎‏]/g, ""));
    }
    // any store: a short "Shipping: free over $50" line, or a section under a heading such as
    // "Shipping & returns". only for the known topics, so random "Note: …" text stays out
    // one pass over the page's text: a label is a short "Shipping:" text, its value is the rest of
    // that text or of the small element around it
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const piece = walker.currentNode.nodeValue.replace(/\s+/g, " ").trim();
      const parts = piece.match(/^([A-Za-z][A-Za-z &/'-]{2,30}):\s*(.*)$/);
      if (!parts || !FACT_GROUP.some(([, pattern]) => pattern.test(parts[1]))) continue;
      const holder = walker.currentNode.parentElement;
      if (holder?.closest("#tellr-root")) continue;
      let value = parts[2];
      for (let el = holder, depth = 0; value.length < 2 && el && depth < 2; el = el.parentElement, depth += 1) {
        const around = text(el);
        if (around.length > 300) break;
        value = around.slice(around.indexOf(piece) + piece.length).trim();
      }
      if (value.length >= 2) add(parts[1], value);
    }
    for (const heading of document.querySelectorAll("h2, h3, h4, h5, summary, button[aria-controls], [role='tab']")) {
      const title = text(heading);
      if (!title || title.length > 60 || !FACT_GROUP.some(([, pattern]) => pattern.test(title))) continue;
      const body = sectionBody(heading);
      if (body) add(title, body);
    }
    return pairs.slice(0, 40);
  }

  // the text a section heading opens: a <details> body, the panel a tab or button controls, or
  // what follows the heading up to the next heading
  function sectionBody(heading) {
    let body = "";
    if (heading.matches("summary")) {
      body = text(heading.parentElement).slice(text(heading).length);
    } else if (heading.getAttribute("aria-controls")) {
      body = text(document.getElementById(heading.getAttribute("aria-controls")));
    } else {
      for (let next = heading.nextElementSibling; next && !/^H[1-5]$/.test(next.tagName) && body.length < 400; next = next.nextElementSibling) {
        body += ` ${text(next)}`;
      }
    }
    body = body.replace(/\s+/g, " ").trim();
    // a section that holds its own "Label: value" rows is already read row by row
    return body.length >= 3 && !/^[A-Za-z][A-Za-z &/'-]{2,30}:/.test(body) ? body.slice(0, 300) : "";
  }

  // the smallest block around "positive feedback": the seller card
  function sellerCard() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!/positive( feedback)?|seller rating|sold by/i.test(walker.currentNode.nodeValue)) continue;
      let el = walker.currentNode.parentElement;
      while (el.parentElement && text(el.parentElement).length < 500) el = el.parentElement;
      if (!el.closest("#tellr-root")) return el;
    }
    return null;
  }

  function sellerFacts() {
    const card = sellerCard();
    const said = text(card);
    const facts = [];
    const name =
      text(card?.querySelector("a[href*='/usr/'], a[href*='/str/'], .x-sellercard-atf__info__about-seller a, #sellerProfileTriggerId")) ||
      said.match(/\bsold by:?\s*([^\n.,]{2,40}?)(?:\s+(?:and|ships|\d)|$)/i)?.[1] ||
      "";
    if (name) facts.push({ label: "Seller", value: name.slice(0, 50) });
    const percent = said.match(/(\d{2,3}(?:\.\d)?)\s*%\s*positive/i)?.[1];
    if (percent) facts.push({ label: "Positive feedback", value: `${percent}%` });
    const ratings = said.match(/\(\s*([\d.,]+\s*[KkMm]?)\s*\)/)?.[1] || said.match(/([\d.,]+\s*[KkMm]?)\s+(?:ratings|feedback ratings|reviews)\b/i)?.[1];
    if (ratings) facts.push({ label: "Ratings", value: ratings.replace(/\s+/g, "") });
    const sold = said.match(/([\d.,]+\s*[KkMm]?)\s+items? sold/i)?.[1];
    if (sold) facts.push({ label: "Items sold", value: sold.replace(/\s+/g, "") });
    if (/top rated/i.test(said)) facts.push({ label: "Badge", value: "Top Rated Seller" });
    const joined = said.match(/(?:joined|member since:?)\s+([A-Z][a-z]{2,8}\.?\s+\d{4}|\d{4})/i)?.[1];
    if (joined) facts.push({ label: "Joined", value: joined });
    const responds = said.match(/usually responds within\s+(\d+\s+(?:minutes?|hours?|days?))/i)?.[1];
    if (responds) facts.push({ label: "Usually responds within", value: responds });
    return facts;
  }

  // "245 sold", "12 watchers", "in 5 carts", "3 available", amazon's "1K+ bought in past month"
  function popularityFacts() {
    const root = document.querySelector("#mainContent, .x-buybox, #centerCol, #ppd, main, [role='main']") || document.body;
    const said = text(root).slice(0, 8000);
    const facts = [];
    const add = (label, match, i = 1) => {
      if (match) facts.push({ label, value: match[i].replace(/\s+/g, "") });
    };
    add("Sold", said.match(/(?<!items?\s)\b([\d,]+\+?)\s+sold\b/i));
    add("Watching", said.match(/\b([\d,]+\+?)\s+(?:watchers|watching|people are watching|have this in their watchlist)\b/i));
    add("In carts", said.match(/\b(?:in\s+)?([\d,]+\+?)\s+(?:carts|people have this in their cart|have added this to their cart)\b/i));
    add("Available", said.match(/\b([\d,]+|more than \d+)\s+available\b/i));
    add("Bought recently", said.match(/\b([\d.,]+[KkMm]?\+?)\s+bought in (?:the )?past month\b/i));
    const stars = said.match(/\b(\d(?:\.\d)?)\s+out of 5 stars\b/i);
    if (stars) facts.push({ label: "Customer rating", value: `${stars[1]} out of 5` });
    add("Customer ratings", said.match(/\b([\d,]+)\s+(?:global )?ratings\b/i));
    if (/\blast one\b|\bonly 1 left\b/i.test(said)) facts.push({ label: "Stock", value: "last one" });
    else if (/\balmost gone\b/i.test(said)) facts.push({ label: "Stock", value: "almost gone" });
    if (/money back guarantee/i.test(said)) facts.push({ label: "Protection", value: "eBay Money Back Guarantee shown on the page" });
    return facts;
  }

  // written reviews, found by their section heading ("Seller feedback", "Customer reviews"),
  // read word for word. a heading that names the seller or says "feedback" is about the seller.
  function reviewFacts() {
    const found = [];
    const seen = new Set();
    for (const heading of document.querySelectorAll("h2, h3, h4, h5, [role='heading']")) {
      const title = text(heading);
      if (!title || title.length > 60 || !/\b(feedback|reviews?)\b/i.test(title)) continue;
      const label = /\b(seller|store|shop)\b|feedback/i.test(title) ? "Seller feedback" : "Customer review";
      // the section ends at the next heading ("Care", "Shipping"), so later text isn't a review
      const nextHeading = [...document.querySelectorAll("h1, h2, h3, h4, h5, [role='heading']")].find(
        (other) => other !== heading && heading.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING && !heading.contains(other),
      );
      const inSection = (el) =>
        heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
        (!nextHeading || el.compareDocumentPosition(nextHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
      // the smallest block around the heading that holds review entries
      let section = heading.parentElement;
      let entries = [];
      for (let depth = 0; section && depth < 4 && !entries.length; depth += 1, section = section.parentElement) {
        const blocks = [...section.querySelectorAll("li, article, blockquote, p, [itemprop='review'], [data-hook='review'], [class*='comment' i]")].filter(
          (el) => !el.contains(heading) && !el.closest("#tellr-root") && inSection(el),
        );
        // the innermost blocks only, so a whole list isn't read as one review
        entries = blocks.filter((el) => !blocks.some((other) => other !== el && el.contains(other)));
        entries = entries.map((el) => text(el)).filter((said) => said.length >= 15 && said.length <= 600);
      }
      for (const said of entries) {
        if (seen.has(said) || found.length >= 8) continue;
        seen.add(said);
        found.push({ label, value: said.slice(0, 300) });
      }
    }
    return found;
  }

  // the item specifics and stated condition, as one block of text for claude. labeled as the
  // seller's own words: claude weighs them against what the photos show
  function listingDetails(facts) {
    const rows = [...facts.condition, ...facts.specifics].map((row) => `${row.label}: ${row.value}`);
    return rows.length ? `Item details as written by the seller:\n${rows.join("\n")}`.slice(0, 1500) : "";
  }

  function pageFacts() {
    const groups = { seller: sellerFacts(), popularity: popularityFacts(), condition: [], returns: [], shipping: [], payment: [], specifics: [], reviews: reviewFacts() };
    for (const pair of labelValuePairs()) {
      if (/^(seller|sold by)$/i.test(pair.label)) continue;
      const group = FACT_GROUP.find(([, pattern]) => pattern.test(pair.label))?.[0] || "specifics";
      groups[group].push(pair);
    }
    return groups;
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
    // which kind of page this is. prices can't tell: a results page also "has a price"
    // (its first result's). marketplace url shapes are reliable; elsewhere, count products.
    // several prices for one product (its price, "free shipping over $50") are still one item:
    // only different product names make a results page
    const distinctItems = new Set(products.map((p) => p.title.toLowerCase())).size;
    const pageKind = ITEM_PATH.test(location.href)
      ? "listing"
      : /\/sch\/|\/s\?|[?&](?:k|_nkw|q|query|search)=/i.test(location.href) || distinctItems > 1
        ? "results"
        : "listing";
    // where the shopper is, for "where am i" and the welcome: home, results, listing, cart, checkout
    const place = /^pay\.|^checkout\./i.test(location.hostname) || /\/(checkout|chk|gp\/buy|buy\/)/i.test(location.pathname)
      ? "checkout"
      : /\/(cart|sc|gp\/cart|basket)\b/i.test(location.pathname) || /^cart\./i.test(location.hostname)
        ? "cart"
        : location.pathname === "/" || location.pathname === ""
          ? "home"
          : pageKind;
    const params = new URLSearchParams(location.search);
    const searchQuery = (params.get("_nkw") || params.get("k") || params.get("q") || params.get("query") || "").slice(0, 80);
    // a single listing must be inspected from its own gallery only; mixing in thumbnails of
    // other products on the page would have claude inspect the wrong item
    const singleListing = pageKind === "listing";
    const imageUrls = (
      singleListing
        ? listingPhotos()
        : [...products.filter((p) => p.imageUrl).map((p) => ({ url: p.imageUrl, alt: p.title })), ...pageImages()]
    ).slice(0, 12);
    const facts = singleListing ? pageFacts() : null;
    return {
      url: location.href,
      pageKind,
      place,
      searchQuery,
      facts,
      // item specifics and stated condition as text, for questions about the item
      details: facts ? listingDetails(facts) : "",
      // the seller's own description, word for word, for "read me the description"
      sellerDescription: singleListing ? written : "",
      title,
      // on a listing, other products' titles ("similar items") would read as details of this item
      description: [written, facts && listingDetails(facts), !singleListing && catalog && `Items visible on this page:\n${catalog}`, `Page text: ${visibleText()}`]
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
