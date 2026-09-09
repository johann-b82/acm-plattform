import { LoginForm } from "./login-form";

export const metadata = { title: "Anmelden · ACM-Plattform" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight">ACM-Plattform</h1>
        <p className="mt-1 text-sm text-zinc-500">Mit deinem Konto anmelden.</p>
        <LoginForm />
      </div>
    </main>
  );
}
