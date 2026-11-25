# Yapılacaklar

Kod `main`'de hazır (59/59 test). Aşağıdakiler canlıya geçiş ve sonraki iyileştirmeler.
Ayrıntılı adımlar: [SETUP.md](SETUP.md) · Plan: [docs/superpowers/plans](docs/superpowers/plans/2026-11-20-daily-space-carousel.md)

## 1. Canlıya geçiş (sırayla)

- [ ] Anahtarları al: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NASA_API_KEY` (SETUP.md §1)
- [ ] Meta geliştirici uygulaması aç, izinleri ekle, Instagram token'ı ve `IG_USER_ID` al (SETUP.md §2)
- [ ] Fine-grained `GH_PAT` oluştur: yalnızca bu repo, Secrets: read & write (SETUP.md §3)
- [ ] Hepsini GitHub → Settings → Secrets and variables → Actions'a ekle (SETUP.md §4)
- [ ] `daily-post` workflow'unu `dry_run` işaretli çalıştır; artifact'taki kartlara ve `content.json`'a bak
- [ ] Dry run'da şunları doğrula:
  - [ ] Claude çağrısı sorunsuz; ret (refusal) / `max_tokens` durumunda net hata veriyor
  - [ ] Gemini yedek görseli çalışıyor (`gemini-2.5-flash-image`, 3:4 oran, `inlineData` dönüyor) — büyük NASA görseli olmayan bir konuyla en az bir kez zorla
  - [ ] Kartlarda Türkçe karakterler ve fontlar CI'da da doğru
- [ ] Repoyu public yap (Instagram görselleri herkese açık URL'den çeker)
- [ ] `dry_run` işaretsiz ilk gerçek paylaşımı elle tetikle; Instagram'da ve `history.json` commit'inde kontrol et
  - Instagram `raw.githubusercontent.com` adresini reddederse: `src/git.ts` → `rawUrl`'i GitHub Pages adresine çevir, Pages'i `main`'den aç
- [ ] `refresh-ig-token` workflow'unu bir kez elle çalıştır, yeşil olduğunu gör
- [ ] Repo değişkeni `ENABLE_SCHEDULE=true` → her gün 19:00'da otomatik paylaşım başlar

## 2. Sonra yapılabilecek iyileştirmeler (acil değil)

Son incelemede "bekleyebilir" olarak işaretlenenler. Hiçbiri yanlış paylaşıma yol açmaz; çoğu sadece o günü kırmızı yapar.

- [ ] `pickTopic` kural ihlalinde (tekrar eden başlık vb.) günü düşürmek yerine 3 konu denemesi döngüsüne dahil et
- [ ] Slayt sayısı / 180 karakter hatasını da doğrulama gibi bir kez yeniden yazdır
- [ ] `withRetry`: 4xx gibi kalıcı hataları tekrar deneme; Gemini güvenlik engelinde sebebi (`finishReason`) hataya ekle
- [ ] Atlanan NASA adayları için `console.warn` ile log
- [ ] `stripHtml` HTML entity'lerini (`&amp;`, `&#39;`) çözsün
- [ ] NASA asset eşleşmesi büyük/küçük harf duyarsız olsun (`.JPG`), `~large` önce denensin (bant genişliği)
- [ ] APOD seçilip görseli küçük çıkarsa Gemini'ye düşmek yerine APOD'u aday dışı bırak
- [ ] Caption gövdesindeki `#etiket`leri de 30 sınırına say; hashtag sayısını 8–12'ye zorla
- [ ] `history.json` atomik yazılsın (geçici dosya + rename) ve okurken dizi olduğu doğrulansın
- [ ] Render'da fontların gerçekten yüklendiğini `document.fonts.check` ile doğrula
- [ ] "AI görseli" rozetini bilgi slaytındaki şeride de ekle
- [ ] Yerel dry run `GITHUB_REPOSITORY` istemesin; aynı gün tekrar çalışmada "nothing to commit" durumunu tolere et
- [ ] `package.json`'a `engines: { node: ">=24" }` ekle
- [ ] Test boşlukları: `verifyCarousel` için doğrudan test, publish'te ağ/zaman aşımı hatası testi, test geçici klasörlerini temizleme
