import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface TokenStore {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "campus_session_token";

export const secureTokenStore: TokenStore = {
  async load() {
    try {
      return await SecureStore.getItemAsync(KEY);
    } catch {
      return null;
    }
  },
  async save(token) {
    await SecureStore.setItemAsync(KEY, token);
  },
  async clear() {
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

function memoryTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    load: async () => token,
    save: async (t) => {
      token = t;
    },
    clear: async () => {
      token = null;
    },
  };
}

export const defaultTokenStore: TokenStore =
  Platform.OS === "web" ? memoryTokenStore() : secureTokenStore;
