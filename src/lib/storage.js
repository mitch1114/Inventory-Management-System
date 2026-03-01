import { STORAGE_KEY } from "./constants";
import { defaultData } from "./defaultData";

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults to pick up any new fields added in updates
      return {
        ...defaultData,
        ...parsed,
        counters: { ...defaultData.counters, ...parsed.counters },
      };
    }
  } catch (e) {
    console.warn("Failed to load saved data, using defaults:", e);
  }
  return defaultData;
}

export function saveData(d) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    console.warn("Failed to save data:", e);
  }
}
