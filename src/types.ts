export const CATEGORIES = [
  "solar_system",
  "stars_galaxies",
  "black_holes",
  "missions_history",
  "scale",
  "apod",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL_TR: Record<Category, string> = {
  solar_system: "Güneş Sistemi",
  stars_galaxies: "Yıldızlar & Galaksiler",
  black_holes: "Kara Delikler",
  missions_history: "Görevler & Tarih",
  scale: "Ölçek",
  apod: "Günün Görüntüsü",
};

export interface HistoryEntry {
  date: string; // YYYY-MM-DD, Europe/Istanbul
  category: Category;
  title: string;
  status: "published";
  mediaId: string;
  permalink?: string;
}

export interface TopicChoice {
  category: Category;
  titleTr: string;
  searchQueryEn: string;
  useApod: boolean;
}

export interface SourceMaterial {
  text: string; // NASA's own description, plain text
  sourceUrl: string;
  credit: string; // e.g. "NASA/JPL-Caltech"
  image: Buffer | null; // null => needs AI fallback image
}

export interface Slide {
  heading?: string;
  body: string;
}

export interface CarouselContent {
  title: string; // cover headline; one word may be wrapped in *asterisks* for italic accent
  slides: Slide[]; // 2–3 info slides (cover and closing are added by the renderer)
  caption: string; // body text only; credits and hashtags are appended by buildCaption
  hashtags: string[]; // without '#'
}
