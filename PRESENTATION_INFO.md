# معلومات العرض التقديمي — رمال فلو (Rimal Flow)

هذا الملف يحتوي كل ما تحتاجه لبناء العرض: معلومات المشروع، شرح فكرة الخريطة وألوانها، ثم Prompt جاهز لتوليد صورة توضيحية عبر Gemini.

---

## 1. نبذة عن المشروع (Slide: المقدمة)

**رمال فلو (Rimal Flow)** — مركز العمليات الذكي للحجوزات والمساحات التابع لـ **رمال X**.

**المشكلة:** إدارة حجوزات مساحات العمل المشتركة (17 مقعداً)، الثنائية، اللاونج، الكبسولة الصوتية، قاعة الابتكار، وقاعة التدريب — يدوياً عبر جداول منفصلة، بدون رؤية لحظية لمن هو حاضر فعلياً الآن، ولا طريقة سريعة لمعرفة أي مقعد فارغ دون سؤال الموظفين مباشرة.

**الحل:** نظام حجز كامل (Next.js + PostgreSQL) يضم:
- صفحة حجز عامة للعملاء (بالحجز الذاتي أو كضيف).
- محرك QR لتسجيل الحضور/الانصراف مع مؤقّت ذكي ومكافحة احتيال.
- **خريطة تفاعلية حية لمقر رمال X** — هذا هو محور العرض.
- لوحة تحكم تشغيلية للموظفين (استقبال/مدير) بصلاحيات متدرجة.

---

## 2. فكرة الخريطة التفاعلية (Slide: المفهوم)

الخريطة تعرض **مخطط المقر الفعلي بطابقين** (أرضي وعلوي)، وتحوّل كل مساحة إلى عنصر مرئي تفاعلي بدل جدول بيانات جامد. الهدف: أن يرى موظف الاستقبال **من الشكل نفسه** — دون قراءة أي جدول — أي مقعد فارغ الآن، وأيها مشغول، وبكم من الوقت المتبقي لصاحبه.

**قاعدة تصميم صارمة:** لا حدود أو حواف سوداء إطلاقاً في أي شكل. التمييز بين العناصر يتم فقط عبر **لون الخلفية + ظل ناعم (Soft Shadow) + زوايا دائرية بالكامل (Fully Rounded Corners)** — لغة بصرية هادئة ومتّسقة مع هوية رمال X.

---

## 3. نظام الألوان ومنطقه (Slide: لوحة الألوان)

أربعة ألوان فقط، كل لون له معنى تشغيلي واحد لا يتغيّر في كل الخريطة:

| اللون | الكود | المعنى |
|---|---|---|
| 🟪 بنفسجي فاتح جداً | `#E8E2ED` | خلفية الخريطة العامة والمحيط — محايد، لا يلفت الانتباه عن العناصر نفسها |
| 🟪 بنفسجي متوسط | `#8A6CA8` | **مشغول الآن** — مقعد/مساحة عليها عميل حاضر فعلياً |
| 🟨 ذهبي فاتح | `#F3CD8E` | **متاح للحجز** — يمكن تخصيصه فوراً |
| 🟧 برتقالي فاتح | `#FA9D7D` | **مرافق غير قابلة للحجز** — عناصر هيكلية/ديكورية (مثل "المعمل") |
| 🔴 أحمر صريح (تنبيه) | `#DC2626` | تنبيه حين يتبقى **30 دقيقة أو أقل** من وقت أي حجز — نبض بصري خفيف يلفت انتباه الموظف فوراً |

**لماذا هذا الاختيار تحديداً؟**
- التدرج بين البنفسجي (الهوية الأساسية لرمال X) والذهبي/البرتقالي (الهوية الثانوية) يحافظ على الاتساق مع الشعار دون إدخال ألوان دخيلة.
- تجنّب الأحمر/الأخضر التقليدي (شائع الاستخدام ومرتبط بدلالات مختلفة في أنظمة أخرى) لصالح إشارة لونية أكثر تفرداً وهدوءاً، مع الاحتفاظ بأحمر صريح واحد فقط للحالة الحرجة (التنبيه) كي يبقى استثنائياً وملفتاً فعلاً.
- الاعتماد على 4 ألوان فقط (لا أكثر) يجعل القراءة البصرية فورية — أي شخص يتعلم المعنى خلال ثوانٍ.

---

