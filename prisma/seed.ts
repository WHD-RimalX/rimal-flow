import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const defaultWeeklyAvailability = {
  sun: { open: "08:00", close: "23:00" },
  mon: { open: "08:00", close: "23:00" },
  tue: { open: "08:00", close: "23:00" },
  wed: { open: "08:00", close: "23:00" },
  thu: { open: "08:00", close: "23:00" },
  fri: { open: "14:00", close: "23:00" },
  sat: { open: "10:00", close: "23:00" },
};

const spaces = [
  {
    slug: "shared-workspace",
    name: "مساحة عمل مشتركة",
    nameEn: "Shared Workspace",
    description: "مقعد في مساحة عمل مشتركة ومفتوحة مزودة بكل الخدمات الأساسية.",
    capacityUnits: 17,
    hourlyPrice: 20,
    fourHourPrice: 60,
    dailyPrice: 115,
    monthlyMorningPrice: 999,
    monthlyEveningPrice: 1099,
    studentDiscount: 0.15,
  },
  {
    slug: "dual-workspace",
    name: "مساحة عمل ثنائية",
    nameEn: "Dual Workspace",
    description: "مساحة عمل مخصصة لشخصين مع خصوصية أكبر.",
    capacityUnits: 3,
    hourlyPrice: 30,
    fourHourPrice: 80,
    dailyPrice: 159,
    monthlyMorningPrice: null,
    monthlyEveningPrice: null,
    studentDiscount: 0.15,
  },
  {
    slug: "vip-lounge",
    name: "لاونج كبار الشخصيات",
    nameEn: "VIP Lounge",
    description: "لاونج فاخر لكبار الشخصيات باستضافة راقية وخصوصية تامة.",
    capacityUnits: 1,
    hourlyPrice: 199,
    fourHourPrice: 649,
    dailyPrice: 1499,
    monthlyMorningPrice: null,
    monthlyEveningPrice: null,
    studentDiscount: 0,
  },
  {
    slug: "soundproof-pod",
    name: "كبسولة عازلة للصوت",
    nameEn: "Soundproof Pod",
    description: "كبسولة فردية معزولة صوتياً للمكالمات والاجتماعات الخاصة.",
    capacityUnits: 1,
    hourlyPrice: 50,
    fourHourPrice: null,
    dailyPrice: null,
    monthlyMorningPrice: null,
    monthlyEveningPrice: null,
    studentDiscount: 0,
  },
  {
    slug: "innovation-hub",
    name: "قاعة الابتكار",
    nameEn: "Innovation Hub",
    description: "مساحة إبداعية مجهزة لجلسات العصف الذهني والابتكار الجماعي.",
    capacityUnits: 1,
    hourlyPrice: 90,
    fourHourPrice: 320,
    dailyPrice: 699,
    monthlyMorningPrice: null,
    monthlyEveningPrice: null,
    studentDiscount: 0.15,
  },
  {
    slug: "open-training-hall",
    name: "قاعة تدريب مفتوحة",
    nameEn: "Open Training Hall",
    description: "قاعة تدريب واسعة قابلة للتجهيز لفعاليات وورش العمل.",
    capacityUnits: 1,
    hourlyPrice: 115,
    fourHourPrice: 360,
    dailyPrice: 1199,
    monthlyMorningPrice: null,
    monthlyEveningPrice: null,
    studentDiscount: 0.15,
  },
];

async function main() {
  console.log("🌱 بدء تعبئة البيانات الابتدائية...");

  for (const space of spaces) {
    await prisma.space.upsert({
      where: { slug: space.slug },
      update: {
        ...space,
        weeklyAvailability: defaultWeeklyAvailability,
      },
      create: {
        ...space,
        weeklyAvailability: defaultWeeklyAvailability,
      },
    });
    console.log(`  ✔ تم إنشاء/تحديث مساحة: ${space.name}`);
  }

  const adminPassword = await bcrypt.hash("RimalX@2026!", 12);
  await prisma.user.upsert({
    where: { email: "admin@rimalx.sa" },
    update: {},
    create: {
      name: "مدير النظام",
      email: "admin@rimalx.sa",
      phone: "0500000000",
      passwordHash: adminPassword,
      role: Role.SUPER_ADMIN,
      permissions: {
        canCheckIn: true,
        canCheckOut: true,
        canCancelBooking: true,
        canManageSpaces: true,
        canManageUsers: true,
        canViewReports: true,
      },
    },
  });
  console.log("  ✔ تم إنشاء حساب المدير العام (admin@rimalx.sa / RimalX@2026!)");

  const receptionPassword = await bcrypt.hash("Reception@2026!", 12);
  await prisma.user.upsert({
    where: { email: "reception@rimalx.sa" },
    update: {},
    create: {
      name: "موظف الاستقبال",
      email: "reception@rimalx.sa",
      phone: "0500000001",
      passwordHash: receptionPassword,
      role: Role.RECEPTION,
      permissions: {
        canCheckIn: true,
        canCheckOut: true,
        canCancelBooking: false,
        canManageSpaces: false,
        canManageUsers: false,
        canViewReports: false,
      },
    },
  });
  console.log("  ✔ تم إنشاء حساب موظف استقبال (reception@rimalx.sa / Reception@2026!)");

  console.log("✅ اكتملت تعبئة البيانات الابتدائية بنجاح.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
