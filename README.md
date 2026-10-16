# 🗼 Babil

**Tarayıcıda izlediğin her videoya canlı, çevirili altyazı. Tamamen bilgisayarında çalışır.**

*Live, fully local translated captions for any video in Chrome.*

![Babil altyazı örneği](docs/screenshot.png)

## ✨ Neler yapıyor?

- 🎧 Her sitedeki videoyu dinler: YouTube, Twitch, Kick, hepsi
- 🌍 26 dile canlı çeviri (Türkçe, İngilizce, İspanyolca, Almanca, Japonca...)
- 👀 Orijinal ve çeviri altyazı aynı anda, dil öğrenmek için birebir
- 📝 Çeviri cümle bitince bir kere gelir, okurken değişmez
- 🤫 "Um", "uh", oyun sesi, müzik ve arka plan gürültüsü altyazıya girmez
- ⚡ Cümle biter bitmez (~0.5 sn) ekranda
- 🔒 Ses bilgisayarından çıkmaz. Hesap yok, API anahtarı yok, ücret yok
- 🎨 Font, boyut, renk, arka plan istediğin gibi
- 🖥️ Tam ekranda da çalışır

## 📦 Kurulum

1. [**Releases**](https://github.com/canmenzo/babil/releases/latest) sayfasından `babil-v...zip` dosyasını indir ve klasöre çıkar
2. Chrome'da adres çubuğuna `chrome://extensions` yaz
3. Sağ üstten **Geliştirici modu**nu aç
4. **Paketlenmemiş öğe yükle** butonuna bas, çıkardığın klasörü seç (içinde `manifest.json` olan klasör)

> 💡 Eklenti ikonunu kolay bulmak için Chrome'un sağ üstündeki 🧩 simgesinden Babil'i sabitle.

### 🔔 Güncelleme

Yeni sürüm çıkınca popup haber verir (elle denetlemek için popup'ın altındaki **Güncellemeleri denetle**). Zip'i indir, mevcut Babil klasörünün üstüne çıkar, popup'taki **Babil'i yenile** butonuna bas. Ayarlar ve indirilmiş modeller korunur.

## ▶️ Kullanım

Video açıkken Babil ikonuna tıkla → **Altyazıyı başlat**. Kısayol: `Alt+Shift+T`

İlk başlatmada seçtiğin model bir kez iner (otomatik seçimde ~600 MB), sonra hep diskten açılır.

- 🗣️ Konuşulan dili biliyorsan seç, daha isabetli olur
- 🎯 Model seçimi doğruluk içindir, altyazı hızı hepsinde aynı. Ekran kartın güçlüyse **En yüksek doğruluk**
- 🔄 Dil ve model değişiklikleri altyazı açıkken anında uygulanır
- 🖱️ Altyazıyı videonun üstünde sürükleyerek taşıyabilirsin
- 🔢 Ekranda kaç cümle kalacağını popup'tan seç
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
