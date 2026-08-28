import type { GamNetworkReader } from '../adapters/gam-adapter.js';
import type { GamNetwork } from '../models/network.js';

export interface NetworkRepository {
  getByCode(networkCode: string): Promise<GamNetwork>;
}

export class DefaultNetworkRepository implements NetworkRepository {
  constructor(private readonly adapter: GamNetworkReader) {}

  getByCode(networkCode: string): Promise<GamNetwork> {
    return this.adapter.getNetwork(networkCode);
  }
}
