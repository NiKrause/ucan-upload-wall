import { createLibp2p, Libp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';

const BOOTSTRAP_NODES = [
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zp5i9cM2m2E1r4NkHeF7NhU9gBbz3K',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ2wBb1jzYp5VCxQGtEex9kK',
];

export class P2PClient {
  private node: Libp2p | null = null;
  private topicHandlers: Map<string, (data: Uint8Array) => void> = new Map();

  async init() {
    if (this.node) return;

    this.node = await createLibp2p({
      transports: [webSockets()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({ list: BOOTSTRAP_NODES }),
      ],
      services: {
        identify: identify(),
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.node.services.pubsub as any).addEventListener('message', (evt: any) => {
      const topic = evt.detail.topic;
      const handler = this.topicHandlers.get(topic);
      if (handler) {
        handler(evt.detail.data);
      }
    });

    await this.node.start();
    console.log('P2P Node started with PeerID:', this.node.peerId.toString());
  }

  async subscribe(topic: string, handler: (data: Uint8Array) => void) {
    if (!this.node) await this.init();
    
    this.topicHandlers.set(topic, handler);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.node!.services.pubsub as any).subscribe(topic);
    console.log('Subscribed to topic:', topic);
  }

  async publish(topic: string, data: Uint8Array) {
    if (!this.node) await this.init();
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.node!.services.pubsub as any).publish(topic, data);
    console.log('Published to topic:', topic);
  }

  async stop() {
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
  }

  getPeerId(): string {
    return this.node?.peerId.toString() || '';
  }
}

export const p2pClient = new P2PClient();
