import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { signOut } from "./actions";
import { BottomTabBar } from "@/components/BottomTabBar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  return (
    <>
      <header className="siteHeader">
        <span className="logo">
          <svg
            viewBox="0 0 64 64"
            width="28"
            height="28"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M32 4 A28 28 0 1 1 10 50"
              fill="none"
              stroke="#a3c45a"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
            <circle cx="10" cy="50" r="4" fill="#a3c45a" />
            <path
              d="M32 13 A19 19 0 0 0 13 32 A19 19 0 0 0 32 51 A19 19 0 0 0 49 40"
              fill="none"
              stroke="#a3c45a"
              strokeWidth="2"
              opacity="0.28"
            />
            <path
              d="M32 20 A12 12 0 0 1 44 32 A12 12 0 0 1 32 44 A12 12 0 0 1 22 36"
              fill="none"
              stroke="#a3c45a"
              strokeWidth="1.5"
              opacity="0.14"
            />
            <path
              d="M16 32 L20 32 L23 27 L27 37 L31 30 L34 34 L37 32 L48 32"
              fill="none"
              stroke="#a3c45a"
              strokeWidth="1.4"
              opacity="0.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="32" cy="32" r="2" fill="#a3c45a" opacity="0.4" />
          </svg>
          <span className="logoWordmark">
            <span className="logoForm">Form</span>
            <span className="logoAI">AI</span>
          </span>
        </span>
        <form action={signOut}>
          <button
            className="iconBtn"
            type="submit"
            title="Sign out"
            aria-label="Sign out"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </header>
      {children}
      <BottomTabBar />
    </>
  );
}
