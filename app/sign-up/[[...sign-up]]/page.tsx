import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/brand/logo";

export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4">
      <Logo size={32} />
      <SignUp />
    </main>
  );
}
