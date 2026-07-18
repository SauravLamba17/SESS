import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/components/brand/logo";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4">
      <Logo size={32} />
      <SignIn />
    </main>
  );
}
