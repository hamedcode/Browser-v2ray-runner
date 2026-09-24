# Privacy Policy / سیاست حریم خصوصی

**Browser v2ray Runner** — last updated 2026-09-24

## English

- **No data is sent to the developer.** The extension has no servers, no
  analytics, no telemetry and no accounts.
- **Your proxy configs and subscriptions stay on your device.** They are
  stored in the browser's local extension storage and are sent only to the
  helper program running on your own computer (native messaging, localhost).
- **Network requests the extension makes on its own:**
  - Subscription URLs you add (and the default "Top 100" subscription on
    `raw.githubusercontent.com`) are downloaded to read the config list.
    Only the configs (text) are read; no code is downloaded or executed.
  - While connected, it looks up your exit IP / country through
    `api.ip.sb`, `ipwho.is` or `ipapi.co`. Those services see the IP address
    of the proxy you are connected to, like any website would.
  - Country flag images are loaded from `flagcdn.com`.
  - Speed tests request `https://www.gstatic.com/generate_204` through the
    selected proxy.
- The proxy server you choose can, of course, see your traffic. Only use
  servers you trust.
- Contact / issues: https://github.com/hamedcode/Browser-v2ray-runner/issues

## فارسی

- **هیچ داده‌ای برای توسعه‌دهنده ارسال نمی‌شود.** افزونه سرور، آنالیتیکس، تلمتری یا حساب کاربری ندارد.
- **کانفیگ‌ها و اشتراک‌های شما فقط روی دستگاه خودتان می‌مانند.** در حافظه‌ی محلی افزونه ذخیره می‌شوند و فقط به برنامه‌ی کمکی روی همان کامپیوتر (native messaging، روی localhost) داده می‌شوند.
- **درخواست‌هایی که خود افزونه می‌فرستد:**
  - دانلود لینک‌های اشتراکی که اضافه می‌کنید (و اشتراک پیش‌فرض «Top 100» از `raw.githubusercontent.com`) برای خواندن فهرست کانفیگ‌ها. فقط متن کانفیگ خوانده می‌شود و هیچ کدی دانلود یا اجرا نمی‌شود.
  - هنگام اتصال، برای نمایش آی‌پی/کشور خروجی به `api.ip.sb`، `ipwho.is` یا `ipapi.co` درخواست می‌زند. این سرویس‌ها فقط آی‌پی پروکسی‌ای را که به آن وصلید می‌بینند، مثل هر وب‌سایت دیگری.
  - عکس پرچم کشورها از `flagcdn.com` بارگذاری می‌شود.
  - تست سرعت، آدرس `https://www.gstatic.com/generate_204` را از طریق پروکسی انتخاب‌شده صدا می‌زند.
- سرور پروکسی‌ای که انتخاب می‌کنید طبیعتاً ترافیک شما را می‌بیند؛ فقط از سرورهای مورد اعتماد استفاده کنید.
- ارتباط / گزارش مشکل: https://github.com/hamedcode/Browser-v2ray-runner/issues
