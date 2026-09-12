# Spoon — eSIM Go Travel API v2.5 mock

`esim-go.com` API'sinin **v2.5 sürümünün stateful mock'u**. Gerçek bir eSIM
sağlayıcısı gibi davranır: sipariş alır, eSIM provision eder, bundle atar, veri
tüketimini simüle eder, bundle'ları süresi dolunca expire eder, atıl eSIM'leri
siler ve bütün bunlar için webhook (callback) gönderir.

- **Dil / stack:** JavaScript (Node.js ≥ 20.11, ESM) + Fastify 5. Derleme adımı
  yok, tek bağımlılık seti, `node src/index.js` ile çalışır.
- **Kaynak:** [eSIM Go v2.5 OpenAPI dokümanı](https://docs.esim-go.com/api/v2_5/)
  (`openapi/esim_go_schema_v2_5.yaml` olarak repoda), Notifications API ve
  resmi guide sayfaları (rate limits, bundle status, suspend/unsuspend, eSIM
  lifecycle, webhooks, QR delivery, balance, branding).
- **Port:** varsayılan **4010** (`PORT` ile değiştirilir). 3000 bilinçli olarak
  boş bırakıldı.

## Hızlı başlangıç

```bash
npm install
npm start                      # http://localhost:4010/v2.5
npm test                       # 87 test, ağ/port gerekmez (fastify inject)
./examples/quickstart.sh       # uçtan uca senaryo (sipariş → kurulum → tüketim)
```

```bash
curl http://localhost:4010/v2.5/organisation -H 'X-API-Key: esimgo-mock-key'
```

Kimlik doğrulama gerçeğiyle aynı: her istekte `X-API-Key` header'ı (header adı
case-insensitive). Eksik/yanlış key → **403** `{"message":"Forbidden"}`.
Varsayılan key `esimgo-mock-key`, `API_KEYS` ile değiştirilir.

## Desteklenen endpoint'ler

v2.5'teki **bütün** operasyonlar mevcut (deprecated olanlar dahil).

### eSIMs
| Method | Path | Not |
|---|---|---|
| GET | `/esims` | `page`, `perPage` (10/25/50/100), `orderBy=iccid`, `direction`, `filterBy`, `filter` |
| PUT | `/esims` | `iccid` + `customerRef` (query ya da JSON body) |
| POST | `/esims/apply` | Tek bundle + `iccid`, ya da `bundles[]` listesi; `repeat`, `allowReassign` |
| GET | `/esims/assignments` | `reference`; `Accept` başlığına göre **JSON / CSV / ZIP(QR)**, `additionalFields=installUrl` |
| GET | `/esims/{iccid}` | `additionalFields=installUrl` → Apple/Android tek-tık kurulum linkleri |
| DELETE | `/esims/{iccid}` | eSIM'i deaktive eder |
| GET | `/esims/{iccid}/history` | Dokümandaki lifecycle olayları, en yenisi başta |
| GET | `/esims/{iccid}/refresh` | Profili cihaza yeniden push eder |
| GET | `/esims/{iccid}/compatible/{bundle}` | Network profile eşleşmesi |
| POST | `/esims/{iccid}/sms` | `message` (1–160, UTF-8), `from` (varsayılan `eSIM`) |
| GET | `/esims/{iccid}/bundles` | `includeUsed`, `limit` (1–200, varsayılan 15) |
| GET | `/esims/{iccid}/bundles/{name}` | Bundle'ın bütün assignment'ları |
| DELETE | `/esims/{iccid}/bundles/{name}` | `type=validate\|transaction`, `refundToBalance`, `offerId` |
| DELETE | `/esims/{iccid}/bundles/{name}/assignments/{assignmentId}` | Tek assignment revoke |
| POST | `/esims/{iccid}/suspend` | `{"suspend":true\|false}` → **201** |
| GET | `/esims/{iccid}/suspend` | Mevcut suspend durumu |
| GET | `/esims/{iccid}/location` | Son görülen network/ülke |

