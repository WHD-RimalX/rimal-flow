# عقد الواجهات البرمجية (API Contract) — رمال فلو v1

هذا المستند يوثّق كل نقاط النهاية (Endpoints) الفعلية في مشروع رمال فلو (Rimal Flow)، مع التركيز على
مسارات **الحجوزات**، **المسح بالباركود (QR Check-in/Check-out)**، و**التسكين اليدوي/البحث عن العملاء**،
تحضيراً للتكامل مع أي عميل خارجي (تطبيق جوال، لوحة شريك، إلخ) وللنشر على GitHub/Vercel.

> **ملاحظة**: لم يُتَح لي الاطلاع على ملف `INTEGRATION_STANDARDS.pdf` المذكور (لم يصل ضمن هذه المحادثة)،
> لذا اتُّبعت في هذا العقد معايير REST قياسية وشائعة (JSON، رموز حالة HTTP الدلالية، صيغة خطأ موحّدة).
> إن كان لديك نسخة من ملف المعايير، أرسلها وسأطابق هذا المستند معها بدقة.

---

## 1. عام

| | |
|---|---|
| **Base URL (محلي)** | `http://localhost:3000` |
| **Base URL (إنتاج)** | `https://<your-vercel-domain>.vercel.app` |
| **الصيغة** | `application/json` لكل الطلبات والاستجابات |
| **المصادقة** | NextAuth.js — جلسة JWT محفوظة في كوكي `next-auth.session-token` (HttpOnly). لا يوجد Bearer token منفصل حالياً. |
| **الأدوار (Roles)** | `USER` (عميل) · `RECEPTION` (استقبال) · `ADMIN` (مدير) · `SUPER_ADMIN` (مدير عام) |
| **الحجم القصى للـ IDs** | `cuid()` — نصوص فريدة، وليست أرقاماً تسلسلية |

### صيغة الخطأ الموحّدة

كل خطأ يُعاد بنفس الشكل:

```json
{
  "error": "نص الخطأ بالعربية للعرض المباشر للمستخدم",
  "issues": {
    "formErrors": [],
    "fieldErrors": { "phone": ["رقم جوال غير صالح — مثال صحيح: 0512345678 أو +966512345678"] }
  }
}
```
- `issues` يظهر فقط في أخطاء التحقق من المدخلات (Zod validation، حالة 400).
- رموز الحالة المستخدمة: `400` بيانات غير صالحة · `401` غير مسجّل دخول · `403` صلاحية غير كافية ·
  `404` غير موجود · `409` تعارض/تكرار · `422` مرفوض منطقياً (Business rule) · `429` طلبات متكررة
  (Anti-fraud cooldown) · `500` خطأ سيرفر غير متوقع.

---

## 2. المصادقة (Auth)

### `POST /api/auth/register`
تسجيل عميل جديد (دور `USER` دائماً).

**Request body**
```json
{
  "name": "أحمد محمد",
  "email": "ahmed@example.com",
  "phone": "0512345678",
  "password": "Passw0rd",
  "isStudent": false,
  "studentIdNumber": "441xxxxxx"
}
```
**Response `201`**
```json
{ "user": { "id": "cl...", "name": "أحمد محمد", "email": "ahmed@example.com", "phone": "0512345678", "isStudent": false } }
```
**أخطاء**: `400` بيانات غير صالحة (مع `issues.fieldErrors` لكل حقل) · `409` البريد/الجوال مستخدم مسبقاً.

### `POST /api/auth/callback/credentials` (عبر NextAuth)
تسجيل الدخول. يُستخدم من الواجهة عبر `signIn("credentials", { email, password })` — لا يُستدعى مباشرة من عميل خارجي عادة. يُعيد كوكي جلسة عند النجاح.

### `GET /api/auth/session`
يُعيد الجلسة الحالية (أو `{}` إن لم توجد) — تُستخدم داخلياً من next-auth.

---

## 3. المساحات (Spaces)

### `GET /api/spaces`
عام (لا يتطلب تسجيل دخول). يُعيد كل المساحات النشطة وبنية أسعارها.

**Response `200`**
```json
{
  "spaces": [
    {
      "id": "cl...", "slug": "shared-workspace", "name": "مساحة عمل مشتركة",
      "capacityUnits": 17,
      "hourlyPrice": "20", "fourHourPrice": "60", "dailyPrice": "115",
      "monthlyMorningPrice": "999", "monthlyEveningPrice": "1099",
      "studentDiscount": "0.15", "isActive": true
    }
  ]
}
```
> حقول الأسعار والخصم من نوع `Decimal` في قاعدة البيانات وتُسلسَل كنصوص (`string`) في JSON.

---

## 4. البحث عن العملاء (Customer Search — للموظفين فقط)

### `GET /api/users/search?q=<نص>`
**Auth**: يتطلب جلسة موظف (`RECEPTION`/`ADMIN`/`SUPER_ADMIN`) — `403` لغير الموظفين.

