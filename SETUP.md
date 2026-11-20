# Kurulum

Bu rehber bir kez yapılır. Sıra önemlidir.

## 1. Anahtarları al

| Secret | Nereden |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `NASA_API_KEY` | api.nasa.gov → Generate API Key (ücretsiz) |

## 2. Instagram API (Instagram Login)

1. Hesabın Creator veya Business olmalı (Ayarlar → Hesap türü).
2. developers.facebook.com → **Uygulama oluştur** → kullanım: "Diğer" → tür: **Business**.
3. Uygulamaya **Instagram** ürününü ekle → "API setup with Instagram login".
4. "Generate access tokens" bölümünde Instagram hesabını ekle ve **token oluştur**. Bu kısa ömürlü değil, 60 günlük uzun ömürlü token'dır; kopyala.
5. İzinler: `instagram_business_basic`, `instagram_business_content_publish`.
6. IG kullanıcı ID'ni al:
   ```bash
   curl "https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=TOKEN"
   ```
   Dönen `user_id` → `IG_USER_ID`. Token → `IG_ACCESS_TOKEN`.
7. Uygulama "Development" modunda kalabilir; kendi hesabına paylaşım için yeterlidir.

## 3. Token yenileme için PAT

github.com/settings/personal-access-tokens → **Fine-grained token** → yalnızca `finducosmos` reposu → Repository permissions → **Secrets: Read and write**. Süreyi 1 yıl seç; dolmadan yenile. → `GH_PAT`.

## 4. Secret'ları ekle

Repo → Settings → Secrets and variables → Actions → **New repository secret**: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `NASA_API_KEY`, `IG_USER_ID`, `IG_ACCESS_TOKEN`, `GH_PAT`.

## 5. Deneme (paylaşmaz)

Actions → **daily-post** → Run workflow → `dry_run` işaretli → çalıştır. Bitince **Artifacts** altındaki `carousel-…` zip'ini indir, kartlara bak.

## 6. Repoyu public yap

Instagram görselleri herkese açık URL'den çeker. Settings → General → Danger Zone → Change visibility → Public. (Secret'lar görünmez.)

## 7. İlk gerçek paylaşım

Actions → daily-post → Run workflow → `dry_run` **işaretsiz**. Instagram'da gönderiyi kontrol et.

## 8. Günlük otomasyonu aç

Settings → Secrets and variables → Actions → **Variables** → `ENABLE_SCHEDULE` = `true`. Artık her gün 19:00'da paylaşır. Kapatmak için `false` yap.

## Sorun giderme

- Workflow kırmızıysa GitHub e-posta atar; o gün paylaşım yapılmamıştır. Logda hangi adımın düştüğü yazar.
- "failed fact verification" → içerik kaynakla uyuşmadı; bilerek paylaşılmadı. Elle tekrar çalıştırabilirsin.
- Token hatası → Actions → refresh-ig-token → Run workflow. O da düşerse 2. adımı tekrarla.
- Çalıştırma, tarih, `mediaId`, permalink ve history girdisi JSON'unu içeren bir `::error::` notuyla kırmızı bittiyse gönderi Instagram'da YAYINDADIR; yalnızca `history.json` push'u başarısız olmuştur. O JSON girdisini `history.json` dosyasına elle ekleyip commit et; yoksa bir sonraki çalıştırma aynı günü tekrar paylaşabilir.
