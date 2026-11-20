# finducosmos — Günlük Uzay Carousel Otomasyonu (Tasarım)

- **Tarih:** 2026-11-20
- **Durum:** Onaylandı (brainstorming)
- **Repo:** `mcozcn/finducosmos` (canlıya geçişte public yapılacak)

## 1. Amaç

Hobi amaçlı uzay/astronomi Instagram sayfası için her gün, insan müdahalesi olmadan,
Türkçe bir carousel (3–5 slayt) üretip Instagram'a paylaşan bir sistem.

**Başarı ölçütleri**

- Her gün 19:00 (Europe/Istanbul) civarında bir carousel yayınlanır.
- İçerikteki her bilgi bir NASA/ESA kaynak metnine dayanır; dayanmayan içerik yayınlanmaz.
- Aynı konu son 60 paylaşımda tekrar etmez.
- Hata durumunda o gün paylaşım yapılmaz ve kullanıcı e-posta ile haberdar olur.
- Aylık maliyet ~2 $ altında (Claude); diğer servisler ücretsiz katmanda.

**Kapsam dışı:** Reels/video, story, yorum yanıtlama, analitik paneli, çoklu hesap.

## 2. Mimari

GitHub Actions üzerinde çalışan Node.js + TypeScript pipeline. Sunucu yok; durum repoda tutulur.

```
daily.yml (cron 0 16 * * * UTC / workflow_dispatch[dry_run])
  └─ src/main.ts
       1. topic.ts      → konu seç (Claude) — history.json'daki son 60 konu hariç
       2. sources.ts    → NASA APOD + NASA Image Library: görsel + kaynak metin
       3. imagegen.ts   → (yedek) uygun görsel yoksa Gemini ile görsel üret
       4. write.ts      → slayt metinleri + caption (Claude, yalnızca kaynak metinden)
       5. verify.ts     → ikinci Claude çağrısı: her cümle kaynakta destekleniyor mu?
       6. render.ts     → HTML/CSS şablon → Playwright → 1080×1350 JPEG
       7. publish.ts    → commit+push görseller → raw URL → Graph API carousel publish
       8. history.ts    → history.json güncelle, posts/YYYY-MM-DD/ commit
refresh-token.yml (haftalık) → IG long-lived token yenile → GitHub Secret'a yaz
```

Her modül tek iş yapar, saf girdi/çıktı tipleriyle (`src/types.ts`) konuşur; dış API
çağrıları ince istemci fonksiyonlarında (`src/clients/*.ts`) toplanır ki testte taklit edilebilsin.

### Gizli anahtarlar (GitHub Secrets)

| Secret | Amaç |
|---|---|
| `ANTHROPIC_API_KEY` | Konu, metin, doğrulama |
| `GEMINI_API_KEY` | Yedek görsel üretimi |
| `NASA_API_KEY` | APOD (api.nasa.gov, ücretsiz) |
| `IG_USER_ID` | Instagram profesyonel hesap ID |
| `IG_ACCESS_TOKEN` | Instagram API with Instagram Login, long-lived token |
| `GH_PAT` | Fine-grained PAT, yalnızca bu repo, `secrets: write` — token yenileme için |

## 3. İçerik üretimi

### Konu seçimi
- Kategoriler: güneş sistemi · yıldızlar ve galaksiler · kara delikler · uzay görevleri ve tarih ·
  "biliyor muydun" ölçek karşılaştırmaları · günün APOD'u.
- Aynı kategori art arda iki gün seçilmez. Son 60 konu başlığı prompt'a verilir.
- Günün APOD'u (görsel tipinde ise) her gün aday olarak sunulur.
- Çıktı: `{ category, title_tr, search_query_en, use_apod: boolean }`.

### Kaynak ve görsel
- `use_apod` ise APOD görseli + `explanation` kullanılır.
- Değilse NASA Image Library'de `search_query_en` ile arama; en az 1080 px kısa kenarlı ilk
  uygun görsel ve `description` alınır. Kaynak metin < 200 karakterse sonraki sonuca geçilir.
- Görsel bulunamazsa: kaynak metin yine NASA'dan alınmak zorundadır; yalnızca görsel Gemini ile
  üretilir. Kaynak metin de bulunamazsa konu değiştirilir (en fazla 3 deneme), sonra hata.
- AI görseli kullanıldıysa kart köşesinde "AI görseli" etiketi ve caption'da not bulunur.

### Metin yazımı
- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), yapılandırılmış JSON çıktı.
- Sistem talimatı: *"Yalnızca verilen kaynak metindeki bilgileri kullan. Metinde olmayan sayı,
  tarih veya iddia ekleme."*
- Çıktı şeması:
  ```ts
  { title: string; slides: { heading?: string; body: string }[]; // 3–5, body ≤ 180 karakter
    caption: string; hashtags: string[]; sources: string[]; credit: string }
  ```
- Slayt yapısı: 1 kanca/kapak → 2–3 bilgi → 1 kapanış ("Kaydet & takip et").
- Ton: Türkçe, merak uyandıran, sade, ölçülü emoji. Hashtag 8–12, TR+EN karışık, sabit çekirdek
  set + konuya özel.