## 4. كيف يعمل التسكين (Slide: الآلية)

خطوة مهمة تميّز النظام: **الإشغال على الخريطة يدوي بالكامل ومقصود**، وليس تلقائياً من كل حجز:

1. الموظف يضغط على أي مقعد ذهبي (متاح).
2. تظهر نافذة بحث تعرض فقط **من سجّل حضوره اليوم فعلياً** (لا كامل قاعدة العملاء) — بالاسم أو رقم الجوال.
3. يختار العميل → يُخصَّص له المقعد فوراً (بدون إنشاء حجز مكرر لمن لديه حجز أصلاً).
4. عميل جديد وصل للتو؟ تبويب "ضيف جديد" يسجّل حضوره ويخصّص مقعده في خطوة واحدة، مع مؤقّت تنازلي حي يبدأ فوراً.
5. من المقعد نفسه: تسجيل خروج أو إلغاء التخصيص مباشرة.

هذا يمنع أي التباس بين "من حجز عبر الإنترنت" و"من هو موجود فعلياً في المقر الآن".

---

## 5. الجانب التقني (Slide: التقنية، اختياري)

- **Next.js 14 (App Router) + TypeScript**، واجهة عربية RTL كاملة.
- **PostgreSQL + Prisma ORM** — كل الأسعار تُحسب من السيرفر فقط (لا يُوثق بأي سعر من المتصفح).
- **NextAuth** بأدوار متدرجة (USER / RECEPTION / ADMIN / SUPER_ADMIN).
- محرك QR حقيقي عبر كاميرا الجهاز (jsQR) يعمل من أي جوال بعد النشر.
- منشور فعلياً على **Vercel** مع قاعدة بيانات **Neon PostgreSQL**.

---

## 6. الصور المطلوبة للعرض

- **صورة 1 (من توليد Gemini):** موك-أب/رسم توضيحي لفكرة الخريطة وشرح الألوان — استخدم الـ Prompt أدناه.
- **صورة 2 (لقطة شاشة حقيقية):** التقط سكرين شوت من الموقع الفعلي على `rimal-flow.vercel.app/dashboard` بعد تسجيل الدخول — هذه هي "الخريطة المطبَّقة" الفعلية، ضعها مباشرة بعد صورة Gemini للمقارنة بين الفكرة والتنفيذ.

---

## 7. الـ Prompt الجاهز لإرساله إلى Gemini

انسخ النص التالي كما هو والصقه في Gemini (أو أي أداة توليد صور):

```
Create a clean, modern UI/UX concept mockup illustration for an interactive office floor map dashboard, in a flat minimal design style, Arabic RTL layout.

Show a top-down floor plan with rounded-square seat icons arranged in rows and an L-shape cluster, plus a few larger rounded rectangle "hall" cards for VIP lounge, training hall, and innovation hall.

Use EXACTLY these 4 colors and nothing else for the shapes (plus white text labels where needed):
- Background / surrounding area: soft light lavender #E8E2ED
- Occupied seats/halls: medium purple #8A6CA8
- Available seats/halls: soft gold #F3CD8E
- Non-bookable facility blocks: soft coral orange #FA9D7D
- One or two seats shown in a sharp red #DC2626 with a subtle glow, representing an "under 30 minutes remaining" alert

Strict style rules: NO black borders or outlines anywhere, no black strokes at all — differentiate shapes purely by background color and soft drop shadows. Every shape has fully rounded corners (like rounded squares/pills). Clean sans-serif typography. Include a small color legend/key box in a corner labeled in Arabic: "متاح للحجز", "محجوز حالياً", "مرافق غير قابلة للحجز", "تنبيه ≤30 دقيقة".

Overall mood: calm, professional, premium co-working space software, purple-and-gold brand identity, lots of whitespace, soft shadows, no harsh contrast. Presentation-slide quality, 16:9 aspect ratio.
```

**ملاحظة:** إذا أردت الصورة أقرب لمخطط رمال X الفعلي (طابقين، توزيع الغرف بالضبط)، أضف على الـ Prompt أعلاه هذه الجملة:

```
Divide it into two floor tabs: "Ground Floor" showing a soundproof pod in the center and a vertical column of seats on the right with decorative orange facility blocks on the left, and "First Floor" showing a dual-workspace area, a lab facility block, two facing rows of seats, and VIP/Innovation/Training hall cards stacked on one side.
```
