// Mock logger FIRST before any imports that use it
jest.mock("./services/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock someUtils to avoid logger import issues
jest.mock("./someUtils", () => ({
  logMessage: jest.fn(),
  logError: jest.fn(),
  sanitizeTag: jest.fn((tag: string) => (tag.startsWith("#") ? tag : `#${tag}`)),
  formatToSafeName: jest.fn((format: string) => format),
  sanitizeFileName: jest.fn((fileName: string) => fileName),
  cleanPath: jest.fn((path: string) => path),
}));

// Mock Obsidian
jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
  Notice: jest.fn(),
}));

import { makeApiRequest } from "./apiUtils";
import { Notice } from "obsidian";

describe("apiUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("makeApiRequest", () => {
    it("should return JSON data for successful responses (2xx)", async () => {
      const mockResponse = {
        status: 200,
        json: { data: "test data" },
      };

      const requestFn = jest.fn().mockResolvedValue(mockResponse);
      const result = await makeApiRequest(requestFn);

      expect(result).toEqual({ data: "test data" });
      expect(requestFn).toHaveBeenCalledTimes(1);
    });

    it("should throw error with message from response.json.error", async () => {
      const mockResponse = {
        status: 400,
        json: { error: "Request failed" },
      };

      const requestFn = jest.fn().mockResolvedValue(mockResponse);

      await expect(makeApiRequest(requestFn)).rejects.toThrow("Request failed");
      expect(Notice).toHaveBeenCalledWith(
        "File Organizer error: Request failed",
        6000
      );
    });

    it('should throw "Unknown error" when response has no error field', async () => {
      const mockResponse = {
        status: 500,
        json: { message: "Something went wrong" },
      };

      const requestFn = jest.fn().mockResolvedValue(mockResponse);
      await expect(makeApiRequest(requestFn)).rejects.toThrow("Unknown error");
    });

    it("should handle empty error messages gracefully", async () => {
      const mockResponse = {
        status: 400,
        json: { error: "" },
      };

      const requestFn = jest.fn().mockResolvedValue(mockResponse);
      await expect(makeApiRequest(requestFn)).rejects.toThrow("Unknown error");
      expect(Notice).not.toHaveBeenCalled();
    });
  });
});
