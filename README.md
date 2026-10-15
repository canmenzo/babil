# 🗼 Babil

**Tarayıcıda izlediğin her videoya canlı, çevirili altyazı. Tamamen bilgisayarında çalışır.**

*Live, fully local translated captions for any video in Chrome.*

![Babil altyazı örneği](docs/screenshot.png)

## ✨ Neler yapıyor?

- 🎧 Her sitedeki videoyu dinler: YouTube, Twitch, Kick, hepsi
- 🌍 26 dile canlı çeviri (Türkçe, İngilizce, İspanyolca, Almanca, Japonca...)
- 👀 Orijinal ve çeviri altyazı aynı anda, dil öğrenmek için birebir
- ⚡ Konuşmadan 1 saniye bile geçmeden ekranda
- 🔒 Ses bilgisayarından çıkmaz. Hesap yok, API anahtarı yok, ücret yok
- 🎨 Font, boyut, renk, arka plan istediğin gibi
- 🖥️ Tam ekranda da çalışır

## 📦 Kurulum

1. [**Releases**](https://github.com/canmenzo/babil/releases/latest) sayfasından `babil-v0.2.0.zip` dosyasını indir ve klasöre çıkar
2. Chrome'da adres çubuğuna `chrome://extensions` yaz
3. Sağ üstten **Geliştirici modu**nu aç
4. **Paketlenmemiş öğe yükle** butonuna bas, çıkardığın `babil-v0.2.0` klasörünü seç (içinde `manifest.json` olan klasör)
5. Açılan sayfada dilleri seç, **Modelleri şimdi indir**e bas (bir kerelik, ~250 MB)

> 💡 Eklenti ikonunu kolay bulmak için Chrome'un sağ üstündeki 🧩 simgesinden Babil'i sabitle.

## ▶️ Kullanım

Video açıkken Babil ikonuna tıkla → **Altyazıyı başlat**. Kısayol: `Alt+Shift+T`

- 🗣️ Konuşulan dili biliyorsan seç, daha isabetli olur
- 🖱️ Altyazıyı videonun üstünde sürükleyerek taşıyabilirsin
- ⚙️ Görünüm ayarları popup'taki **Altyazı görünüm ayarları** linkinde

## 💻 Gereksinimler

- Masaüstü Chrome 138 veya üstü
- Ekran kartı önerilir (yoksa da çalışır, biraz yavaş)

## 🛠️ Geliştirici

```
npm install
npm run build   # çıktı: dist/
```

Whisper (transformers.js, WebGPU) sesi yazıya döker, Chrome'un cihaz içi Translator API'si çevirir. Manifest V3, offscreen belge.

## 📄 Lisans

MIT
