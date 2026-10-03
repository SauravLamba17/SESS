import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/brand/logo";

// Tab title for this route; the root layout appends " · SESS".
export const metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4">
      <Logo size={32} />
      <SignUp />
    </main>
  );
}
