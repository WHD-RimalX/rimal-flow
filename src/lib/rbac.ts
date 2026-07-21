import { Role } from "@prisma/client";

/**
 * نظام الصلاحيات (RBAC) — رمال فلو
 * الأدوار: USER (عميل) / RECEPTION (استقبال) / ADMIN (مدير) / SUPER_ADMIN (مدير عام)
 * الصلاحيات المفصلة تُخزَّن في User.permissions (JSON) وتُدمج مع صلاحيات الدور الافتراضية.
 */

export type Permission =
  | "canCheckIn"
  | "canCheckOut"
  | "canCancelBooking"
  | "canManageSpaces"
  | "canManageUsers"
  | "canViewReports"
  | "canOverrideBookingConflicts";

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Record<Permission, boolean>> = {
  USER: {
    canCheckIn: false,
    canCheckOut: false,
    canCancelBooking: false,
    canManageSpaces: false,
    canManageUsers: false,
    canViewReports: false,
    canOverrideBookingConflicts: false,
  },
  RECEPTION: {
    canCheckIn: true,
    canCheckOut: true,
    canCancelBooking: false,
    canManageSpaces: false,
    canManageUsers: false,
    canViewReports: false,
    canOverrideBookingConflicts: false,
  },
  ADMIN: {
    canCheckIn: true,
    canCheckOut: true,
    canCancelBooking: true,
    canManageSpaces: true,
    canManageUsers: false,
    canViewReports: true,
    canOverrideBookingConflicts: true,
  },
  SUPER_ADMIN: {
    canCheckIn: true,
    canCheckOut: true,
    canCancelBooking: true,
    canManageSpaces: true,
    canManageUsers: true,
    canViewReports: true,
    canOverrideBookingConflicts: true,
  },
};

export interface AuthUserLike {
  role: Role;
  permissions?: unknown;
}

/** يدمج صلاحيات الدور الافتراضية مع أي تخصيص فردي مخزَّن على المستخدم. */
export function resolvePermissions(user: AuthUserLike): Record<Permission, boolean> {
  const base = DEFAULT_ROLE_PERMISSIONS[user.role];
  const overrides = (user.permissions as Partial<Record<Permission, boolean>>) ?? {};
  return { ...base, ...overrides };
}

export function hasPermission(user: AuthUserLike, permission: Permission): boolean {
  return resolvePermissions(user)[permission] === true;
}

export function isStaff(role: Role): boolean {
  return role === "RECEPTION" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export class ForbiddenError extends Error {
  constructor(message = "لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** يرمي استثناء إن كان المستخدم لا يملك الصلاحية المطلوبة — للاستخدام داخل API routes. */
export function assertPermission(user: AuthUserLike, permission: Permission) {
  if (!hasPermission(user, permission)) {
    throw new ForbiddenError();
  }
}