### Orders, Inventory, Organisation, Catalogue, Networks
| Method | Path | Not |
|---|---|---|
| GET | `/orders` | `includeIccids`, `page`, `limit`, `createdAt=lte:…\|gte:…` |
| POST | `/orders` | `type=validate` fiyatlar, `type=transaction` bakiyeden düşer; `assign`, `profileID` |
| GET | `/orders/{orderReference}` | eSIM detaylarıyla |
| GET | `/inventory` | Bundle bazında batch'ler (`usageId`, `total`, `remaining`, `expiry`) |
| POST | `/inventory/refund` | `usageId` + `quantity` → bakiyeye iade |
| GET | `/organisation` | Bakiye, test credit, kullanıcılar, gruplar |
| POST | `/organisation/balance` | `amount` (query ya da body) → kayıtlı karttan yükleme |
| GET | `/organisation/groups` | Organizasyonun bundle grupları |
| GET | `/catalogue` | `page`, `perPage`, `orderBy`, `direction`, `description`, `group`, `countries`, `region` |
| GET | `/catalogue/bundle/{name}` | Tek bundle (isimler **case sensitive**) |
| GET | `/catalogue/prices` | Consumption fiyat listesi + `hash` |
| GET | `/networks` | `countries` (isim), `isos` (ISO2), `returnAll` |

### Deprecated (çalışır, yanıtta `Deprecation: true` header'ı ile)
| Method | Path |
|---|---|
| GET | `/esims/qr/{reference}` |
| GET | `/esims/csv/{reference}` |
| POST | `/esims/{iccid}/bundles` |
| DELETE | `/esims/{iccid}/bundles/{name}/applications/{assignmentId}` |

## Neleri gerçeğe uygun taklit ediyor

**Hata zarfı.** Her hata `{"message": "..."}`. Status kodları dokümandaki gibi:
`400` validasyon, `403` key/IP/başka organizasyonun ICCID'si (asla 401),
`404` route yok, `410` deaktive eSIM'in kurulum bilgisi, `429` rate limit,
`503` injection ile.

**Rate limit.** IP başına fixed window, saniyede 10 istek. Her yanıtta
`X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`,
`X-Ratelimit-Cost`; 429'da ek olarak `Retry-After`. Catalogue/networks gibi ağır
endpoint'ler 5 token harcar.

**Bundle state machine.** `processing → queued → active → depleted | expired |
revoked | lapsed`. Bir eSIM'de aynı anda tek aktif data bundle'ı olur; kalanlar
kuyrukta bekler ve öndeki bitince otomatik devreye girer. Hiç başlamadan
geçerliliği dolan bundle `lapsed` olur.

**Veri muhasebesi.** Base-10 byte: 1 GB = 1.000.000.000. `initialQuantity` /
`remainingQuantity` byte, katalogdaki `dataAmount` MB. Unlimited bundle'lar
sıfıra kadar sayar ama asla `depleted` olmaz (fair use).

**Sipariş kuralları.** ICCID sadece `assign: true` ile verilebilir, `quantity`
ICCID sayısına eşit olmalı, `profileID` `assign: true` gerektirir, uyumsuz
profil `allowReassign` olmadan reddedilir, `assign: false` stoğa yazar,
yetersiz bakiye 400.

**Revoke/refund.** Hiç kullanılmamış bundle inventory'ye (veya
`refundToBalance=true` ile bakiyeye) iade edilir; kullanılmışta iade yok.
`type=validate` sadece ne olacağını anlatır, state'e dokunmaz.

**Suspend.** `partner` suspend'i API ile geri alınabilir; `policy` suspend'i
alınamaz (`403`). Zaten suspend olan veya deaktive eSIM → `400`. Suspend
bundle sürelerini durdurmaz.

**eSIM lifecycle.** 180 gün hareketsizlik → `esim.deletion_scheduled`, 7 gün
sonra deaktivasyon + `esim.deleted`. Arada bundle atanırsa silme iptal olur.

