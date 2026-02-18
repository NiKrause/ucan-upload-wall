/**
 * Filecoin Status Service
 * 
 * Handles querying Filecoin deal status using Storacha client
 */

import { Client } from '@storacha/indexing-service-client';
import * as Link from 'multiformats/link';
import type { FilecoinStatus, FilecoinDeal } from '../types/upload';

const INDEXING_SERVICE_URL = 'https://indexer.storacha.network';

/**
 * Get piece CID from shard CID using the indexing service
 * The indexing service maps shard CIDs to piece CIDs
 */
export async function getPieceCidFromShard(shardCid: string): Promise<string | null> {
  try {
    const client = new Client({ serviceURL: new URL(INDEXING_SERVICE_URL) });
    
    // Parse the shard CID
    const cid = Link.parse(shardCid);
    
    // Query claims for this shard
    const result = await client.queryClaims({
      hashes: [cid.multihash],
      match: { subject: [] }
    });
    
    if (!result.ok) {
      console.warn('Failed to query claims:', result.error);
      return null;
    }
    
    // Extract piece CID from claims
    // The indexing service returns claims that include piece CIDs
    const queryResult = result.ok;
    if (queryResult && queryResult.claims && queryResult.claims.size > 0) {
      // Look for location or equals claims that contain piece CIDs
      for (const [, claim] of queryResult.claims.entries()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((claim as any).content?.piece) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (claim as any).content.piece.toString();
        }
        // Also check for equals claims that might have piece info
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((claim as any).equals) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const equals = (claim as any).equals;
          if (equals && typeof equals === 'object' && equals.toString) {
            const equalsStr = equals.toString();
            // Piece CIDs start with 'baga'
            if (equalsStr.startsWith('baga')) {
              return equalsStr;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get piece CID from shard:', error);
    return null;
  }
}

/**
 * Query Filecoin deal information for a piece CID using Storacha client
 * This requires a Storacha client instance with proper authorization
 */
export async function queryFilecoinInfo(
  pieceCid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storachaClient?: any
): Promise<FilecoinStatus> {
  if (!storachaClient) {
    // Without a client, we can only return basic status
    return {
      piece: pieceCid,
      status: 'pending',
      lastChecked: new Date().toISOString()
    };
  }
  
  try {
    // Parse piece CID
    const piece = Link.parse(pieceCid);
    
    // Query filecoin/info capability
    const info = await storachaClient.capability.filecoin.info(piece);
    
    if (!info || !info.deals || info.deals.length === 0) {
      return {
        piece: pieceCid,
        status: 'pending',
        lastChecked: new Date().toISOString()
      };
    }
    
    // Extract deal information
    const deals: FilecoinDeal[] = info.deals.map((deal: any) => ({
      dealId: deal.dealId || deal.id || 0,
      storageProvider: deal.provider || deal.storageProvider || 'unknown',
      status: deal.status || 'active'
    }));
    
    return {
      piece: pieceCid,
      status: deals.length > 0 ? 'active' : 'pending',
      deals,
      lastChecked: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to query Filecoin info:', error);
    return {
      piece: pieceCid,
      status: 'unknown',
      lastChecked: new Date().toISOString()
    };
  }
}

/**
 * Get Filecoin status for an upload
 * Uses piece CID if available, otherwise tries to get it from shard CID
 */
export async function getFilecoinStatusForUpload(
  rootCid: string,
  shards?: string[],
  pieceCid?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storachaClient?: any
): Promise<FilecoinStatus | null> {
  try {
    // If we already have a piece CID, use it directly
    if (pieceCid) {
      return await queryFilecoinInfo(pieceCid, storachaClient);
    }
    
    // Otherwise, try to get piece CID from shard
    if (!shards || shards.length === 0) {
      console.warn('No shards or piece CID available for upload:', rootCid);
      return {
        status: 'offered',
        lastChecked: new Date().toISOString()
      };
    }
    
    // Get piece CID from first shard using indexing service
    const retrievedPieceCid = await getPieceCidFromShard(shards[0]);
    
    if (!retrievedPieceCid) {
      return {
        status: 'offered',
        lastChecked: new Date().toISOString()
      };
    }
    
    // Query Filecoin deal info
    return await queryFilecoinInfo(retrievedPieceCid, storachaClient);
  } catch (error) {
    console.error('Failed to get Filecoin status:', error);
    return null;
  }
}
