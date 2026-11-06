/** Why the gateway refused or could not route a call. Sent to the client as `{ code, message }`. */
export type GatewayErrorCode =
  | 'UNKNOWN_TOOL'
  | 'UNAUTHORIZED'
  | 'QUOTA_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN_PROFILE'
  | 'UNKNOWN_TASK'
  | 'FORBIDDEN_CALL'
  | 'FORBIDDEN_WRITE'
  | 'DEPTH_EXCEEDED'
  | 'DEADLINE_EXCEEDED'
  | 'MAX_CALLS_EXCEEDED'
  | 'TASK_ENDED';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
