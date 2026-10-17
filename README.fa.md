# Price-Alert · سامانه هوشمند معاملاتی

<p align="center"><a href="README.md">English</a> · <a href="README.fa.md">فارسی</a></p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0a0a0a&height=220&section=header&text=TRADING%20ALERT%20SYSTEM&fontSize=42&fontColor=f5f2eb&fontAlignY=38&desc=Institutional%20Price%20Monitoring%20%C2%B7%20Mobile%20Alarm%20%C2%B7%20Local%20Journal%20Dossier%20%C2%B7%20AI%20Console&descFontSize=15&descColor=a39e93&descAlignY=58" width="100%" alt="سربرگ سامانه هشدار معاملات" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=16&duration=2800&pause=1000&color=D13B2F&center=true&vCenter=true&width=620&lines=Near-black+%C2%B7+Bone-white+%C2%B7+Hairline+Dossier+Design;Live+Multi-Asset+Charts+%26+Drag-to-Alert+Targeting;Serverless+Cron+Monitoring+via+Cloudflare+Workers;Telegram+%26+Bale+Instant+Visual+Chart+Dispatches;Native+Android+App+with+Urgent+Full-Screen+Audio+Alarms;100%25+Local-First+Trade+Journal+%2B+Equity+Analytics" alt="نمایش متنی متحرک" />
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Deploy-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" /></a>
  <a href="#-features"><img src="https://img.shields.io/badge/Interface-Dossier%20Paper-0a0a0a?style=for-the-badge&labelColor=e9e4d6&color=0a0a0a" /></a>
  <a href="#-android-companion-app"><img src="https://img.shields.io/badge/Android-Alarm%20App-3DDC84?style=for-the-badge&logo=android&logoColor=white" /></a>
  <a href="#-configuration--secrets"><img src="https://img.shields.io/badge/Security-HttpOnly%20%2B%20AES-3bc47a?style=for-the-badge&logo=auth0&logoColor=white" /></a>
  <img src="https://img.shields.io/badge/Node-22+-339933?style=for-the-badge&logo=node.js&logoColor=white" />
</p>

---

## ⚡ معرفی

**Price-Alert** مجموعه‌ای کاربردی و حرفه‌ای برای هوشمندی معاملات است. این سامانه با طراحی پرونده‌ای و رنگ‌های کاغذی روشن، پایش لحظه‌ای چند بازار، هشدارهای دقیق با کشیدن و رهاکردن، اعلان‌های تصویری نمودار در تلگرام و بله، اپلیکیشن موبایل با زنگ هشدار فوری، دفترچه معاملات محلی و کنسول تحلیل‌گر هوش مصنوعی را یک‌جا فراهم می‌کند.

این سامانه برای اجرا به‌صورت **کاملاً بدون‌سرور روی Cloudflare Workers** (با Durable Objectهای مبتنی بر SQLite و رندر مرورگر) یا به‌عنوان سرویس مستقل Node.js محلی طراحی شده و به پایگاه‌داده سنگین یا زیرساخت پرهزینه نیاز ندارد.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  پایش زنده              محرک‌های دقیق              هشدارهای چندکاناله       │
│  دو نمودار TradingView 15m → رسم / کشیدن هدف → اجرای مرورگر Cloudflare      │
│  طلا · ارز · CFD          موتور عبور (۱ دقیقه)       تلگرام / بله / اپ        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
┌──────────────────────────────────────┴───────────────────────────────────────┐
│  اپ اندروید همراه                               پرونده دفترچه معاملات محلی    │
│  اعلان FCM v1 و زنگ پس‌زمینه          →          کاملاً خصوصی در مرورگر       │
│  صدای تکرارشونده · تصویر تمام‌صفحه نمودار       JSON مستقل با تصاویر Base64   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ✦ قابلیت‌های اصلی

