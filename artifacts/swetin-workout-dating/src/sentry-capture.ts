type Capture = (error: unknown) => void;

let send: Capture | null = null;

export function registerBrowserCapture(capture: Capture): void {
  send = capture;
}

export function captureBrowserException(error: unknown): void {
  try {
    send?.(error);
  } catch {
    // Reporting must not replace the in-app error screen.
  }
}
