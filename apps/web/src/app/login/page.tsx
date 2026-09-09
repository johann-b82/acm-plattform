import { LoginForm } from "./login-form";

export const metadata = { title: "Anmelden · ACM-Plattform" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">ACM-Plattform</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">Mit deinem Konto anmelden.</p>
        <LoginForm />
      </div>
    </main>
  );
}
