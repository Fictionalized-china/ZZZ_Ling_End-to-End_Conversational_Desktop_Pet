import type { Choice, Presence } from './protocol';
export interface Preferences {
  disabledActions: string[];
  scale: number;
  alwaysOnTop: boolean;
  autoStart: boolean;
  relayUrl: string;
  x?: number;
  y?: number;
}
export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  kind: 'text' | 'image';
  text?: string;
  image?: string;
  time: number;
  delivery: 'sending' | 'delivered' | 'failed';
}
export interface AppState {
  preferences: Preferences;
  own: Choice;
  peer: Presence;
  effective: Presence;
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  paired: boolean;
  code: string;
  codeExpiresAt: number;
  messages: ChatMessage[];
  notice: string;
  dock: 'left' | 'right';
}
export interface DraftImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}
export interface DesktopApi {
  getState(): Promise<AppState>;
  subscribe(callback: (state: AppState) => void): () => void;
  setStatus(status: Choice): Promise<void>;
  setPreferences(patch: Partial<Preferences>): Promise<void>;
  createPair(): Promise<void>;
  joinPair(code: string): Promise<void>;
  cancelPair(): Promise<void>;
  chooseImage(): Promise<DraftImage | null>;
  pasteImage(): Promise<DraftImage | null>;
  sendText(text: string): Promise<void>;
  sendImage(dataUrl: string): Promise<void>;
  moveBy(dx: number, dy: number): void;
  setExpanded(expanded: boolean): void;
  setInteractive(interactive: boolean): void;
  copyCode(): Promise<void>;
  quit(): void;
}
declare global {
  interface Window {
    pet: DesktopApi;
  }
}
