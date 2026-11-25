import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <Nav userName={user.name} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </>
  );
}
