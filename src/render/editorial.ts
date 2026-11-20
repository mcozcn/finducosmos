import { ACCOUNT_HANDLE } from "../config.js";
import { CATEGORY_LABEL_TR, type CarouselContent, type Category } from "../types.js";

export interface RenderInput {
  content: CarouselContent;
  category: Category;
  credit: string;
  image: Buffer;
  aiImage: boolean;
}

const ROMAN = ["i", "ii", "iii", "iv", "v"];

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape, then turn *word* into <em>word</em>. */
export function emphasize(s: string): string {
  return escapeHtml(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Font CSS files are linked by absolute file:// URL so Chromium loads latin + latin-ext (Turkish) subsets. */
const FONT_CSS = [
  "@fontsource/instrument-serif/400.css",
  "@fontsource/instrument-serif/400-italic.css",
  "@fontsource/inter-tight/400.css",
  "@fontsource/inter-tight/500.css",
].map((p) => import.meta.resolve(p));

const STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1080px;height:1350px;background:#0b0c14;color:#fff;overflow:hidden}
  .slide{position:relative;width:1080px;height:1350px;overflow:hidden}
  .photo{position:absolute;inset:0;background:center/cover no-repeat url("bg.jpg")}
  .shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(3,4,10,.94) 0%,rgba(3,4,10,.55) 38%,rgba(3,4,10,0) 70%)}
  .top{position:absolute;top:56px;left:64px;right:64px;display:flex;justify-content:space-between;
       font:500 28px/1 'Inter Tight';letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.86)}
  .badge{position:absolute;top:112px;right:64px;font:500 24px/1 'Inter Tight';letter-spacing:.12em;
         text-transform:uppercase;padding:12px 18px;border:1.5px solid rgba(255,255,255,.6);border-radius:999px;background:rgba(3,4,10,.5)}
  h1{position:absolute;left:64px;right:64px;bottom:196px;font:400 118px/1.0 'Instrument Serif';letter-spacing:-.01em}
  em{font-style:italic;color:#f1d7a6}
  .rule{position:absolute;left:64px;right:64px;bottom:140px;border-top:2px solid rgba(255,255,255,.4)}
  .foot{position:absolute;left:64px;right:64px;bottom:72px;display:flex;justify-content:space-between;
        font:400 28px/1 'Inter Tight';color:rgba(255,255,255,.82)}
  .num{position:absolute;top:168px;left:64px;font:italic 400 200px/1 'Instrument Serif';color:#f1d7a6}
  .heading{position:absolute;top:410px;left:64px;right:80px;font:500 30px/1.2 'Inter Tight';letter-spacing:.14em;text-transform:uppercase;color:#f1d7a6}
  .body{position:absolute;top:470px;left:64px;right:80px;font:400 64px/1.28 'Instrument Serif'}
  .strip{position:absolute;left:64px;right:64px;bottom:196px;height:300px;border-radius:8px;background:center/cover no-repeat url("bg.jpg")}
  .close-title{position:absolute;left:64px;right:64px;top:420px;font:400 132px/1.0 'Instrument Serif'}
  .close-sub{position:absolute;left:64px;right:64px;top:720px;font:400 40px/1.4 'Inter Tight';color:rgba(255,255,255,.86)}
`;

function page(body: string): string {
  const links = FONT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">${links}<style>${STYLE}</style></head><body><div class="slide">${body}</div></body></html>`;
}

export function slideHtml(kind: "cover" | "info" | "closing", input: RenderInput, index: number, total: number): string {
  const top = `<div class="top"><span lang="en">finducosmos</span><span>${pad(index + 1)} / ${pad(total)}</span></div>`;
  const credit = escapeHtml(input.credit);

  if (kind === "cover") {
    return page(`
      <div class="photo"></div><div class="shade"></div>${top}
      ${input.aiImage ? `<div class="badge">AI görseli</div>` : ""}
      <h1>${emphasize(input.content.title)}</h1>
      <div class="rule"></div>
      <div class="foot"><span>${escapeHtml(CATEGORY_LABEL_TR[input.category])}</span><span>kaydır →</span></div>`);
  }

  if (kind === "info") {
    const slide = input.content.slides[index - 1];
    return page(`
      ${top}
      <div class="num">${ROMAN[index - 1]}.</div>
      ${slide.heading ? `<div class="heading">${escapeHtml(slide.heading)}</div>` : ""}
      <div class="body">${emphasize(slide.body)}</div>
      <div class="strip"></div>
      <div class="rule"></div>
      <div class="foot"><span>📷 ${credit}</span><span>→</span></div>`);
  }

  return page(`
    <div class="photo" style="opacity:.35"></div>${top}
    <div class="close-title">Kaydet &amp; <em>takip et</em></div>
    <div class="close-sub">Her gün evrenden bir hikâye.<br>${escapeHtml(ACCOUNT_HANDLE)}</div>
    <div class="rule"></div>
    <div class="foot"><span>📷 ${credit}</span><span>Kaynak: NASA</span></div>`);
}
