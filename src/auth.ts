import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import * as bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { Session } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      isFounder: boolean;
      isSuperadmin: boolean;
      permissions: string[] | null;
      image?: string | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          const email = credentials?.email as string;
          const password = credentials?.password as string;

          if (!email || !password) return null;

          const [user] = await db
            .select()
            .from(users)
            .where(and(eq(users.email, email), eq(users.isActive, true)))
            .limit(1);

          if (!user) return null;

          const isValid = await bcrypt.compare(password, user.password);
          if (!isValid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.isFounder = false;
        session.user.isSuperadmin = false;
        session.user.permissions = null;

        try {
          // M8: Verify user is still active in DB
          // isFounder is read live (not from the JWT) so flipping the flag takes
          // effect without the user having to sign out and back in.
          const [dbUser] = await db
            .select({ isActive: users.isActive, isFounder: users.isFounder, isSuperadmin: users.isSuperadmin, permissions: users.permissions, role: users.role })
            .from(users)
            .where(and(eq(users.id, token.sub as string), eq(users.isActive, true)))
            .limit(1);

          if (!dbUser) {
            return { expires: session.expires } as unknown as Session;
          }
          // role, superadmin and permissions are live too, so a change on the
          // Access page applies on the person's next request.
          session.user.role = dbUser.role ?? session.user.role;
          session.user.isFounder = dbUser.isFounder ?? false;
          session.user.isSuperadmin = dbUser.isSuperadmin ?? false;
          session.user.permissions = Array.isArray(dbUser.permissions) ? dbUser.permissions : null;
        } catch (error) {
          console.error("Session DB check error:", error);
        }
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const isOnLogin = request.nextUrl.pathname.startsWith("/login");
      const isOnRegister = request.nextUrl.pathname.startsWith("/register");
      const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");
      const isSeedApi = request.nextUrl.pathname.startsWith("/api/seed");
      const isCronApi = request.nextUrl.pathname.startsWith("/api/cron");
      const isPublicReview = request.nextUrl.pathname.startsWith("/r/");
      const isPublicReviewApi = request.nextUrl.pathname.startsWith("/api/review/");
      const isPublicEditor = request.nextUrl.pathname.startsWith("/e/");
      const isPublicEditorApi = request.nextUrl.pathname.startsWith("/api/e/");

      if (isAuthApi) return true;
      if (isSeedApi) {
        // Seed route handles its own secret-based auth
        return true;
      }
      if (isCronApi) {
        // Cron routes handle their own Bearer token auth
        return true;
      }
      if (isOnLogin) return true;
      if (isOnRegister) return true;
      if (isPublicReview) return true;
      if (isPublicReviewApi) return true;
      if (isPublicEditor) return true;
      if (isPublicEditorApi) return true;
      if (isLoggedIn) return true;

      return Response.redirect(new URL("/login", request.nextUrl.origin));
    },
  },
});
