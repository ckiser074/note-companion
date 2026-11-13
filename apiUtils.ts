import { Notice, RequestUrlResponse } from "obsidian";
import { logMessage } from "./someUtils";
import { getApiError, readRequestUrlJson } from "./lib/api-json";

export async function makeApiRequest<T = unknown>(
  requestFn: () => Promise<RequestUrlResponse>
): Promise<T> {
  logMessage("Making API request", requestFn);
  const response: RequestUrlResponse = await requestFn();
  if (response.status >= 200 && response.status < 300) {
    return readRequestUrlJson<T>(response);
  }
  const apiError = getApiError(response.json);
  if (apiError) {
    new Notice(`PARA Companion error: ${apiError}`, 6000);
    throw new Error(apiError);
  }
  throw new Error("Unknown error");
}
