import { HealthPanel } from "@/components/health-panel";
import { ProjectList } from "@/components/projects/project-list";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">ORTAM Asbestos Report — prototype</h1>
        <p className="text-muted-foreground">
          Prepare an asbestos assessment report from field notes and laboratory PDFs. All data in this exercise is
          fictional.
        </p>
      </header>
      <ProjectList />
      <HealthPanel />
    </main>
  );
}