**Kurulum teslimi.** `/esims/assignments` `Accept` başlığına göre ZIP (eSIM
başına gerçek QR PNG'si + eşleme CSV'si), JSON veya CSV döner. QR içeriği
gerçek LPA dizesi: `LPA:1$<smdp>$<matchingId>`.

**Katalog.** 80 ülke, 238 operatör ve ~1950 bundle deterministik üretilir:
ülke/bölge/global, fixed + unlimited + Voice&SMS varyantları. Fiyatlar gerçek
API ile tutarlı (örn. `esim_1GB_7D_GB_V2` = 2.28 USD). v2.5'te eklenen
`countryNetworks` bloğu (TADIG, `mccMnc`, `speeds`, `potentialNetworks`) de var.

## Webhook'lar (callbacks)

Notifications API'sindeki bütün tipler üretilir:

`Utilisation` (%1/50/80/100), `FirstAttachment`, `FirstUse`, `CountryChange`,
`Topup`, `LowBalance` / `InsufficientBalance`, `esim.deletion_scheduled`,
`esim.deleted`, `MSISDNEnabled`, `MSISDNDisabled`, `SMSFailed`.

**V3** (varsayılan) ham gövdeyi API key ile HMAC-SHA256 imzalar ve
`X-Signature-SHA256` header'ında gönderir; **V2** imzasızdır ve daha sade bir
`bundle` nesnesi taşır.

```bash
# Örnek alıcıyı çalıştır (imzayı doğrular ve yazdırır)
node examples/callback-receiver.mjs            # :4000

# Mock'u ona yönlendir
curl -X POST localhost:4010/__mock/callbacks/config \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:4000/callback","version":"V3"}'
```

Callback URL tanımlı olmasa bile her deneme `/__mock/callbacks` günlüğüne
yazılır — test yazarken alıcı ayağa kaldırmak zorunda değilsin.

## Control plane — `/__mock`

Gerçek platformun kendi başına yaptığı şeyleri (kurulum, network'e bağlanma,
veri tüketimi, zamanın akması) senkron tetiklemek için. API prefix'inin dışında
ve kimlik doğrulama istemez.

| Method | Path | Ne yapar |
|---|---|---|
| GET | `/__mock/health` | Liveness + sanal saat |
| GET | `/__mock/state` | Sayaçlar ve organizasyon özeti |
| GET | `/__mock/state/dump` | Bütün state (JSON) |
| POST | `/__mock/reset` | `{"seed":true\|false}` — sıfırla |
| GET/POST | `/__mock/clock` | `{"days":8}` / `{"reset":true}` — sanal saati ilerlet |
| POST | `/__mock/tick` | Simülasyonu bir adım çalıştır (`consume`, `elapsedMs`) |
| POST | `/__mock/esims` | Bundle'sız çıplak eSIM üret (`count`) |
| POST | `/__mock/esims/{iccid}/install` | Profili "Installed" yap |
| POST | `/__mock/esims/{iccid}/attach` | `{"iso":"FR"}` — network'e bağlan |
| POST | `/__mock/esims/{iccid}/usage` | `{"mb":500}` / `{"bytes":…}` — veri harca |
| POST | `/__mock/esims/{iccid}/policy-suspend` | API ile geri alınamayan suspend |
| POST | `/__mock/esims/{iccid}/idle` | `{"days":181}` — hareketsizlik saatini geri al |
| POST | `/__mock/inventory` | Sipariş vermeden stok ekle |
| PATCH | `/__mock/organisation` | Bakiye, callback URL, threshold vb. |
| GET/DELETE | `/__mock/callbacks` | Callback günlüğü (`?event=`, `?limit=`) |
| POST | `/__mock/callbacks/config` | Callback URL + versiyon |
| POST | `/__mock/callbacks/test` | Tek tip ya da bütün tipleri gönder |
| GET | `/__mock/sms` | Gönderilen SMS'ler |
| GET/POST/DELETE | `/__mock/failures` | Hata enjeksiyonu |
| POST | `/__mock/persist` `/__mock/restore` | `STATE_PATH` ile snapshot |
| GET | `/__mock/openapi.yaml` | Referans alınan v2.5 OpenAPI dokümanı |

