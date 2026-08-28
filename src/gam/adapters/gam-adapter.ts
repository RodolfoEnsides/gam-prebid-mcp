import type { GamNetwork } from '../models/network.js';

export type GamAdapterKind = 'rest' | 'soap';

export interface GamNetworkReader {
  readonly kind: GamAdapterKind;
  getNetwork(networkCode: string): Promise<GamNetwork>;
}

export interface GamAdapter {
  readonly kind: GamAdapterKind;
}