- **📊 پایش چنددارایی بازار:** دو نمودار حرفه‌ای TradingView با بازه ۱۵ دقیقه، برای طلا (`XAU/USD`)، جفت‌ارزهای اصلی (`EUR/USD`، `GBP/USD`)، رمزارز (`BTC/USD`) و شاخص‌های نقدی (`NAS100USD`، `SPX500USD`).
- **🎯 تنظیم دیداری هشدار با کشیدن:** خط هشدار را روی نمودار بکشید یا هدف عددی و شرط جهت‌دار دلخواه (`Crosses`، `Above`، `Below`) وارد کنید.
- **📸 ارسال تصویر نمودار:** مرورگر بدون رابط گرافیکی در پس‌زمینه، تصویر تمیز نمودار در حالت تیره را با سطح محرک مشخص می‌گیرد و بی‌درنگ به تلگرام و بله می‌فرستد.
- **📱 اپلیکیشن بومی هشدار موبایل:** اپلیکیشن اختصاصی اندروید (`android-app/`) با سرویس پیش‌زمینه و FCM Push v1. هنگام رسیدن قیمت به هدف، زنگ بلند و پیوسته همراه با لرزش و تصویر تمام‌صفحه نمودار پخش می‌کند.
- **📔 دفترچه معاملات محلی و خصوصی:** ثبت کامل معامله (ورود، خروج، نمودارهای چندبازه‌ای، سنجه‌های ریسک و برچسب‌های استراتژی) فقط در `localStorage` مرورگر ذخیره می‌شود. کل پرونده را به شکل یک فایل JSON مستقل، همراه با تصاویر JPEG فشرده و کدگذاری‌شده به Base64، خروجی بگیرید.
- **📈 تحلیل پیشرفته عملکرد:** نمودار سرمایه، تقویم روزانه سود و زیان، بررسی عملکرد استراتژی و تحلیل زنجیره برد و باخت.
- **🤖 کنسول هوش بازار:** محیط گفت‌وگوی تمام‌صفحه با جست‌وجوی وبِ جریانی، جمع‌بندی زنده تیترهای مالی و بررسی جهت‌گیری تکنیکال.
- **🔒 امنیت لبه‌ای با اعتماد صفر:** کوکی نشست امضاشده، HttpOnly و SameSite، محدودسازی تلاش‌های ورود و مدیریت مجزای اسرار.

---

## ◍ نمای تصویری

<div align="center">

### 00 // ورود امن به داشبورد
*صفحه ورود با هویت بصری اختصاصی، نشست رمزگذاری‌شده و محدودسازی تلاش‌های ناموفق.*

<img src="Pictures/00-login.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="ورود خصوصی به داشبورد" />

<br/><br/>

### 01 // بازارهای چنددارایی و هدف‌گذاری زنده
*دو نمودار ۱۵ دقیقه‌ای TradingView با امکان رسم تعاملی خط هشدار.*

<img src="Pictures/01-markets.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="پایش بازارها" />

<br/><br/>

### 02 // ارسال و تاریخچه هشدارها
*شرط‌های قابل تنظیم، سطح هدف، یادداشت اجرا و گزارش هشدارهای فعال.*

<img src="Pictures/02-alerts.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="مدیریت هشدارها" />

<br/><br/>

### 03 // پرونده معامله و دفترچه چندبازه‌ای
*ثبت ساختاریافته معاملات همراه با تصاویر نمودار ۱ دقیقه، ۱۵ دقیقه و ۱ ساعته.*

<img src="Pictures/03-journal.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="پرونده دفترچه معاملات" />

<br/><br/>

### 04 // تحلیل استراتژی و عملکرد سرمایه
*نقشه حرارتی سود و زیان، توزیع نرخ برد و آزمایشگاه عملکرد استراتژی.*

<img src="Pictures/04-analyze.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="تحلیل عملکرد" />

<br/><br/>

### 05 // کنسول تحلیل‌گر هوش مصنوعی
*محیط جریانی برای تیترهای اقتصاد کلان، تحلیل احساسات و بررسی جهت بازار.*

<img src="Pictures/05-ai-console.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="کنسول هوش بازار" />

<br/><br/>

<table>
<tr>
<td width="50%" align="center">

