// Keep this aligned with the Korean copy returned by the auth API.
const USER_FACING_MESSAGE = /^[가-힣0-9\s.,!?~…·’'()\-]+$/;

export function isUserFacingMessage(message: string): boolean {
  return message.length > 0 && message.length <= 160 && USER_FACING_MESSAGE.test(message);
}

export function userFacingMessage(error: unknown, fallback: string): string {
  const candidate = error as { data?: { error?: string } };
  const message = candidate?.data?.error;
  return typeof message === "string" && isUserFacingMessage(message) ? message : fallback;
}
