import type { Trace } from './controls';

/** One native scenario ID per entry. Each module describes its controls and operating limits. */
export interface OfficialEntry {
  id: string;
  title: string;
  description: string;
  observed: string[];
  gaps: string[];
  mount?: (context: OfficialMountContext) => OfficialMounted;
}
export interface OfficialMountContext {
  host: HTMLElement;
  engine: any;
  theme: any;
}
export interface OfficialMounted {
  charts: any[];
  traces?: Trace[];
  update?: (elapsed: number, delta: number) => void;
  dispose?: () => void;
  snapshot?: () => Record<string, unknown>;
}
