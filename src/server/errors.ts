import type { z } from "zod";

/** Field path ("quantity", "sampleIds.1") → messages. */
export type FieldErrors = Record<string, string[]>;

/** Bad input from the employee. Route handlers turn it into HTTP 400 with the field names. */
export class ValidationError extends Error {
  readonly fieldErrors: FieldErrors;
  readonly formErrors: string[];

  constructor(fieldErrors: FieldErrors, formErrors: string[] = []) {
    const fields = Object.keys(fieldErrors);
    super(
      fields.length > 0
        ? `Please check: ${fields.map((field) => `${field} ${fieldErrors[field][0]}`).join("; ")}.`
        : (formErrors[0] ?? "The request is not valid."),
    );
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
    this.formErrors = formErrors;
  }

  static fromZod(error: z.ZodError): ValidationError {
    const fieldErrors: FieldErrors = {};
    const formErrors: string[] = [];
    for (const issue of error.issues) {
      if (issue.path.length === 0) {
        formErrors.push(issue.message);
        continue;
      }
      const field = issue.path.map(String).join(".");
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return new ValidationError(fieldErrors, formErrors);
  }

  static field(field: string, message: string): ValidationError {
    return new ValidationError({ [field]: [message] });
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** The request conflicts with the current state, e.g. an extraction is already running. Becomes HTTP 409. */
export class ConflictError extends Error {
  /** Lets the UI react to a specific conflict, e.g. ask for confirmation. */
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}
