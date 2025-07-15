import axios from 'axios'
import { logger } from '@/ui/logger.js'
import type { CreateSessionResponse } from '@/api/types.js'
import { ApiSessionClient } from '@/api/apiSession.js';
import { encodeBase64, encrypt } from '@/api/encryption.js';

export class ApiClient {
  private readonly token: string;
  private readonly secret: Uint8Array;

  constructor(token: string, secret: Uint8Array) {
    this.token = token
    this.secret = secret
  }

  /**
   * Create a new session or load existing one with the given tag
   */
  async getOrCreateSession(opts: { tag: string, metadata: { path: string, host: string } }): Promise<CreateSessionResponse> {
    try {
      const response = await axios.post<CreateSessionResponse>(
        `https://handy-api.korshakov.org/v1/sessions`,
        { tag: opts.tag, metadata: encodeBase64(encrypt(opts.metadata, this.secret)) },
        {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      )

      logger.info(`Session created/loaded: ${response.data.session.id} (tag: ${opts.tag})`)
      return response.data;
    } catch (error) {
      logger.error('Failed to get or create session:', error);
      throw new Error(`Failed to get or create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start realtime session client
   * @param id - Session ID
   * @returns Session client
   */
  session(id: string): ApiSessionClient {
    return new ApiSessionClient(this.token, this.secret, id);
  }
}