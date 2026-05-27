# discord dm temizleyici

bu proje, discord hesabinizdaki dm mesajlarinizi toplu ve hizli bir sekilde silmenizi saglayan bir aractir. hem komut satiri (cli) hem de web arayuzu (dashboard) uzerinden calisabilir.

## ozellikler

- <span style="color:#4fc3f7">es zamanli silme</span>: birden fazla kullanici ile olan mesaj gecmisinizi ayni anda ve paralel olarak temizler.
- <span style="color:#81c784">kullanici detaylari</span>: sadece id degil, discord ekran adini ve gercek kullanici adini da gosterir.
- <span style="color:#ffb74d">canli izleme paneli</span>: silme islemini tarayicinizdan anlik olarak takip edebilirsiniz.
- <span style="color:#e57373">gunluk temizleme</span>: paneldeki gecmis temizleme islemlerine ait loglari tek tusla silebilirsiniz.

## kurulum

1. bagimli kutuphaneleri yukleyin:
   ```bash
   npm install
   ```

2. discord tokeninizi cevre degiskeni (env) olarak ayarlayin:
   ```bash
   export discord_token="tokeniniz"
   ```

## kullanim

### web arayuzu (dashboard)

sunucuyu baslatmak icin:
```bash
node server.js
```
tarayicinizdan http://localhost:3000 adresine giderek dmleri temizleyebilirsiniz.

### komut satiri (cli)

cli araci ile dogrudan konsoldan temizlik yapmak icin:
```bash
node bot.js
```
konsoldaki yonergeleri takip ederek tokeninizi ve kullanici idlerini girin.
