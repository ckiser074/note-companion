import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { LocalAIState } from "./types";
import {
  DEFAULT_LOCAL_MODEL_FILENAME,
  DEFAULT_LOCAL_MODEL_ID,
} from "./model-downloader";

const initialState: LocalAIState = {
  status: "uninitialized",
  statusMessage: "Local model not initialized",
  modelId: DEFAULT_LOCAL_MODEL_ID,
  modelFileName: DEFAULT_LOCAL_MODEL_FILENAME,
  modelPath: "",
  modelExists: false,
  modelSizeBytes: 0,
  downloadProgress: null,
  loadProgress: null,
  error: null,
};

export const localAIStore = createStore<LocalAIState>()(() => initialState);

export function updateLocalAIState(partial: Partial<LocalAIState>): void {
  localAIStore.setState((prev) => ({ ...prev, ...partial }));
}

export function useLocalAIState(): LocalAIState {
  return useStore(localAIStore);
}
