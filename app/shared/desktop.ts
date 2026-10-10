import type { Choice, Presence } from './protocol';
import type { DesktopLayout, LayoutRequest } from './layout';
export interface Preferences {
  disabledActions: string[];
  animationDefaultsVersion: number;
  scale: number;
  alwaysOnTop: boolean;
  autoStart: boolean;
  relayUrl: string;
  x?: number;
  y?: number;
  anchorX?: number;
  anchorY?: number;
}
export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  kind: 'text' | 'image';
  text?: string;
  image?: string;
  width?: number;
  height?: number;
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
  layout?: DesktopLayout;
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
  setLayout(request: LayoutRequest): void;
  setScale(scale: number): void;
  setInteractive(interactive: boolean): void;
  copyCode(): Promise<void>;
  quit(): void;
}
declare global {
  interface Window {
    pet: DesktopApi;
  }
}
