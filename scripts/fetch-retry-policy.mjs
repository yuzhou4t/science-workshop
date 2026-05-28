const retryableCurlStatuses = new Set([403, 412, 429, 500, 502, 503, 504]);

export function shouldRetryWithCurlStatus(status) {
  return retryableCurlStatuses.has(Number(status));
}
