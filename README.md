# Canlı Altyazı TR

Tarayıcıda oynayan herhangi bir videonun (YouTube, Twitch, Kick, herhangi bir site) sesini **tamamen lokal** olarak yazıya döker ve Türkçeye çevirir. Sunucu yok, API anahtarı yok; ses bilgisayardan çıkmaz.

- Konuşma tanıma: Whisper (transformers.js, WebGPU; GPU yoksa WASM)
- Çeviri: Chrome'un yerleşik, cihaz içi Translator API'si
- Orijinal dil + Türkçe altyazı aynı anda (dil öğrenmek için)
- Düşük gecikme: kısmi altyazı konuşmadan ~0.6-0.8 sn sonra ekranda, cümle bitince kesinleşir
- Tam ekranda da çalışır, altyazı sürüklenerek taşınabilir
- Ayrı ayrı font, boyut, renk, arka plan, opaklık, kenar stili ayarları

## Kurulum

```
npm install
npm run build
```

Chrome → `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe yükle** → `dist` klasörü.

Gereken: Chrome 138+ (masaüstü). İlk başlatmada Whisper modeli (~90 MB, base) ve Chrome'un İngilizce→Türkçe çeviri modeli indirilir, sonra önbellekten açılır.

## Kullanım

Videonun olduğu sekmede eklenti ikonu → **Altyazıyı başlat** (veya `Alt+Shift+T`).

- **Konuşulan dil**: biliniyorsa seçin (ör. İngilizce). Otomatik algılama da çalışır ama sabit dil daha isabetli.
- **Model**: `base` gerçek zamanlı için önerilen. GPU güçlüyse `small` daha isabetli; `turbo` en iyi kalite ama en yavaş.
- Otomatik modda yeni bir dil algılanırsa popup o dilin çeviri modelini indirmek için bir buton gösterir (Chrome model indirmeyi yalnızca kullanıcı tıklamasıyla başlatıyor).

## Mimari

```
popup ── tabCapture.getMediaStreamId ──▶ service worker ──▶ offscreen belge
                                                              │  sekme sesi → hoparlöre geri çalınır
                                                              │  16 kHz AudioWorklet → enerji tabanlı VAD
                                                              │  açık segment her 0.6 sn'de (kısmi),
                                                              │  0.3 sn duraksamada / 5 sn'de (kesin)
                                                              ▼
                                                          asr-worker (Whisper, WebGPU)
                                                              │  tek geçişte dil algılama + transkripsiyon
                                                              ▼
                                       offscreen: Translator API (kaynak → tr)
                                                              │
service worker ──▶ content script (popover katmanı, shadow DOM) ◀┘
```

| Dosya | Görev |
| --- | --- |
| `src/background.js` | Offscreen belge yaşam döngüsü, mesaj yönlendirme, kısayol |
| `src/offscreen.js` | Ses yakalama, segmentleme, ASR kuyruğu, çeviri |
| `src/asr-worker.js` | Whisper yükleme ve çıkarım |
| `src/worklet.js` | 16 kHz mono, 100 ms çerçeveler |
| `src/content.js` | Video üstü altyazı katmanı |
| `src/settings.js` | Varsayılanlar ve paylaşılan altyazı CSS'i |
| `src/popup.js`, `src/options.js` | Arayüz |

Gecikme ayarları `src/offscreen.js` başındaki sabitlerde.

## Bilinen sınırlar

- Chrome çevirisi bağlamsız: "stream" gibi kelimeler bazen "akış" çıkıyor.
- Video çapraz kökenli bir iframe içindeyse altyazı videoya değil pencerenin altına yerleşir.
- Aynı anda tek sekme.

## Sıradaki adımlar

- Diğer hedef diller (şu an hedef `tr` sabit)
- Önceki cümleyi Whisper'a bağlam olarak vermek (kısa segmentlerde isabet)
- Yayın jargonu için küçük bir sözlük düzeltmesi