### 06 // اعلان‌های تلگرام
*ارسال فوری تصویر نمودار در حالت تیره به کانال‌های تلگرام.*

<img src="Pictures/06-telegram.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="اعلان تلگرام" />

</td>
<td width="50%" align="center">

### 07 // زنگ هشدار اپلیکیشن بومی اندروید
*هشدار تمام‌صفحه روی صفحه قفل، با صدای تکرارشونده و پیش‌نمایش نمودار.*

<img src="Pictures/07-android-app.png" width="95%" style="border-radius:6px; border:1px solid #ddd;" alt="زنگ هشدار اندروید" />

</td>
</tr>
</table>

</div>

---

## 🚀 راهنمای راه‌اندازی گام‌به‌گام

این راهنما مراحل استقرار Price-Alert روی **Cloudflare Workers** (پیشنهادشده برای اجرای بدون‌سرور و شبانه‌روزی) یا اجرای **محلی** و همچنین تنظیم **اپلیکیشن هشدار اندروید** را توضیح می‌دهد.

### گام ۱: دریافت مخزن و نصب وابستگی‌ها

ابتدا **Node.js نسخه ۲۲ یا جدیدتر** را نصب کنید:

```bash
git clone https://github.com/AkhalTeke7/Trading-Alert-System.git
cd Trading-Alert-System
npm ci
```

---

### گام ۲: تنظیم مشخصات تلگرام و کانال

برای دریافت اعلان فوری نمودار و استفاده از ربات تعاملی:

