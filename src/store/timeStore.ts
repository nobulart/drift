import { create } from 'zustand'

export interface TimeState {
  timeRange: [number, number] | null
  timeLockEnabled: boolean
  setTimeRange: (range: [number, number] | null) => void
  setTimeLock: (enabled: boolean) => void
}

export const useTimeStore = create<TimeState>((set, get) => ({
  timeRange: null,
  timeLockEnabled: true,
  setTimeRange: (range) => {
    const current = get().timeRange
    if (current === null && range === null) {
      return
    }
    if (
      current !== null &&
      range !== null &&
      Math.abs(current[0] - range[0]) < 1000 &&
      Math.abs(current[1] - range[1]) < 1000
    ) {
      return
    }
    set({ timeRange: range })
  },
  setTimeLock: (enabled) => set({ timeLockEnabled: enabled })
}))
