import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

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
        const email = credentials?.email as string;
        const password = credentials?.password as string;

        if (!email || !password) return null;

        const validEmail = process.env.AUTH_EMAIL || "admin@apotekhunden.se";
        // Default password hash for "admin123" - change in production
        const validHash = process.env.AUTH_PASSWORD_HASH ||
          "$2a$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lLfFgCt3Ky";

        if (email !== validEmail) return null;

        const isValid = await bcrypt.compare(password, validHash);
        if (!isValid) return null;

        return { id: "1", email, name: "Admin" };
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
    authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const isOnLogin = request.nextUrl.pathname.startsWith("/login");
      const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");

      if (isAuthApi) return true;
      if (isOnLogin) return true;
      if (isLoggedIn) return true;

      return Response.redirect(new URL("/login", request.nextUrl.origin));
    },
  },
});
