import type { ValidationError } from "@nestjs/common";

export interface FieldValidationError {
  field: string;
  constraints: Record<string, string>;
}

export function flattenValidationErrors(
  errors: ValidationError[],
  parent = "",
): FieldValidationError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const ownErrors = error.constraints
      ? [{ field, constraints: error.constraints }]
      : [];
    const childErrors = error.children?.length
      ? flattenValidationErrors(error.children, field)
      : [];

    return [...ownErrors, ...childErrors];
  });
}