### Doğrulama
- Ayrı bir Claude çağrısı her slayt cümlesini kaynak metinle karşılaştırır:
  `{ supported: boolean, unsupported: string[] }`.
- Desteklenmeyen varsa yazım 1 kez, geri bildirimle tekrarlanır; yine geçmezse **o gün
  paylaşım yapılmaz** (workflow hata).

## 4. Kart tasarımı — Yön A "Editoryal"

- Boyut 1080×1350 (4:5), JPEG (kalite ~90, < 8 MB).
- Fontlar: **Instrument Serif** (başlık, italik vurgu) + **Inter Tight** (etiketler, alt bilgi).
  Fontlar repoya gömülür (Google Fonts'tan indirilen woff2), render ağdan bağımsızdır.
- Renk: koyu zemin `#0b0c14`, beyaz metin, vurgu sıcak krem `#f1d7a6`.
- **Kapak:** tam boy fotoğraf, alttan koyulaşan gradyan, büyük serif başlık (bir kelime italik
  krem vurgu), ince ayraç çizgisi, alt satırda kategori + "kaydır →", üstte `finducosmos` ve
  `01 / 05`.
- **Bilgi slaytı:** koyu zemin, büyük italik roma rakamı (i., ii., …), serif gövde metni,
  altta fotoğraftan kırpılmış şerit, alt satırda kaynak.
- **Kapanış:** "Kaydet & takip et" + @hesap + görsel telifi.
- Gerçek boyutta okunabilirlik: gövde ≥ 40 px, alt bilgi ≥ 26 px; metin–zemin kontrastı WCAG AA.
- Şablon: `templates/editorial/*.html` + tek CSS; veriler JSON'dan doldurulur.

## 5. Yayınlama

- Kartlar `posts/YYYY-MM-DD/01.jpg …` olarak commit+push edilir; URL
  `https://raw.githubusercontent.com/mcozcn/finducosmos/<sha>/posts/…/01.jpg` (commit'e sabit).
  **Doğrulanacak:** Instagram'ın bu URL'i kabul ettiği; etmezse aynı repoda GitHub Pages.
- Graph API (graph.instagram.com):
  1. Her görsel için `POST /{ig-user-id}/media` `is_carousel_item=true, image_url`.
  2. `POST /{ig-user-id}/media` `media_type=CAROUSEL, children=…, caption`.
  3. Container `status_code=FINISHED` olana dek bekle (≤ ~2 dk).
  4. `POST /{ig-user-id}/media_publish`.
- Caption sonu: kaynak + telif ("📷 NASA/JPL-Caltech"), AI görseli notu, hashtag'ler.

## 6. Durum ve geçmiş

- `history.json`: `[{ date, category, title, permalink?, media_id?, status: "published"|"failed"|"dry_run" }]`.
- `posts/YYYY-MM-DD/`: JPEG'ler + `content.json` (konu, kaynaklar, metinler, doğrulama sonucu).
- Bot commit'leri `github-actions[bot]` kimliğiyle; günlük commit zamanlanmış workflow'un
  60 gün hareketsizlikte devre dışı kalmasını da önler.

## 7. Hata yönetimi

- Dış çağrılar: 3 deneme, üstel bekleme.
- **Çift paylaşım koruması:** bugünün tarihi `history.json`'da `published` ise yayınlama atlanır.
- Instagram sınırları kodda doğrulanır: caption ≤ 2200 karakter, hashtag ≤ 30, 2–10 slayt,
  JPEG < 8 MB.
- Çözülemeyen hata → yayın yok, workflow kırmızı (GitHub e-postası), kartlar ve log artifact.
- Token yenileme haftalık; başarısızlıkta workflow kırmızı, süre dolmadan ~7 hafta pay.

## 8. Test

- **vitest birim:** konu tekrar filtresi, kategori rotasyonu, JSON şema doğrulama, caption/hashtag
  kuralları, çift paylaşım koruması, Graph API çağrı sırası (taklit istemci).
- **Fixture:** NASA/Claude/Gemini/Graph yanıtları kayıtlı JSON; testler ağa çıkmaz.
- **Render:** çıktı 1080×1350, JPEG, < 8 MB; görsel kontrol için örnek kartlar artifact.
- **Uçtan uca:** `workflow_dispatch` + `dry_run=true` — tüm akış, yayın yok.

## 9. Canlıya geçiş sırası

1. Kod + testler + dry-run yeşil.
2. Kullanıcı `SETUP.md`'yi izleyip secret'ları ekler.
3. Kullanıcı onayıyla repo public yapılır.
4. Kullanıcı onayıyla ilk paylaşım elle tetiklenir (dry_run=false).
5. Sonra cron etkinleşir.

## 10. Kurulum rehberi (`SETUP.md`)

Meta geliştirici uygulaması (Instagram API with Instagram Login), IG kullanıcı ID ve long-lived
token alma, NASA / Anthropic / Gemini anahtarları, fine-grained PAT, GitHub Secrets ekleme,
dry-run ile deneme.
