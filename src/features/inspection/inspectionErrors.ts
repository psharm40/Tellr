// typed error for the inspection flow so the api route can map failures to the
// right http status and a safe, plain-language message. messages never contain
// secrets, model internals, or raw image bytes.

export type InspectionErrorCode =
  | "invalid_request"
  | "invalid_image"
  | "model_unavailable"
  | "invalid_model_output";

export class InspectionError extends Error {
  readonly code: InspectionErrorCode;
  constructor(code: InspectionErrorCode, message: string) {
    super(message);
    this.name = "InspectionError";
    this.code = code;
  }
}