يبحث في الاسم أو رقم الجوال فقط (غير حساس لحالة الأحرف، ويتجاهل المسافات/الشرطات داخل رقم الجوال).
لا يبحث بالبريد الإلكتروني. أقل طول للاستعلام: حرفان.

**Response `200`**
```json
{
  "users": [
    { "id": "cl...", "name": "سارة العتيبي", "phone": "0559876543", "email": "s@x.com", "isStudent": true, "role": "USER" }
  ]
}
```
النتائج محدودة بـ 8 عناصر، مرتّبة أبجدياً بالاسم.

---

## 5. الحجوزات (Bookings)

### `POST /api/bookings`
إنشاء حجز. **الأسعار تُحسب بالكامل على السيرفر** — لا يوجد أي حقل سعر في جسم الطلب.

**قاعدة إلزامية للموظفين**: إذا كان المستدعي موظفاً (`RECEPTION`/`ADMIN`/`SUPER_ADMIN`)، يجب تحديد
المستفيد الفعلي من الحجز صراحة — إما `customerUserId` (عميل مسجَّل) أو `guestName`+`guestPhone`
(ضيف). حجز "مجرّد" منسوب لحساب الموظف نفسه بلا مستفيد محدَّد **مرفوض** (`400`).

**Request body**
```json
{
  "spaceId": "cl...",
  "bookingType": "HOURLY",
  "startTime": "2026-07-22T10:00:00.000Z",
  "isStudent": false,
  "studentIdNumber": "441xxxxxx",
  "notes": "ملاحظة اختيارية",

  "customerUserId": "cl...",

  "guestName": "خالد",
  "guestPhone": "0512345678",
  "guestEmail": "khaled@example.com"
}
```
| الحقل | نوع | ملاحظات |
|---|---|---|
| `spaceId` | string (مطلوب) | |
| `bookingType` | `HOURLY \| FOUR_HOUR \| DAILY \| MONTHLY_MORNING \| MONTHLY_EVENING` (مطلوب) | يجب أن تدعمه المساحة (سعر غير null) |
| `startTime` | ISO datetime (مطلوب) | لا يقبل وقتاً ماضياً |
| `isStudent` | boolean | يُتجاهل إن اختير `customerUserId` — يُعتمد بدلاً منه `user.isStudent` الفعلي من قاعدة البيانات |
| `customerUserId` | string (اختياري) | عميل مسجَّل — من نتائج `/api/users/search` |
| `guestName`/`guestPhone`/`guestEmail` | (اختياري) | لحجز الضيف؛ `guestPhone` بصيغة `05XXXXXXXX` أو `+9665XXXXXXXX` |

**Response `201`**
```json
{
  "booking": {
    "id": "cl...", "bookingCode": "RMX-7F3K2A9Q",
    "spaceId": "cl...", "bookingType": "HOURLY",
    "startTime": "2026-07-22T10:00:00.000Z", "endTime": "2026-07-22T11:00:00.000Z",
    "isStudent": false, "basePrice": "20", "discountAmount": "0", "finalPrice": "20",
    "status": "CONFIRMED", "space": { "...": "..." }
  }
}
```
**أخطاء شائعة**: `400` بيانات غير صالحة/مستفيد غير محدَّد · `404` المساحة أو العميل المحدَّد غير موجود ·
`409` تعارض حجز (تجاوز الطاقة الاستيعابية للمساحة في نفس التوقيت) · `422` باقة السعر غير متاحة لهذه المساحة.

### `GET /api/bookings`
**Auth**: يتطلب جلسة. الموظفون يرون كل الحجوزات؛ العميل العادي يرى حجوزاته فقط.

**Query params** (كلها اختيارية):

| Param | مثال | الوصف |
|---|---|---|
| `date` | `2026-07-22` | يوم كامل (00:00 → 23:59:59) |
| `from`, `to` | ISO datetime | نطاق زمني حر (يُستخدم في التقويم) |
| `status` | `CHECKED_IN` أو `CHECKED_IN,CHECKED_OUT` | قيمة واحدة أو عدة قيم مفصولة بفاصلة |
| `spaceId` | `cl...` | تصفية بمساحة واحدة |
| `page`, `pageSize` | `1`, `10` | **اختياريان**: عند تمرير أيّ منهما تُفعَّل الصفحات (الحد الأقصى `pageSize=50`)؛ بدونهما تُعاد كل النتائج المطابقة دفعة واحدة (للتوافق مع التقويم/الخريطة) |

**Response `200`**
```json
{
  "bookings": [ { "...": "كائن حجز كامل مع space وuser وcheckInLogs (آخر 5 سجلات)" } ],
  "total": 42,
  "page": 1,
  "pageSize": 10
}
```

### `GET /api/bookings/:id`
**Auth**: صاحب الحجز أو موظف. `403` لغير المخوَّلين، `404` إن لم يوجد.

