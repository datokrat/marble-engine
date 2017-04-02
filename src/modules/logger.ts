let isLogging = false;

export function log(message: string, ...args: any[]) {
  if (isLogging) {
    console.log(message, ...args);
  }
}

export function setLogging(logging: boolean) {
  isLogging = logging;
}
