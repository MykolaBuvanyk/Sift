const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export interface SafeErrorFields {
  readonly errorName: string;
}

export function toSafeErrorFields(error: unknown): SafeErrorFields {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError" };
  }

  return {
    errorName: SAFE_ERROR_NAME.test(error.name) ? error.name : "Error",
  };
}
