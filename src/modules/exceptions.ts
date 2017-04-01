export class Exception extends Error {
  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnassignedSinkException extends Exception {
  constructor() {
    super(`Sink was not assigned during the current tick.`);
  }
}

export class TimingException extends Exception {
  constructor(message: string) {
    super(`Ticks are not synchronized among tickables. ${message}`);
  }
}

export class MultipleAssignmentsException extends Exception {
  constructor(message?: string) {
    super(`Multiple values were assigned to a stream. ${message}`);
  }
}

export class UnexpectedNotificationException extends Exception {
  constructor() {
    super(`A notification was sent from a stream that is not listened to.`);
  }
}
