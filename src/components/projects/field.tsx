import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Label, control, optional hint and the field's error message, wired up for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria props for the control inside a Field. */
export function fieldAria(id: string, error?: string, hint?: boolean) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy || undefined };
}

/** First zod message per top-level field, keyed like the API's fieldErrors. */
export function issuesToFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    errors[field] ??= issue.message;
  }
  return errors;
}
