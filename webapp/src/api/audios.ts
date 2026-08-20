import { useSettings } from '../context/SettingsContext';
import { createAuthenticatedClient } from './client';
import type { AudioFile } from './types';

/** `kMaxUploadBytes` in `firmware/main/config.h`; see "Limits" in the contract. */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * The cap is checked against `Content-Length`, so the multipart envelope -
 * boundaries, part headers, the title field - counts towards it. That is a few
 * hundred bytes in practice; a kibibyte of slack keeps a file that would be
 * refused on the wire from passing the check here.
 */
export const MAX_FILE_BYTES = MAX_UPLOAD_BYTES - 1024;

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
 * The device takes nothing but the extension from the client's filename, and
 * takes it as an early reject - matched here so the user is told which file is
 * wrong. Its own refusal is raised from the streaming callback and surfaces as
 * the far less helpful `No file uploaded`.
 */
export function isAcceptedFilename(name: string): boolean {
  return name.length >= 5 && name.toLowerCase().endsWith('.wav');
}

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export function fileRejectionReason(file: File): string | null {
  if (!isAcceptedFilename(file.name)) {
    return `"${file.name}" is not a .wav file. The device plays 16-bit PCM WAV only.`;
  }

  if (file.size > MAX_FILE_BYTES) {
    return `"${file.name}" is ${file.size} bytes. The device accepts at most ${MAX_FILE_BYTES} bytes per clip.`;
  }

  return null;
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
      const rejection = fileRejectionReason(file);
      if (rejection !== null) {
        return Promise.reject(new UploadRejectedError(rejection));
      }

      const body = new FormData();
      body.append('file', file);
      body.append('title', title);

      return client.request<CreatedId>('/audios', { method: 'POST', body });
    },
  };
}