1. **ساخت ربات تلگرام:**
   - در تلگرام به [@BotFather](https://t.me/BotFather) پیام بدهید.
   - دستور `/newbot` را بفرستید، برای ربات نام انتخاب کنید و **توکن API** (`TELEGRAM_BOT_TOKEN`) را کپی کنید.
2. **پیداکردن شناسه گفتگو:**
   - به ربات خود یا [@userinfobot](https://t.me/userinfobot) پیام بدهید تا **شناسه عددی گفتگو** (`TELEGRAM_CHAT_ID`) را بگیرید.
   - برای کانال یا گروه، ربات را مدیر کنید و شناسه کانال را پیدا کنید (مثلاً `-100...`).
3. *(اختیاری) ربات پیام‌رسان بله:*
   - اگر از بله استفاده می‌کنید، `BALE_BOT_TOKEN` و `BALE_CHAT_ID` را از پدر ربات بله دریافت کنید.

---

### گام ۳: استقرار روی Cloudflare Workers

کل پشته بدون‌سرور را با اجرای خودکار بررسی‌های دقیقه‌ای، Durable Objectهای SQLite و رندر مرورگر بدون رابط گرافیکی مستقر کنید:

1. **ورود به Cloudflare:**
   ```bash
   npx wrangler login
   ```
2. **بررسی اولیه و استقرار:**
   ```bash
   npm run check:cloudflare
   npm run deploy:cloudflare
   ```
   *توجه: پس از استقرار نخست، تا زمان تنظیم اسرار زیر، Worker پاسخ HTTP 503 می‌دهد.*

---

### گام ۴: تنظیم اسرار Cloudflare

برای ثبت امن هر متغیر محرمانه در Cloudflare، دستورهای زیر را اجرا کنید (Wrangler مقدار را از شما می‌پرسد و آن را در تاریخچهٔ پوسته ذخیره نمی‌کند):

```bash
# 1. احراز هویت داشبورد (ضروری)
npx wrangler secret put DASHBOARD_USER
npx wrangler secret put DASHBOARD_PASSWORD

# 2. اعلان‌های تلگرام (برای هشدار تلگرام ضروری)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# 3. ربات تعاملی تلگرام و وب‌هوک (اختیاری)
# ساخت رشته تصادفی: openssl rand -hex 16
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# شناسه عددی کاربر شما (برای جلوگیری از استفاده غیرمجاز از ربات)
npx wrangler secret put TELEGRAM_ALLOWED_USER_IDS

# 4. اعلان‌های بله (اختیاری)
npx wrangler secret put BALE_BOT_TOKEN
npx wrangler secret put BALE_CHAT_ID

# 5. اعلان موبایل از طریق Firebase (برای اعلان فوری اندروید، اختیاری)
# کلید JSON حساب سرویس را در یک خط وارد کنید:
npx wrangler secret put FCM_SERVICE_ACCOUNT
```

#### جدول مرجع اسرار

| نام متغیر | الزامی | توضیح | نمونه / محل دریافت |
|:---|:---:|:---|:---|
| `DASHBOARD_USER` | **بله** | نام کاربری ورود به داشبورد وب | `owner` یا `trader` |
| `DASHBOARD_PASSWORD` | **بله** | گذرواژه ورود به داشبورد وب | عبارت عبور قوی |
| `TELEGRAM_BOT_TOKEN` | اختیاری | توکن API ربات تلگرام | از [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | اختیاری | شناسه مقصد تلگرام یا کانال | شناسه شخصی یا کانال `-100...` |
| `TELEGRAM_WEBHOOK_SECRET` | اختیاری | توکن محرمانه برای امن‌کردن وب‌هوک ربات | ساخت با `openssl rand -hex 16` |
| `TELEGRAM_ALLOWED_USER_IDS` | اختیاری | شناسه‌های عددی مجاز برای کنترل ربات | فهرست جداشده با کاما: `123456789` |
| `BALE_BOT_TOKEN` | اختیاری | توکن ربات پیام‌رسان بله | از پدر ربات بله |
| `BALE_CHAT_ID` | اختیاری | شناسه گفتگوی مقصد در بله | شناسه گفتگوی مقصد |
| `FCM_SERVICE_ACCOUNT` | اختیاری | فایل JSON حساب سرویس Firebase برای FCM HTTP v1 | Firebase Console → Service Accounts |

#### کلیدهای کنسول هوش مصنوعی و جست‌وجوی وب (اختیاری)

این کلیدها از داخل سایت تنظیم می‌شوند، نه با Wrangler و نه در فایل `.env`. کانال داخلی **Demo** به کلید نیاز ندارد؛ برای پاسخ زندهٔ هوش مصنوعی، از یکی از سرویس‌دهنده‌ها کلید بگیرید:

1. از داشبورد **AI** را باز کنید و سپس **Settings** را بزنید (در استقرار Cloudflare ابتدا وارد داشبورد شوید).
2. **گفت‌وگوی هوش مصنوعی:** از یکی از سرویس‌دهنده‌ها کلید API بسازید—[OpenAI](https://platform.openai.com/api-keys)، [Anthropic](https://console.anthropic.com/settings/keys)، [Google Gemini](https://aistudio.google.com/app/apikey)، [Mistral](https://console.mistral.ai/api-keys)، [Groq](https://console.groq.com/keys) یا یک سرویس سازگار با OpenAI. کارت سرویس‌دهنده را باز کنید، کلید را وارد کنید و **Save key → Test → Use in chat** را بزنید. مدل پیش‌فرض از قبل وارد شده است؛ در صورت نیاز آن را تغییر دهید.
3. **جست‌وجوی وب:** یک [کلید API از Tavily](https://app.tavily.com/home) بسازید، کارت **Tavily Search** را باز کنید، کلید را وارد کنید و **Save key → Test** را بزنید. این کلید اختیاری است؛ بدون آن، ابزار `web_search` از DuckDuckGo بدون کلید استفاده می‌کند.

کلیدها فقط سمت سرور نگهداری می‌شوند و مرورگر صرفاً پیش‌نمایش ماسک‌شده را می‌بیند. در استقرار Cloudflare، کلیدها در Durable Object و در اجرای محلی Node.js در فایل نادیده‌گرفته‌شدهٔ `data/ai-settings.json` ذخیره می‌شوند؛ این فایل محرمانه است و آن را به اشتراک نگذارید یا وارد Git نکنید. محدودیت مصرف و هزینه‌های هر سرویس‌دهنده را بررسی کنید.

---

### گام ۵: ثبت وب‌هوک تلگرام

پس از فعال‌شدن Cloudflare Worker و تنظیم اسرار، وب‌هوک را ثبت کنید:

1. از `.env.example` یک کپی به نام `.env` بسازید:
   ```bash
   cp .env.example .env
   ```
2. فایل `.env` را با نشانی استقرار و مشخصات خود ویرایش کنید:
   ```ini
   WORKER_URL=https://trading-alert-system.<your-subdomain>.workers.dev
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_WEBHOOK_SECRET=your_telegram_webhook_secret
   ```
3. اسکریپت ثبت وب‌هوک را اجرا کنید:
   ```bash
   npm run telegram:webhook
   ```

---

### گام ۶: راه‌اندازی اپلیکیشن همراه اندروید

اپلیکیشن بومی اندروید با Kotlin در (`android-app/`) کمک می‌کند حتی هنگام خاموش یا قفل‌بودن تلفن، هیچ محرک قیمتی را از دست ندهید.

1. **بازکردن پروژه:**
   - Android Studio را اجرا و پوشهٔ `android-app/` را باز کنید.
   - منتظر همگام‌سازی Gradle بمانید (`minSdk 26`، `compileSdk 34`).
2. **اتصال به سرور:**
   - نشانی Cloudflare Worker مستقرشده (مثلاً `https://trading-alert-system.<subdomain>.workers.dev`) یا IP شبکهٔ محلی خود (مانند `http://192.168.x.x:3000`) را وارد کنید.
   - `DASHBOARD_USER` و `DASHBOARD_PASSWORD` را وارد کنید.
3. **زنگ هشدار و بررسی دوره‌ای:**
   - اپ در پس‌زمینه با یک سرویس پیش‌زمینه، مسیر `/api/triggered` را بررسی می‌کند و اعلان‌های فوری FCM را نیز دریافت می‌کند.
   - با رسیدن قیمت به هدف، صدای بلند هشدار به‌طور پیوسته پخش می‌شود، دستگاه می‌لرزد و صفحهٔ تمام‌صفحهٔ نمودار با دکمهٔ برجستهٔ **STOP SOUND** نمایش داده می‌شود.

---

### گام ۷: روش جایگزین — اجرای محلی با Node.js

اگر می‌خواهید کل سامانه را روی رایانه یا VPS خود اجرا کنید:

1. مشخصات خود را در `.env` وارد کنید:
   ```bash
   cp .env.example .env
   ```
2. برنامه را اجرا کنید:
   ```bash
   npm start
   ```
3. در پنجره‌های جداگانهٔ ترمینال، پایش قیمت و در صورت تمایل ربات تلگرام را اجرا کنید:
   ```bash
   npm run prices
   npm run telegram
   ```
4. داشبورد را در `http://localhost:3000` باز کنید.

---

## 🛡️ معماری و مالکیت داده

- **وضعیت پایدار:** Durable Object مبتنی بر SQLite در Cloudflare (`AlertStore`) وضعیت هشدارهای در انتظار را پس از راه‌اندازی مجدد Worker حفظ می‌کند.
- **مرورگر بدون‌سرور:** Cloudflare Browser Run بدون نیاز به سرویس دائمی Chrome، تصویر نمودار را هنگام نیاز ثبت می‌کند.
- **پرونده معامله در سمت کاربر:** تصاویر معاملات و یادداشت‌های دفترچه در `localStorage` مرورگر ذخیره می‌شوند. هیچ‌کدام از داده‌های دفترچه یا سابقهٔ معاملات شخصی به پایگاه‌دادهٔ راه‌دور ارسال نمی‌شوند. فایل‌های خروجی JSON در سمت کاربر و همراه با تصاویر Base64 فشرده ساخته می‌شوند.

---

<p align="center">
  <sub style="color:#8b877b; font-family: JetBrains Mono, monospace; font-size:12px">
    سامانه هشدار معاملات · رابط پرونده‌ای حرفه‌ای · مجوز MIT / ISC
  </sub>
</p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0a0a0a&height=90&section=footer" width="100%" alt="پابرگ" />
</p>
