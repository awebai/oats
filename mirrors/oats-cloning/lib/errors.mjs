// One error type for every refusal. `code` is part of the command contract
// (README "Error codes"); `details` never carries secret material.
export class CloneError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message, details) {
  throw new CloneError(code, message, details);
}
