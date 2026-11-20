# finducosmos

Her gün NASA kaynaklı, Türkçe bir uzay carousel'i üretip Instagram'a paylaşan GitHub Actions otomasyonu.

- Konu ve metin: Claude · Görsel: NASA APOD / NASA Image Library (yoksa Gemini) · Kart: Playwright
- Her bilgi NASA kaynak metniyle doğrulanır; doğrulanamazsa o gün paylaşım yapılmaz.
- Paylaşılan her gün `posts/YYYY-MM-DD/` altında, geçmiş `history.json` içinde.

Kurulum: [SETUP.md](SETUP.md) · Tasarım: [docs/superpowers/specs](docs/superpowers/specs)

```bash
npm ci && npx playwright install chromium
npm test
DRY_RUN=true GITHUB_REPOSITORY=mcozcn/finducosmos ANTHROPIC_API_KEY=… GEMINI_API_KEY=… NASA_API_KEY=… npm run post
```
