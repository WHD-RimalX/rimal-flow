import type { Role } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: Role;
      permissions?: unknown;
      isStudent?: boolean;
    };
  }

  interface User {
    id: string;
    role: Role;
    permissions?: unknown;
    isStudent?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    permissions?: unknown;
    isStudent?: boolean;
  }
}
