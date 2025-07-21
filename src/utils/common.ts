/**
 * Utility function to add delay
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Format duration for display
 */
export function formatDuration(totalMinutes: number): { hours: number; minutes: number } {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
}

/**
 * Create a unique session ID from sleep session data
 */
export function createSessionId(bedtimeStart: string, day: string): string {
  const startDate = new Date(bedtimeStart);
  const hours = startDate.getUTCHours().toString().padStart(2, '0');
  const minutes = startDate.getUTCMinutes().toString().padStart(2, '0');
  return `${day}_${hours}:${minutes}`;
}

/**
 * Type guard to check if error has a message property
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Type guard to check if error has status and data properties (API errors)
 */
export function isApiError(
  error: unknown
): error is { status: number; data?: unknown; statusText?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as Record<string, unknown>).status === 'number'
  );
}

/**
 * Type guard to check if error has stderr property (process errors)
 */
export function isProcessError(error: unknown): error is { stderr: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof (error as Record<string, unknown>).stderr === 'string'
  );
}

/**
 * Get error message from unknown error safely
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unknown error occurred';
}