### `PATCH /api/bookings/:id`
تحديث حالة الحجز (دورة الحياة: `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT / CANCELLED / NO_SHOW`).
**Auth**: موظفون فقط. الإلغاء (`CANCELLED`) يتطلب صلاحية `canCancelBooking` تحديداً (متاحة لـ ADMIN/SUPER_ADMIN فقط، وليست RECEPTION).

**Request body**
```json
{ "status": "CANCELLED", "reason": "طلب العميل" }
```

---

## 6. تسجيل الحضور/الانصراف عبر QR (Check-in Engine)

### `POST /api/checkin`
**Auth**: لا يتطلب جلسة إلزامياً (يعمل ذاتياً عبر مسح العميل نفسه)، لكن إن وُجدت جلسة موظف تُسجَّل كمنفِّذ الإجراء.

**Request body**
```json
{ "bookingCode": "RMX-7F3K2A9Q", "action": "CHECK_IN", "qrCode": "RIMALX-HQ-MAIN-BRANCH-0001" }
```
| الحقل | ملاحظات |
|---|---|
| `bookingCode` | كود الحجز الظاهر للعميل |
| `action` | `CHECK_IN` أو `CHECK_OUT` |
| `qrCode` | يجب أن يطابق قيمة `NEXT_PUBLIC_VENUE_QR_CODE` الثابتة للمقر — وإلا `400` |

**القيود المطبَّقة (مرتّبة حسب الفحص):**
1. رمز QR غير مطابق → `400`.
2. الحجز ملغى/عدم حضور → `422`.
3. تكرار نفس الإجراء (Check-in أو Check-out) خلال أقل من **3 دقائق** من آخر محاولة → `429` (مكافحة احتيال).
4. **Check-in**: مرفوض إن كانت الحالة `CHECKED_IN` أو `CHECKED_OUT` مسبقاً (`409`)، أو خارج نافذة **±30 دقيقة** حول موعد الحجز (`422`).
5. **Check-out**: مرفوض إن لم تكن الحالة `CHECKED_IN` أصلاً، أي **بدون تسجيل دخول سابق لا يوجد تسجيل خروج** (`409`).

**عند نجاح Check-in**: يبدأ **مؤقّت مهلة وصول 30 ثانية** (`bufferEndsAt`)، وبعدها يبدأ الاحتساب الفعلي
لمدة الحجز المدفوعة (`actualStartTime` → `expectedEndTime`)، وتُخزَّن الحقول الثلاثة في سجل
`CheckInLog` المرتبط.

**Response `200` (Check-in)**
```json
{
  "message": "تم تسجيل الحضور بنجاح — مهلة الوصول للمقعد 30 ثانية قبل بدء احتساب الوقت",
  "booking": {
    "status": "CHECKED_IN",
    "checkInLogs": [
      {
        "action": "CHECK_IN", "timestamp": "2026-07-22T10:00:05.000Z",
        "bufferEndsAt": "2026-07-22T10:00:35.000Z",
        "actualStartTime": "2026-07-22T10:00:35.000Z",
        "expectedEndTime": "2026-07-22T11:00:35.000Z"
      }
    ]
  }
}
```

---

## 7. لوحة العمليات (Staff-only)

### `GET /api/dashboard/summary`
**Auth**: موظفون فقط. إحصائيات لحظية (الحاضرون الآن، القادمون خلال ساعة، المتأخرون، إلخ) — بدون معاملات.

---

## 8. جدول رموز الحالة الشامل

| الكود | المعنى |
|---|---|
| 200 | نجاح (قراءة/تحديث) |
| 201 | تم الإنشاء (حجز/حساب جديد) |
| 400 | بيانات غير صالحة أو ناقصة |
| 401 | يجب تسجيل الدخول |
| 403 | لا تملك الصلاحية الكافية |
| 404 | العنصر غير موجود |
| 409 | تعارض (حجز مزدوج، حالة غير متسقة) |
| 422 | مرفوض منطقياً (قاعدة عمل — مثال: خارج نافذة الوصول) |
| 429 | محاولة متكررة خلال فترة التهدئة |
| 500 | خطأ سيرفر غير متوقع |

---

## 9. ملاحظات أمنية للمكامِلين

- **لا تُرسل أبداً حقول سعر** في `POST /api/bookings` — أي حقل كهذا يُتجاهل تماماً لأن المخطط (Zod schema) لا يحتوي عليه أصلاً؛ السعر النهائي يأتي فقط في الاستجابة.
- **معرّفات الكيانات (IDs) كلها نصوص `cuid()`** — لا تفترض أنها أرقام أو أنها متسلسلة.
- كل المسارات التي تُغيّر بيانات (`POST`/`PATCH`) تتحقق من الصلاحيات على السيرفر بغض النظر عمّا تعرضه الواجهة — راجع `src/lib/session.ts` و`src/lib/rbac.ts`.
