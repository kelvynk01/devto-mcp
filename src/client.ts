import { getApiKey, getApiUrl } from "./config";

const DEVTO_VERSION = "0.1.0";

export class DevToApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number
  ) {
    super(message);
    this.name = "DevToApiError";
  }
}

export async function callApi<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = getApiKey();
  const apiUrl = getApiUrl();

  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DevTo-Version": DEVTO_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new DevToApiError(
      (data as { message?: string }).message ?? `Request failed: ${res.status}`,
      (data as { code?: string }).code,
      res.status
    );
  }

  return data as T;
}
