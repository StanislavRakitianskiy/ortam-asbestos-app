import { Suspense } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { ProjectWorkspace } from "@/components/projects/project-workspace";

function Loading() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      Loading project…
    </p>
  );
}

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:py-10">
      <Suspense fallback={<Loading />}>{params.then(({ id }) => <ProjectWorkspace projectId={id} />)}</Suspense>
    </main>
  );
}
