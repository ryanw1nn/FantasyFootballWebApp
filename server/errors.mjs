/**
 * An error the caller caused, carrying the status to answer with. Anything
 * thrown without a `status` is ours and becomes a 500.
 */
export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
