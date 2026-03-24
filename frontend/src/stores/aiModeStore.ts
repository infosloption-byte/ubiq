import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type AiMode = 'cloud' | 'local' | 'remote';

interface AiModeState {
    aiMode: AiMode;
    setAiMode: (mode: AiMode) => void;
}

export const useAiModeStore = create<AiModeState>()(
    persist(
        (set) => ({
            aiMode: 'cloud',
            setAiMode: (aiMode) => set({ aiMode }),
        }),
        { name: 'ai-mode-storage' }
    )
);