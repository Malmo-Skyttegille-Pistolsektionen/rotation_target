import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { AudioFile } from './types';

/** `kMaxUploadBytes` in `firmware/main/config.h`; see "Limits" in the contract. */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

export interface AudioListResponse {
  audios: AudioFile[];
}

export interface PlayResponse {
  message: string;
  audioId: number;
}

export interface CreatedId {
  id: number;
}

export interface UploadRequest {
  file: File;
  title: string;
}

/**
 * Rejected here rather than at the device because the cap is enforced by the
 * HTTP layer above the handler, which answers `400` with an HTML page instead
 * of the JSON error shape — there is no message worth relaying.
 */
export class UploadTooLargeError extends Error {
  constructor() {
    super(`File is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB the device accepts.`);
    this.name = 'UploadTooLargeError';
  }
}

export function useAudiosApi() {
  const { adminToken, logoutAdmin } = useSettings();
  const client = createAuthenticatedClient(adminToken, logoutAdmin);

  return {
    list: async (): Promise<AudioFile[]> => {
      const response = await client.request<AudioListResponse>('/audios');
      return response.audios;
    },

    play: (id: number): Promise<PlayResponse> => client.request<PlayResponse>(`/audios/${id}/play`, { method: 'POST' }),

    // The verb is in the path as well as the method: `/delete` is what the
    // firmware routes on.
    remove: (id: number): Promise<void> => client.request<void>(`/audios/${id}/delete`, { method: 'DELETE' }),

    upload: ({ file, title }: UploadRequest): Promise<CreatedId> => {
      if (file.size > MAX_UPLOAD_BYTES) {
        return Promise.reject(new UploadTooLargeError());
      }

      const body = new FormData();
      body.append('file', file);
      body.append('title', title);

      return client.request<CreatedId>('/audios', { method: 'POST', body });
    },
  };
}