**Hata enjeksiyonu** — retry/backoff kodunu test etmek için:

```bash
curl -X POST localhost:4010/__mock/failures -H 'Content-Type: application/json' \
  -d '{"path":"/orders","method":"POST","status":503,"message":"Processing","count":2,"delayMs":250}'
```

`path` alt yollarla da eşleşir (`/esims` → `/esims/{iccid}/bundles`), `*` her
şeyi yakalar, `count` verilmezse kural kalıcıdır.

## Yapılandırma

Tüm ayarlar environment değişkeni; tam liste `.env.example` dosyasında. Sık
kullanılanlar:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `4010` | HTTP portu |
| `BASE_PATH` | `/v2.5` | API prefix'i |
| `API_KEYS` | `esimgo-mock-key` | Virgülle ayrılmış geçerli key'ler |
| `IP_WHITELIST` | boş | Doluysa sadece bu IP'ler (403 aksi halde) |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT` | `true` / `10` | Saniyedeki istek sayısı |
| `CALLBACK_URL` / `CALLBACK_VERSION` | boş / `V3` | Webhook hedefi ve sürümü |
| `SIM_AUTO_USAGE` / `SIM_BYTES_PER_SECOND` | `true` / `250000` | Otomatik veri tüketimi |
| `SIM_AUTO_INSTALL_AFTER_MS` | `10000` | eSIM'i otomatik kur + bağla (0 = kapalı) |
| `SIM_PROCESSING_MS` | `3000` | `processing` state'inde kalma süresi |
| `SEED_ESIMS` / `SEED_INVENTORY` | `3` / `true` | Açılışta demo veri |
| `STATE_PATH` | boş | Doluysa kapanışta state'i diske yazar |

Testler için pratik profil: `RATE_LIMIT_ENABLED=false SIM_PROCESSING_MS=0
SIM_AUTO_USAGE=false SEED_ESIMS=0`.

## Proje yapısı

```
src/
  index.js            giriş noktası: state restore/seed, engine, listen
  server.js           Fastify kurulumu, hata zarfı, route kayıtları
  config.js           environment tabanlı yapılandırma
  routes/             HTTP katmanı (esims, bundles, orders, inventory,
                      catalogue, networks, organisation, deprecated, mock)
  domain/             iş kuralları (esims, bundles, orders, inventory,
                      catalogue, networks, organisation)
  store/              in-memory state, snapshot/restore, seed verisi
  data/               ülke + operatör referans verisi, katalog üreteci
  callbacks/          webhook gönderimi ve HMAC imzalama
  sim/                arka plan simülasyon motoru
  util/               hata, zaman (sanal saat), id/ICCID, CSV, ZIP, QR, validasyon
  plugins/            auth, rate limit, hata enjeksiyonu
tests/                87 test (node:test + fastify inject)
examples/             quickstart.sh, callback-receiver.mjs
openapi/              referans alınan eSIM Go v2.5 OpenAPI dokümanı
```

Kod tamamen JSDoc'lu: her export edilen fonksiyonun `@param`/`@returns`
bloğu var, gerçek API davranışından sapan ya da onu birebir taklit eden yerler
yorumlarda açıklanıyor.

## Mock olduğu için farklı olan şeyler

- ICCID'ler sıralı ve Luhn-geçerli (`8943108100000000010`…); matching ID ve
  SM-DP+ adresi sahte (`rsp.esim-go-mock.local`), gerçek bir cihaza kurulmaz.
- Katalog deterministik üretilir; gerçek eSIM Go kataloğunun birebir kopyası
  değil ama isim/format/fiyat düzeni aynı.
- `/esims/assignments` JSON'da tek eSIM varsa nesne, çoksa dizi döner
  (dokümandaki örnek tek nesne, gerçek hayatta çoklu sipariş olabiliyor).
- State bellekte; `STATE_PATH` verilmezse yeniden başlatmada sıfırlanır.
- `/__mock` yüzeyi gerçek API'de yoktur.
