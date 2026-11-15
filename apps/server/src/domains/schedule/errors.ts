/** The domain's closed wire-code union: clients match these, never messages. */

import { DomainHttpError } from "../../infrastructure/http/http-error.ts";

export type ScheduleErrorCode =
  | "SCHEDULE_ITEM_NOT_FOUND"
  | "SCHEDULE_ENTRY_NOT_FOUND"
  | "SCHEDULE_VIEW_NOT_FOUND"
  | "SCHEDULE_ITEM_DUPLICATE"
  | "SCHEDULE_STATUS_IN_USE"
  | "SCHEDULE_INVALID_ITEM"
  | "SCHEDULE_INVALID_DATE"
  | "SCHEDULE_INVALID_STATUS"
  | "SCHEDULE_INVALID_VIEW_CONFIG";

/** Use-case failure (unknown id, duplicate title, vocabulary conflicts). */
export class ScheduleRequestError extends DomainHttpError {
  constructor(code: ScheduleErrorCode, status: number, message: string) {
    super(status, code, message);
    this.name = "ScheduleRequestError";
  }
}

/** Payload rejection from the trust boundary (validation.ts), always 400. */
export class ScheduleInputError extends DomainHttpError {
  constructor(code: ScheduleErrorCode, message: string) {
    super(400, code, message);
    this.name = "ScheduleInputError";
  }
}
