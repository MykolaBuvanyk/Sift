export class ImportLeaseLostError extends Error {
  constructor() {
    super("The import lease is no longer owned by this worker.");
    this.name = "ImportLeaseLostError";
  }
}

export class ImportCheckpointConflictError extends Error {
  constructor() {
    super("The import checkpoint changed before the batch could be committed.");
    this.name = "ImportCheckpointConflictError";
  }
}

export class ImportInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInvariantError";
  }
}
