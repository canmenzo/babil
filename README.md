# Babil

**Live, fully local captions and translation for any video in Chrome.** Babil listens to the tab's audio, transcribes it with Whisper on your GPU and translates it with Chrome's on-device translator. Original and translated captions can be shown together. No server, no API key, the audio never leaves your machine.

Tarayıcıda oynayan herhangi bir videonun (YouTube, Twitch, Kick, herhangi bir site) sesini **tamamen lokal** olarak yazıya döker ve canlı çevirir. Sunucu yok, API anahtarı yok; ses bilgisayardan çıkmaz.

- Konuşma tanıma: Whisper (transformers.js, WebGPU; GPU yoksa WASM)
- Çeviri: Chrome'un yerleşik, cihaz içi Translator API'si; 26 hedef dil
- Orijinal dil + çeviri altyazı aynı anda (dil öğrenmek için)
- Düşük gecikme: kısmi altyazı konuşmadan ~0.6-0.8 sn sonra ekranda, cümle bitince kesinleşir
- Tam ekranda ve gömülü (iframe) oynatıcılarda çalışır, altyazı sürüklenerek taşınabilir
- Her iki satır için ayrı font, boyut, renk, arka plan, opaklık; kenar stili, konum, süre ayarları

## Kurulum

```
npm install
npm run build
```

Chrome → `chrome://extensions` → Geliştirici modu → **Paketlenmemiş öğe yükle** → `dist` klasörü.

Gereken: masaüstü Chrome 138+. Kurulumda açılan **Hazırlık** bölümünden dilleri seçip modelleri önceden indirebilirsiniz (Whisper small ~250 MB, çeviri modeli dil çifti başına). Sonrasında her şey önbellekten açılır.

## Kullanım

Videonun olduğu sekmede eklenti ikonu → **Altyazıyı başlat** (veya `Alt+Shift+T`).

- **Konuşulan dil**: biliniyorsa seçin. Otomatik algılama Whisper'ın kendi dil tespitini kullanır.
- **Çeviri dili**: Türkçe, İngilizce, İspanyolca, Fransızca, Almanca, Arapça, Çince, Japonca, Korece, Rusça, Hintçe ve diğerleri.
- **Model**: Otomatik seçim GPU varsa `small`, yoksa `base` kullanır. `turbo` en iyi kalite.
- Otomatik modda yeni bir dil algılanırsa popup o dilin çeviri modelini indirmek için bir buton gösterir (Chrome model indirmeyi yalnızca kullanıcı tıklamasıyla başlatıyor).

## Ölçümler

NVIDIA ekran kartlı bir Windows makinede, Chrome 155:

| Model | Tanıma süresi (ort.) | Not |
| --- | --- | --- |
| base | ~200 ms | kısa ifadelerde hata yapabiliyor |
| small | ~250 ms | varsayılan |
| turbo | ~360 ms | en isabetli, ~700 MB |

Çeviri ~10 ms. Açık segment her 0.6 sn'de yeniden tanınır, 0.3 sn duraksamada veya en geç 5 sn'de kesinleşir.

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
                                       offscreen: Translator API (kaynak → hedef)
                                                              │
service worker ──▶ content script (popover katmanı, shadow DOM) ◀┘
```

| Dosya | Görev |
| --- | --- |
| `src/background.js` | Offscreen belge yaşam döngüsü, mesaj yönlendirme, kısayol |
| `src/offscreen.js` | Ses yakalama, segmentleme, ASR kuyruğu, çeviri, yayın jargonu düzeltmesi |
| `src/asr-worker.js` | Whisper yükleme ve çıkarım |
| `src/worklet.js` | 16 kHz mono, 100 ms çerçeveler |
| `src/content.js` | Video üstü altyazı katmanı |
| `src/settings.js` | Varsayılanlar, dil listeleri, paylaşılan altyazı CSS'i |
| `src/popup.js`, `src/options.js` | Arayüz ve model hazırlığı |

Gecikme ayarları `src/offscreen.js` başındaki sabitlerde.

## Bilinen sınırlar

- Chrome çevirisi cümleyi bağlamsız görür. İngilizce yayın jargonu ("stream", "streamer", "subs") çeviriden önce düzeltiliyor; başka argo hâlâ kelimesi kelimesine çevrilebilir.
- Aynı anda tek sekme.
- Arayüz şimdilik Türkçe.

## Lisans

MIT
